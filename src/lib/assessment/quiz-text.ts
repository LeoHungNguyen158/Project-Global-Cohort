// Display helpers shared by the quiz pages (pure: safe on the server and in the browser).
import { t } from "@/i18n/client/assessment";
import { formatDateTime } from "@/lib/time";
import { percentOf, quizWindowState, type ReviewExplanation } from "@/lib/domain/quiz";
import { formatPoints } from "@/lib/domain/grades";

export function windowText(now: Date, availableFrom: string | null, effectiveClosesAt: string | null, tz: string): string {
  const state = quizWindowState(now, availableFrom, effectiveClosesAt);
  if (state === "not_open") return t("quiz.window.notOpen", { date: formatDateTime(availableFrom, tz) });
  if (state === "closed") return t("quiz.window.closed", { date: formatDateTime(effectiveClosesAt, tz) });
  if (effectiveClosesAt) return t("quiz.window.openUntil", { date: formatDateTime(effectiveClosesAt, tz) });
  return availableFrom ? t("quiz.window.openNoClose") : t("quiz.window.noDates");
}

export function timeLimitText(limit: number | null, extraMinutes = 0): string {
  if (limit === null) return t("quiz.noTimeLimit");
  const base = t("quiz.minutes", { minutes: limit });
  return extraMinutes > 0 ? `${base} (${t("quiz.extraMinutes", { minutes: extraMinutes })})` : base;
}

export function pointsLabel(points: number | string): string {
  return Number(points) === 1 ? t("quiz.point") : t("quiz.points", { points: formatPoints(points) });
}

export function questionCountText(count: number): string {
  return count === 1 ? t("quiz.questionCountOne") : t("quiz.questionsCount", { count });
}

/** "7.5 / 10 (75.00%)", or null when there is nothing to show. */
export function scoreText(score: number | string | null | undefined, max: number | string | null | undefined): string | null {
  if (score === null || score === undefined || max === null || max === undefined) return null;
  const pct = percentOf(score, max);
  return t("quiz.scoreOf", { score: formatPoints(score), max: formatPoints(max), pct: pct ?? "0.00" });
}

export function reviewExplanationText(e: ReviewExplanation, tz: string): string {
  switch (e.kind) {
    case "available":
      return t("quiz.review.available");
    case "never":
      return t("quiz.review.policy.never");
    case "after_submit":
      return t("quiz.review.policy.afterSubmit");
    case "after_close":
      return e.at ? t("quiz.review.policy.afterClose", { date: formatDateTime(e.at, tz) }) : t("quiz.review.policy.afterCloseNodate");
    case "manual":
      return e.releasedAt ? t("quiz.review.policy.manualReleased", { date: formatDateTime(e.releasedAt, tz) }) : t("quiz.review.policy.manual");
  }
}
