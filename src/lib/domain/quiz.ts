// Pure mirrors of the database scoring/deadline rules (the database is authoritative).
// Used for unit tests and for explaining rules in the UI.

export type QuestionType = "single_choice" | "multiple_select" | "true_false" | "short_answer";

/** Objective scoring. Multiple select is all-or-nothing; scores are never negative. Short answers need manual grading (null). */
export function scoreQuestion(type: QuestionType, points: number, correct: string[], response: unknown): number | null {
  if (type === "short_answer") return null;
  const r = (response ?? {}) as { choice?: unknown; choices?: unknown };
  if (type === "single_choice" || type === "true_false") {
    return typeof r.choice === "string" && correct.length === 1 && r.choice === correct[0] ? points : 0;
  }
  if (!Array.isArray(r.choices)) return 0;
  const chosen = new Set(r.choices.filter((c): c is string => typeof c === "string"));
  const want = new Set(correct);
  if (chosen.size !== want.size) return 0;
  for (const c of chosen) if (!want.has(c)) return 0;
  return points;
}

/**
 * Effective deadline = earlier of (start + time limit + approved extra minutes) and the
 * effective closing time (when the quiz truncates at close). Missing bounds are omitted.
 * With no time limit the deadline is the closing time (or none).
 */
export function computeDeadline(opts: {
  start: Date;
  timeLimitMinutes: number | null;
  extraMinutes?: number;
  closesAt: Date | null;
  extendedClosesAt?: Date | null;
  truncateAtClose: boolean;
}): Date | null {
  const close = opts.extendedClosesAt ?? opts.closesAt;
  if (opts.timeLimitMinutes == null) return close ?? null;
  const limit = new Date(opts.start.getTime() + (opts.timeLimitMinutes + (opts.extraMinutes ?? 0)) * 60_000);
  if (!close || !opts.truncateAtClose) return limit;
  return limit < close ? limit : close;
}

export type GradedAttempt = { attemptNo: number; pct: number; status: "graded" | "submitted" | "voided" | "in_progress" };

/** Effective result: highest fully graded attempt (earliest wins ties) or latest fully graded attempt. */
export function effectiveAttempt(attempts: GradedAttempt[], rule: "highest" | "latest"): GradedAttempt | null {
  const graded = attempts.filter((a) => a.status === "graded");
  if (graded.length === 0) return null;
  if (rule === "latest") return graded.reduce((a, b) => (b.attemptNo > a.attemptNo ? b : a));
  return graded.reduce((a, b) => (b.pct > a.pct || (b.pct === a.pct && b.attemptNo < a.attemptNo) ? b : a));
}
