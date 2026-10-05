"use client";
import { useActionState, useId, useState, type FormEvent } from "react";
import { CheckCircle2, Info } from "lucide-react";
import { completeLesson } from "@/app/actions/learning";
import type { ActionResult } from "@/lib/errors";
import { PLAYBACK_COMPLETE_RATIO, playbackRuleMet, playedPercent, type CompletionMode } from "@/lib/learning/completion";
import { usePlayback } from "./playback-context";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonClass } from "@/components/ui/button";
import { submitWithoutReset } from "@/components/ui/submit-without-reset";
import { t } from "@/i18n";

const NEEDED = Math.round(PLAYBACK_COMPLETE_RATIO * 100);

/**
 * Completion for one lesson. Readings and other lessons use an explicit acknowledgement;
 * lessons with the playback rule become "played" once the furthest point reached in the
 * uploaded video is at least 90% of it (the same check the database makes). Staff
 * previews, closed courses and inactive enrollments show the control disabled with the reason.
 */
export function CompletionControl({
  offeringId,
  lessonId,
  mode,
  required,
  doneLabel,
  disabledReason,
}: {
  offeringId: string;
  lessonId: string;
  mode: CompletionMode;
  required: boolean;
  /** "Completed Oct 5, 2026" (or "Played …") when the learner already completed the lesson. */
  doneLabel: string | null;
  /** Why progress cannot be recorded here; the control is shown disabled with this text. */
  disabledReason: string | null;
}) {
  const helpId = useId();
  const playback = usePlayback();
  const [offline, setOffline] = useState(false);
  const [state, formAction] = useActionState(async (prev: ActionResult | null, formData: FormData): Promise<ActionResult> => {
    try {
      return await completeLesson(prev, formData);
    } catch {
      // Network failure: keep the page and say what happened instead of showing an error page.
      return { ok: false, error: t("learn.complete.offline") };
    }
  }, null);

  const played = mode === "played";
  const max = playback?.max ?? 0;
  const duration = playback?.duration ?? null;
  const ruleMet = !played || playbackRuleMet(max, duration);
  const percent = playedPercent(max, duration);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      event.preventDefault();
      setOffline(true);
      return;
    }
    setOffline(false);
    submitWithoutReset(formAction)(event);
  };

  const optionalNote = required ? null : <p className="text-sm text-muted">{t("learn.complete.optionalNote")}</p>;

  if (doneLabel) {
    return (
      <div className="space-y-2">
        <p className="inline-flex items-center gap-2 rounded-md border border-[#bbf7d0] bg-success-soft px-3 py-2 text-sm font-medium">
          <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-success" /> {doneLabel}
        </p>
        <div aria-live="polite" className="empty:hidden">
          {state?.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}
        </div>
        {optionalNote}
      </div>
    );
  }

  if (disabledReason || mode === "unavailable") {
    const reason = disabledReason ?? t("learn.complete.unavailableRule");
    return (
      <div className="space-y-2">
        <button type="button" disabled aria-describedby={helpId} className={buttonClass("secondary")}>
          {played ? t("learn.complete.playedButton") : t("learn.complete.ackButton")}
        </button>
        <p id={helpId} className="flex items-start gap-2 text-sm text-muted">
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /> {reason}
        </p>
        {optionalNote}
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="offeringId" value={offeringId} />
      <input type="hidden" name="lessonId" value={lessonId} />
      <input type="hidden" name="mode" value={played ? "played" : "acknowledge"} />
      {playback ? (
        <>
          <input type="hidden" name="position" value={String(max)} />
          <input type="hidden" name="duration" value={duration === null ? "" : String(duration)} />
        </>
      ) : null}
      <SubmitButton disabled={!ruleMet} aria-describedby={helpId} pendingText={t("learn.complete.saving")}>
        <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
        {played ? t("learn.complete.playedButton") : t("learn.complete.ackButton")}
      </SubmitButton>
      <div id={helpId} className="space-y-1 text-sm text-muted">
        <p>{played ? t("learn.complete.playedHelp", { percent: NEEDED }) : t("learn.complete.ackHelp")}</p>
        {played ? <p>{t("learn.complete.playedProgress", { percent, needed: NEEDED })}</p> : null}
      </div>
      {optionalNote}
      <div aria-live="polite" className="empty:hidden">
        {offline ? <Alert tone="warning">{t("learn.complete.offline")}</Alert> : null}
        {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
      </div>
    </form>
  );
}
