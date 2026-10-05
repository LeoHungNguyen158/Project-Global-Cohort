// Pure mirrors of the database scoring/deadline rules (the database is authoritative).
// Used for unit tests and for explaining rules in the UI.
import Decimal from "decimal.js";

export type QuestionType = "single_choice" | "multiple_select" | "true_false" | "short_answer";
export const QUESTION_TYPES: QuestionType[] = ["single_choice", "multiple_select", "true_false", "short_answer"];

export type AttemptStatus = "in_progress" | "submitted" | "graded" | "voided";
export type ReviewPolicy = "never" | "after_submit" | "after_close" | "manual";
export const REVIEW_POLICIES: ReviewPolicy[] = ["after_submit", "after_close", "manual", "never"];
export type ScoreRelease = "immediate" | "manual";
export type ScoringRule = "highest" | "latest";

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

export type AttemptWindowProjection = {
  /** When an attempt started at `start` must be submitted (null: no deadline at all). */
  deadline: Date | null;
  /** What the full time limit (plus extra time) alone would allow; null without a time limit. */
  fullLimitDeadline: Date | null;
  /** True when the closing time ends the attempt before the full time limit would. */
  truncated: boolean;
  /** Whole minutes available from `start` until the deadline (null without a deadline). */
  availableMinutes: number | null;
};

/** What a learner sees before starting: the exact deadline, including early truncation by the closing time. */
export function projectAttemptWindow(opts: Parameters<typeof computeDeadline>[0]): AttemptWindowProjection {
  const deadline = computeDeadline(opts);
  const fullLimitDeadline =
    opts.timeLimitMinutes == null ? null : new Date(opts.start.getTime() + (opts.timeLimitMinutes + (opts.extraMinutes ?? 0)) * 60_000);
  const truncated = Boolean(deadline && fullLimitDeadline && deadline.getTime() < fullLimitDeadline.getTime());
  const availableMinutes = deadline ? Math.max(0, Math.floor((deadline.getTime() - opts.start.getTime()) / 60_000)) : null;
  return { deadline, fullLimitDeadline, truncated, availableMinutes };
}

/** Milliseconds left until the server deadline, using the measured server clock offset (server minus client). */
export function remainingMs(deadline: Date | string, clientNowMs: number, serverOffsetMs: number): number {
  const d = typeof deadline === "string" ? new Date(deadline).getTime() : deadline.getTime();
  return d - (clientNowMs + serverOffsetMs);
}

/** "1:05:09", "4:59" or "0:00" (never negative). Rounds up so the display reaches 0:00 only at the deadline. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export type QuizWindowState = "not_open" | "open" | "closed";

/** Whether the quiz window is open at `now` (using the learner's effective closing time). */
export function quizWindowState(now: Date, availableFrom: string | null, effectiveClosesAt: string | null): QuizWindowState {
  if (availableFrom && now < new Date(availableFrom)) return "not_open";
  if (effectiveClosesAt && now >= new Date(effectiveClosesAt)) return "closed";
  return "open";
}

export type GradedAttempt = { attemptNo: number; pct: number; status: AttemptStatus };

/** Effective result: highest fully graded attempt (earliest wins ties) or latest fully graded attempt. */
export function effectiveAttempt(attempts: GradedAttempt[], rule: ScoringRule): GradedAttempt | null {
  const graded = attempts.filter((a) => a.status === "graded");
  if (graded.length === 0) return null;
  if (rule === "latest") return graded.reduce((a, b) => (b.attemptNo > a.attemptNo ? b : a));
  return graded.reduce((a, b) => (b.pct > a.pct || (b.pct === a.pct && b.attemptNo < a.attemptNo) ? b : a));
}

