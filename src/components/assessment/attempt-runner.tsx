"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock, CloudOff, Loader2 } from "lucide-react";
import { checkAttempt, saveAttemptAnswer, submitQuizAttempt, type SaveAnswerResult } from "@/app/actions/quizzes";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/components/ui/cn";
import { t } from "@/i18n/client/assessment";
import { formatDateTime, formatTime } from "@/lib/time";
import { formatCountdown, isAnswered, remainingMs, sameResponse, type QuizResponse } from "@/lib/domain/quiz";
import { QuestionView, type LearnerQuestion } from "./question-view";

export type RunnerQuestion = LearnerQuestion & { response: QuizResponse; saved_at: string | null };

type SaveState =
  | { kind: "saved" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "retrying" }
  | { kind: "rejected"; message: string };

type Ended = { reason: "submitted" | "expired" | "voided"; at: string | null; unsaved: number[] };

const TEXT_DEBOUNCE_MS = 800;
const HEARTBEAT_MS = 60_000;

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/**
 * Runs a quiz attempt (or a staff preview). Every answer autosaves on its own; the server
 * deadline is authoritative and the countdown only informs. Failed saves retry with backoff,
 * an offline banner says what was last saved, and the server finalizes an expired attempt.
 */
export function AttemptRunner({
  mode,
  attemptId,
  attemptNo,
  questions,
  initialDeadline,
  serverNow,
  tz,
  overviewHref,
  backLabel,
}: {
  mode: "attempt" | "preview";
  attemptId: string;
  attemptNo: number;
  questions: RunnerQuestion[];
  initialDeadline: string | null;
  serverNow: string;
  tz: string;
  overviewHref: string;
  backLabel?: string;
}) {
  const preview = mode === "preview";
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const numberOf = useMemo(() => new Map(questions.map((q, i) => [q.id, i + 1])), [questions]);

  const initialValues = useMemo(() => Object.fromEntries(questions.map((q) => [q.id, q.response ?? null])) as Record<string, QuizResponse>, [questions]);
  const [values, setValues] = useState<Record<string, QuizResponse>>(initialValues);
  const valuesRef = useRef(initialValues);
  const savedRef = useRef<Record<string, QuizResponse>>({ ...initialValues });
  const [savedAt, setSavedAt] = useState<Record<string, string | null>>(() => Object.fromEntries(questions.map((q) => [q.id, q.saved_at])));
  const [lastSaved, setLastSaved] = useState<string | null>(() => latest(questions.map((q) => q.saved_at)));
  const [states, setStates] = useState<Record<string, SaveState>>(() => Object.fromEntries(questions.map((q) => [q.id, { kind: "saved" } as SaveState])));

  const dirty = useRef(new Set<string>());
  const rejected = useRef(new Set<string>());
  const timers = useRef(new Map<string, number>());
  const inFlight = useRef(false);
  const retryTimer = useRef<number | null>(null);
  const retryDelay = useRef(2000);
  // Lets the save loop schedule itself again without referring to its own declaration.
  const pumpRef = useRef<() => void>(() => {});

  const [deadline, setDeadline] = useState<string | null>(initialDeadline);
  // Server clock minus client clock, refined by every round trip. The first render uses the
  // server's own time so the server and browser render the same countdown.
  const offsetRef = useRef<number | null>(null);
  const [clock, setClock] = useState(() => ({ now: new Date(serverNow).getTime(), offset: 0 }));
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [trouble, setTrouble] = useState(false);
  const [ended, setEnded] = useState<Ended | null>(null);
  const endedRef = useRef(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const setState = useCallback((id: string, s: SaveState) => setStates((prev) => ({ ...prev, [id]: s })), []);

  const syncClock = useCallback((server: string, sentAt: number, receivedAt: number) => {
    const ms = new Date(server).getTime();
    if (!Number.isFinite(ms)) return;
    offsetRef.current = ms - (sentAt + receivedAt) / 2;
    setClock({ now: Date.now(), offset: offsetRef.current });
  }, []);

  const finish = useCallback(
    (reason: Ended["reason"], at: string | null) => {
      if (endedRef.current) return;
      endedRef.current = true;
      const unsaved = Array.from(dirty.current)
        .map((id) => numberOf.get(id) ?? 0)
        .filter(Boolean)
        .sort((a, b) => a - b);
      timers.current.forEach((h) => window.clearTimeout(h));
      timers.current.clear();
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
      setConfirmOpen(false);
      setEnded({ reason, at, unsaved });
    },
    [numberOf],
  );

  /** Asks the server for the attempt's state (it finalizes an expired attempt); ends the runner when it is over. */
  const reconcile = useCallback(async (): Promise<boolean> => {
    if (preview || endedRef.current) return endedRef.current;
    const sent = Date.now();
    try {
      const res = await checkAttempt(attemptId);
      if (!res.ok) return false;
      syncClock(res.serverNow, sent, Date.now());
      setDeadline(res.deadlineAt);
      if (res.status !== "in_progress") {
        finish(res.status === "voided" ? "voided" : res.finalizedReason === "expired" ? "expired" : "submitted", res.submittedAt);
        return true;
      }
    } catch {
      // Network failure: the countdown and the save retries continue; the server keeps what it has.
    }
    return false;
  }, [attemptId, finish, preview, syncClock]);

  const pump = useCallback(async () => {
    if (preview || inFlight.current || endedRef.current) return;
    const id = Array.from(dirty.current).find((qid) => !timers.current.has(qid) && !rejected.current.has(qid));
    const q = id ? byId.get(id) : undefined;
    if (!id || !q) return;
    inFlight.current = true;
    const sent = valuesRef.current[id] ?? null;
    setState(id, { kind: "saving" });
    const sentAt = Date.now();
    let res: SaveAnswerResult;
    try {
      res = await saveAttemptAnswer({ attemptId, questionId: id, type: q.type, response: sent });
    } catch {
      res = { ok: false, reason: "error", message: "" };
    }
    inFlight.current = false;
    if (endedRef.current) return;
    if (res.ok) {
      syncClock(res.serverNow, sentAt, Date.now());
      setDeadline(res.deadlineAt);
      savedRef.current[id] = sent;
      const at = res.savedAt;
      setSavedAt((prev) => ({ ...prev, [id]: at }));
      setLastSaved(at);
      retryDelay.current = 2000;
      setTrouble(false);
      if (sameResponse(valuesRef.current[id] ?? null, sent)) {
        dirty.current.delete(id);
        setState(id, { kind: "saved" });
      } else {
        dirty.current.add(id);
        setState(id, { kind: "pending" });
      }
      pumpRef.current();
      return;
    }
    if (res.reason === "expired" || res.reason === "submitted") {
      const over = await reconcile();
      if (!over) finish(res.reason === "expired" ? "expired" : "submitted", null);
      return;
    }
    if (res.reason === "invalid") {
      rejected.current.add(id);
      setState(id, { kind: "rejected", message: res.message });
      pumpRef.current();
      return;
    }
    setState(id, { kind: "retrying" });
    setTrouble(true);
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null;
      pumpRef.current();
    }, retryDelay.current);
    retryDelay.current = Math.min(retryDelay.current * 2, 15_000);
  }, [attemptId, byId, finish, preview, reconcile, setState, syncClock]);

  useEffect(() => {
    pumpRef.current = () => void pump();
  }, [pump]);

  function change(q: RunnerQuestion, value: QuizResponse) {
    if (endedRef.current) return;
    valuesRef.current = { ...valuesRef.current, [q.id]: value };
    setValues(valuesRef.current);
    if (preview) return;
    rejected.current.delete(q.id);
    const pending = timers.current.get(q.id);
    if (pending) window.clearTimeout(pending);
    timers.current.delete(q.id);
    if (sameResponse(value, savedRef.current[q.id] ?? null)) {
      // Back to what the server already has (an in-flight save re-marks it if needed).
      dirty.current.delete(q.id);
      setState(q.id, { kind: "saved" });
      return;
    }
    dirty.current.add(q.id);
    setState(q.id, { kind: "pending" });
    timers.current.set(
      q.id,
      window.setTimeout(
        () => {
          timers.current.delete(q.id);
          void pump();
        },
        q.type === "short_answer" ? TEXT_DEBOUNCE_MS : 0,
      ),
    );
  }

  // Countdown tick.
  useEffect(() => {
    if (preview || !deadline) return;
    const h = window.setInterval(() => setClock({ now: Date.now(), offset: offsetRef.current ?? 0 }), 1000);
    return () => window.clearInterval(h);
  }, [preview, deadline]);

  // Retry at once when the browser reconnects.
  useEffect(() => {
    if (preview) return;
    const onOnline = () => {
      if (retryTimer.current) window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
      retryDelay.current = 2000;
      void pump();
      void reconcile();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [preview, pump, reconcile]);

  // Measure the server clock on load, then keep the deadline (an accommodation can extend it)
  // and the attempt state (submitted in another tab, voided by staff) in step with the server.
  useEffect(() => {
    if (preview) return;
    const first = window.setTimeout(() => void reconcile(), 0);
    const h = window.setInterval(() => void reconcile(), HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void reconcile();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(h);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [preview, reconcile]);

  // Warn before leaving with answers that have not reached the server.
  useEffect(() => {
    if (preview) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!endedRef.current && (dirty.current.size > 0 || inFlight.current)) {
        e.preventDefault();
        e.returnValue = t("quiz.attempt.leaveWarning");
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [preview]);

  const remaining = !preview && deadline ? remainingMs(deadline, clock.now, clock.offset) : null;
  const expiring = remaining !== null && remaining <= 0 && !ended;

  // At the deadline the server finalizes the attempt; ask until it confirms.
  useEffect(() => {
    if (!expiring) return;
    let cancelled = false;
    let tries = 0;
    let handle = 0;
    const run = async () => {
      if (cancelled) return;
      const over = await reconcile();
      tries += 1;
      if (!over && !cancelled) handle = window.setTimeout(run, Math.min(2000 * tries, 10_000));
    };
    handle = window.setTimeout(run, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [expiring, reconcile]);

  const answered = questions.filter((q) => isAnswered(q.type, values[q.id])).length;
  const unanswered = questions.filter((q) => !isAnswered(q.type, values[q.id])).map((q) => numberOf.get(q.id) ?? 0);
  const unsavedNumbers = questions
    .filter((q) => ["pending", "saving", "retrying", "rejected"].includes(states[q.id]?.kind ?? ""))
    .map((q) => numberOf.get(q.id) ?? 0);
  const anyRetrying = questions.some((q) => states[q.id]?.kind === "retrying");
  const anyBusy = questions.some((q) => ["pending", "saving"].includes(states[q.id]?.kind ?? ""));

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    // Give queued answers a moment to reach the server first; only saved answers are submitted.
    const until = Date.now() + 8000;
    while ((dirty.current.size > 0 || inFlight.current) && Date.now() < until && !endedRef.current) {
      timers.current.forEach((h) => window.clearTimeout(h));
      timers.current.clear();
      void pump();
      await new Promise((r) => window.setTimeout(r, 250));
    }
    if (endedRef.current) return;
    try {
      const res = await submitQuizAttempt(attemptId);
      if (!res.ok) setSubmitError(res.error);
      else finish(res.status === "voided" ? "voided" : res.finalizedReason === "expired" ? "expired" : "submitted", res.submittedAt);
    } catch {
      setSubmitError(t("quiz.attempt.submitFailed"));
    }
    setSubmitting(false);
  }

  if (ended) return <EndedPanel ended={ended} tz={tz} overviewHref={overviewHref} />;

  // Announced once per threshold (the text only changes when a threshold is crossed).
  const minutesLeft = remaining === null ? null : remaining / 60_000;
  const timeNotice =
    minutesLeft === null || minutesLeft <= 0
      ? ""
      : minutesLeft <= 1
        ? t("quiz.attempt.oneMinute")
        : minutesLeft <= 5
          ? t("quiz.attempt.lowTime", { minutes: 5 })
          : minutesLeft <= 10
            ? t("quiz.attempt.lowTime", { minutes: 10 })
            : "";
  const lowTime = minutesLeft !== null && minutesLeft <= 5;
  const openConfirm = () => {
    setSubmitError(null);
    setConfirmOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Countdown and save status stay in view while scrolling. */}
      <div className="sticky top-14 z-20 rounded-[var(--radius-panel)] border border-line bg-panel px-4 py-3 shadow-sm sm:px-6 lg:top-2">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          {preview ? (
            <p className="text-sm text-muted">{t("quiz.preview.timerNote")}</p>
          ) : deadline ? (
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted" id="time-remaining-label">{t("quiz.attempt.timeRemaining")}</p>
              <p role="timer" aria-labelledby="time-remaining-label" className={cn("font-mono text-2xl font-semibold tabular-nums", lowTime ? "text-danger" : "text-ink")}>
                <Clock aria-hidden="true" className="mr-1 inline h-5 w-5 align-[-2px]" />
                {formatCountdown(remaining ?? 0)}
              </p>
              <p className="text-sm">{t("quiz.attempt.submitBy", { deadline: formatDateTime(deadline, tz) })}</p>
            </div>
          ) : (
            <p className="text-sm">{t("quiz.attempt.noDeadline")}</p>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {preview ? (
              <span className="text-sm text-muted">{t("quiz.preview.notSaved")}</span>
            ) : (
              <OverallStatus anyRetrying={anyRetrying} anyBusy={anyBusy} lastSaved={lastSaved} tz={tz} />
            )}
            <Button onClick={openConfirm} disabled={preview || expiring} aria-describedby={preview ? "preview-submit-note" : undefined}>
              {t("quiz.attempt.submit")}
            </Button>
          </div>
        </div>
        {preview ? (
          <p id="preview-submit-note" className="mt-2 text-xs text-muted">{t("quiz.preview.submitDisabled")}</p>
        ) : deadline ? (
          <p className="mt-2 text-xs text-muted">{t("quiz.attempt.serverAuthoritative")}</p>
        ) : null}
      </div>

      <p className="sr-only" aria-live="polite">{timeNotice}</p>
      <p className="sr-only" aria-live="polite">
        {preview ? "" : anyRetrying ? t("quiz.attempt.overall.retrying") : !anyBusy && lastSaved ? t("quiz.attempt.overall.allSaved", { time: formatTime(lastSaved, tz) }) : ""}
      </p>

      {expiring ? <Alert tone="warning" live title={t("quiz.attempt.expiring")} /> : null}

      {!preview && (!online || trouble) ? (
        <Alert tone="warning" live title={online ? t("quiz.attempt.troubleTitle") : t("quiz.attempt.offlineTitle")}>
          <p>{lastSaved ? t("quiz.attempt.offlineLastSaved", { time: formatTime(lastSaved, tz) }) : t("quiz.attempt.offlineNothingSaved")}</p>
          {unsavedNumbers.length > 0 ? <p>{t("quiz.attempt.unsavedQuestions", { list: listNumbers(unsavedNumbers) })}</p> : null}
          <p>{t("quiz.attempt.offlineBody")}</p>
        </Alert>
      ) : null}

      <p className="text-sm text-muted">{t("quiz.attempt.progress", { answered, total: questions.length })}</p>

      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={q.id}>
            <QuestionView
              question={q}
              index={i}
              total={questions.length}
              value={values[q.id] ?? null}
              onChange={(v) => change(q, v)}
              disabled={expiring}
              status={preview ? <span className="text-muted">{t("quiz.preview.notSaved")}</span> : <QuestionStatus state={states[q.id]} savedAt={savedAt[q.id]} tz={tz} />}
            />
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={openConfirm} disabled={preview || expiring}>
          {t("quiz.attempt.submit")}
        </Button>
        <Link href={overviewHref} className="inline-flex min-h-10 items-center text-sm text-primary underline-offset-2 hover:underline">
          {backLabel ?? t("quiz.backToQuiz")}
        </Link>
      </div>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t("quiz.attempt.submitTitle", { number: attemptNo })} description={t("quiz.attempt.submitBody")}>
        <div className="space-y-3 text-sm">
          {unanswered.length > 0 ? (
            <Alert tone="warning" title={t("quiz.attempt.unanswered", { list: listNumbers(unanswered) })} />
          ) : (
            <p>{t("quiz.attempt.allAnswered")}</p>
          )}
          {unsavedNumbers.length > 0 ? <Alert tone="warning">{t("quiz.attempt.unsavedWarning")}</Alert> : null}
          {submitError ? (
            <Alert tone="error" live>
              {submitError}
            </Alert>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button type="button" className={buttonClass("secondary")} onClick={() => setConfirmOpen(false)} disabled={submitting}>
              {t("quiz.attempt.keepWorking")}
            </button>
            <button type="button" className={buttonClass("primary")} onClick={() => void submit()} disabled={submitting} aria-busy={submitting}>
              {submitting ? t("quiz.attempt.submitting") : t("quiz.attempt.submitConfirm")}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function OverallStatus({ anyRetrying, anyBusy, lastSaved, tz }: { anyRetrying: boolean; anyBusy: boolean; lastSaved: string | null; tz: string }) {
  if (anyRetrying) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-danger">
        <CloudOff aria-hidden="true" className="h-4 w-4 shrink-0" /> {t("quiz.attempt.overall.retrying")}
      </span>
    );
  }
  if (anyBusy) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted">
        <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" /> {t("quiz.attempt.overall.saving")}
      </span>
    );
  }
  if (lastSaved) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-success">
        <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" /> {t("quiz.attempt.overall.allSaved", { time: formatTime(lastSaved, tz) })}
      </span>
    );
  }
  return <span className="text-sm text-muted">{t("quiz.attempt.overall.nothingYet")}</span>;
}

function QuestionStatus({ state, savedAt, tz }: { state: SaveState | undefined; savedAt: string | null | undefined; tz: string }) {
  switch (state?.kind) {
    case "pending":
      return <span className="text-muted">{t("quiz.attempt.pending")}</span>;
    case "saving":
      return (
        <span className="inline-flex items-center gap-1 text-muted">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> {t("quiz.attempt.saving")}
        </span>
      );
    case "retrying":
      return (
        <span className="inline-flex items-center gap-1 text-danger">
          <CloudOff aria-hidden="true" className="h-4 w-4" /> {t("quiz.attempt.retrying")}
        </span>
      );
    case "rejected":
      return (
        <span className="inline-flex items-center gap-1 text-danger" role="alert">
          <AlertCircle aria-hidden="true" className="h-4 w-4" /> {t("quiz.attempt.rejected", { reason: state.message })}
        </span>
      );
    default:
      return savedAt ? (
        <span className="inline-flex items-center gap-1 text-success">
          <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> {t("quiz.attempt.savedAt", { time: formatTime(savedAt, tz) })}
        </span>
      ) : (
        <span className="text-muted">{t("quiz.attempt.notAnswered")}</span>
      );
  }
}

function EndedPanel({ ended, tz, overviewHref }: { ended: Ended; tz: string; overviewHref: string }) {
  const time = ended.at ? formatDateTime(ended.at, tz) : "";
  return (
    <div className="space-y-4">
      <Alert tone={ended.reason === "voided" ? "warning" : "success"} live title={t("quiz.attempt.endedTitle")}>
        <p>
          {ended.reason === "expired"
            ? t("quiz.attempt.expiredBody", { time })
            : ended.reason === "voided"
              ? t("quiz.attempt.voidedBody")
              : t("quiz.attempt.submittedBody", { time })}
        </p>
        {ended.unsaved.length > 0 ? <p className="mt-1">{t("quiz.attempt.lostAnswers", { list: listNumbers(ended.unsaved) })}</p> : null}
      </Alert>
      <Link href={overviewHref} className={buttonClass("primary")}>
        {t("quiz.backToQuiz")}
      </Link>
    </div>
  );
}

function listNumbers(numbers: number[]) {
  return numbers.map((n) => t("quiz.attempt.questionShort", { number: n })).join(", ");
}

function latest(values: (string | null)[]): string | null {
  let best: string | null = null;
  for (const v of values) if (v && (!best || new Date(v) > new Date(best))) best = v;
  return best;
}
