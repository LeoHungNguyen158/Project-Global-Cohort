"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { startQuizAttempt } from "@/app/actions/quizzes";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SubmitButton } from "@/components/ui/submit-button";
import { submitWithoutReset } from "@/components/ui/submit-without-reset";
import { t } from "@/i18n";
import type { ActionResult } from "@/lib/errors";
import { formatDateTime } from "@/lib/time";
import { projectAttemptWindow } from "@/lib/domain/quiz";

/**
 * "Take the quiz" panel body: states the exact deadline an attempt started now would get
 * (including truncation by the closing time), refreshed while the page stays open, and starts
 * the attempt after a confirmation. The database computes the real deadline at start.
 */
export function StartAttempt({
  quizId,
  attemptNumber,
  timeLimitMinutes,
  extraMinutes,
  effectiveClosesAt,
  truncateAtClose,
  serverNow,
  tz,
}: {
  quizId: string;
  attemptNumber: number;
  timeLimitMinutes: number | null;
  extraMinutes: number;
  effectiveClosesAt: string | null;
  truncateAtClose: boolean;
  serverNow: string;
  tz: string;
}) {
  const offset = useRef<number | null>(null);
  const [now, setNow] = useState(() => new Date(serverNow).getTime());
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionResult | null, FormData>(startQuizAttempt, null);

  useEffect(() => {
    const tick = () => {
      if (offset.current === null) offset.current = new Date(serverNow).getTime() - Date.now();
      setNow(Date.now() + offset.current);
    };
    const first = window.setTimeout(tick, 0);
    const h = window.setInterval(tick, 15_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(h);
    };
  }, [serverNow]);

  const p = projectAttemptWindow({
    start: new Date(now),
    timeLimitMinutes,
    extraMinutes,
    closesAt: effectiveClosesAt ? new Date(effectiveClosesAt) : null,
    truncateAtClose,
  });
  const limit = timeLimitMinutes === null ? null : timeLimitMinutes + extraMinutes;
  const deadlineText = p.deadline ? formatDateTime(p.deadline, tz) : null;

  return (
    <div className="space-y-3">
      {p.deadline ? (
        <div className="space-y-1">
          <p className="text-[1.05rem] font-semibold">{t("quiz.overview.deadlineIfNow", { deadline: deadlineText ?? "" })}</p>
          {p.availableMinutes !== null ? <p>{t("quiz.overview.deadlineIfNowRemaining", { minutes: p.availableMinutes })}</p> : null}
        </div>
      ) : (
        <p>{t("quiz.overview.noDeadline")}</p>
      )}
      {p.truncated && effectiveClosesAt && limit !== null ? (
        <Alert tone="warning">
          {t("quiz.overview.truncated", { close: formatDateTime(effectiveClosesAt, tz), limit, minutes: p.availableMinutes ?? 0 })}
        </Alert>
      ) : null}
      {timeLimitMinutes === null && effectiveClosesAt ? <p className="text-sm">{t("quiz.overview.closeOnly", { close: formatDateTime(effectiveClosesAt, tz) })}</p> : null}
      {timeLimitMinutes !== null && effectiveClosesAt && !truncateAtClose ? <p className="text-sm">{t("quiz.overview.notTruncatedNote")}</p> : null}
      {p.deadline ? <p className="text-sm text-muted">{t("quiz.overview.serverTimer")}</p> : null}
      <Button onClick={() => setOpen(true)}>{t("quiz.overview.startButton", { number: attemptNumber })}</Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("quiz.overview.startConfirmTitle", { number: attemptNumber })}
        description={deadlineText ? t("quiz.overview.startConfirmBody", { deadline: deadlineText }) : t("quiz.overview.startConfirmNoDeadline")}
      >
        <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="space-y-4">
          <input type="hidden" name="quiz_id" value={quizId} />
          {p.truncated && effectiveClosesAt && limit !== null ? (
            <Alert tone="warning">
              {t("quiz.overview.truncated", { close: formatDateTime(effectiveClosesAt, tz), limit, minutes: p.availableMinutes ?? 0 })}
            </Alert>
          ) : null}
          {state && !state.ok ? (
            <Alert tone="error" live>
              {state.error}
            </Alert>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={buttonClass("secondary")} onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </button>
            <SubmitButton pendingText={t("quiz.overview.starting")}>{t("quiz.overview.startNow")}</SubmitButton>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