/** Percentage with two decimals (half-up), or null when there is nothing to divide by. */
export function percentOf(points: number | string | null | undefined, max: number | string | null | undefined): string | null {
  if (points === null || points === undefined || max === null || max === undefined) return null;
  const m = new Decimal(max);
  if (m.lte(0)) return null;
  return new Decimal(points).div(m).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Pass/fail against the pass mark, compared on the rounded percentage that is displayed. */
export function hasPassed(pct: string | null, passPct: number | string): boolean | null {
  if (pct === null) return null;
  return new Decimal(pct).gte(new Decimal(passPct));
}

export type LearnerQuizAttempt = { status: AttemptStatus; attemptNo: number };

export type LearnerQuizState = "not_started" | "in_progress" | "pending_manual" | "awaiting_release" | "released" | "voided";

/**
 * The single status shown for a quiz in a learner's list. An attempt in progress wins;
 * otherwise pending manual grading, then a released result, then "submitted, awaiting results".
 * Voided attempts do not count as taken.
 */
export function learnerQuizState(attempts: LearnerQuizAttempt[], hasReleasedResult: boolean): LearnerQuizState {
  if (attempts.some((a) => a.status === "in_progress")) return "in_progress";
  if (attempts.some((a) => a.status === "submitted")) return "pending_manual";
  if (hasReleasedResult) return "released";
  if (attempts.some((a) => a.status === "graded")) return "awaiting_release";
  if (attempts.length > 0 && attempts.every((a) => a.status === "voided")) return "voided";
  return "not_started";
}

export type ReviewExplanation =
  | { kind: "available" }
  | { kind: "never" }
  | { kind: "after_submit" }
  | { kind: "after_close"; at: string | null }
  | { kind: "manual"; releasedAt: string | null };

/**
 * Explains when answer review opens under a policy. The database decides whether review is
 * available (get_attempt_review / quiz_learner_details); this only produces the explanation.
 */
export function reviewExplanation(policy: ReviewPolicy, opts: { available: boolean; effectiveClosesAt: string | null; answersReleasedAt: string | null }): ReviewExplanation {
  if (opts.available) return { kind: "available" };
  switch (policy) {
    case "never":
      return { kind: "never" };
    case "after_submit":
      return { kind: "after_submit" };
    case "after_close":
      return { kind: "after_close", at: opts.effectiveClosesAt };
    case "manual":
      return { kind: "manual", releasedAt: opts.answersReleasedAt };
  }
}

export type QuizResponse = { choice: string } | { choices: string[] } | { text: string } | null;

/** True when a saved/current response counts as an answer (blank text and empty selections do not). */
export function isAnswered(type: QuestionType, response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  const r = response as { choice?: unknown; choices?: unknown; text?: unknown };
  if (type === "short_answer") return typeof r.text === "string" && r.text.trim() !== "";
  if (type === "multiple_select") return Array.isArray(r.choices) && r.choices.length > 0;
  return typeof r.choice === "string" && r.choice !== "";
}

export const SHORT_ANSWER_MAX = 10_000;

/**
 * Validates a learner response for a question type before it is sent to the database
 * (which validates again against the question's real choices). Returns "invalid" when the
 * shape is wrong. An empty selection or blank text is stored as null (cleared answer).
 */
export function normalizeResponse(type: QuestionType, raw: unknown): QuizResponse | "invalid" {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const r = raw as { choice?: unknown; choices?: unknown; text?: unknown };
  if (type === "single_choice" || type === "true_false") {
    if (r.choice === null || r.choice === undefined || r.choice === "") return null;
    return typeof r.choice === "string" && r.choice.length <= 64 ? { choice: r.choice } : "invalid";
  }
  if (type === "multiple_select") {
    if (!Array.isArray(r.choices) || r.choices.length > 20) return "invalid";
    if (!r.choices.every((c) => typeof c === "string" && c.length > 0 && c.length <= 64)) return "invalid";
    const unique = Array.from(new Set(r.choices as string[]));
    return unique.length === 0 ? null : { choices: unique };
  }
  if (typeof r.text !== "string" || r.text.length > SHORT_ANSWER_MAX) return "invalid";
  return r.text.trim() === "" ? null : { text: r.text };
}

/** Responses compare equal regardless of selection order. */
export function sameResponse(a: QuizResponse, b: QuizResponse): boolean {
  if (a === null || b === null) return a === b;
  if ("choice" in a && "choice" in b) return a.choice === b.choice;
  if ("text" in a && "text" in b) return a.text === b.text;
  if ("choices" in a && "choices" in b) {
    if (a.choices.length !== b.choices.length) return false;
    const s = new Set(a.choices);
    return b.choices.every((c) => s.has(c));
  }
  return false;
}
