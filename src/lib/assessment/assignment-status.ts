// Display states for assignments, derived from database rows (the database decides what is
// accepted; these helpers only explain it).

export type SubmissionTypeKey = "text" | "file" | "url";
export const SUBMISSION_TYPES: SubmissionTypeKey[] = ["text", "file", "url"];
export type LatePolicy = "accept_flag" | "reject";
export type SubmissionStatus = "draft" | "submitted" | "returned" | "graded";

export type LearnerAssignmentState =
  | "not_started"
  | "draft"
  | "submitted"
  | "late"
  | "returned"
  | "graded_unreleased"
  | "graded";

/**
 * What a learner sees as the status of their work. "Late" is the submitted state of a
 * version flagged late. A graded submission shows its grade only once released; before that
 * the learner sees that grading happened, never the points.
 */
export function learnerAssignmentState(input: {
  submission: { status: SubmissionStatus; submitted_count: number } | null;
  latestVersionLate: boolean | null;
  hasReleasedGrade: boolean;
}): LearnerAssignmentState {
  const s = input.submission;
  if (!s) return "not_started";
  if (s.status === "draft" || s.submitted_count === 0) return "draft";
  if (s.status === "returned") return "returned";
  if (s.status === "graded") return input.hasReleasedGrade ? "graded" : "graded_unreleased";
  return input.latestVersionLate ? "late" : "submitted";
}

export type SubmissionWindow = "not_open" | "open" | "late_allowed" | "late_rejected" | "closed";

/** Mirrors submit_assignment's time checks: available_from, closes_at, then the due date and late policy. */
export function submissionWindow(now: Date, a: { available_from: string | null; due_at: string | null; closes_at: string | null; late_policy: LatePolicy }): SubmissionWindow {
  if (a.available_from && now < new Date(a.available_from)) return "not_open";
  if (a.closes_at && now > new Date(a.closes_at)) return "closed";
  if (a.due_at && now > new Date(a.due_at)) return a.late_policy === "reject" ? "late_rejected" : "late_allowed";
  return "open";
}

export type SubmitBlock =
  | "not_learner"
  | "read_only"
  | "not_open"
  | "closed"
  | "late_rejected"
  | "limit_reached"
  | "graded"
  | null;

/** Why a learner cannot submit right now (null = may submit). The database re-checks every rule. */
export function submitBlock(input: {
  isActiveLearner: boolean;
  readOnly: boolean;
  window: SubmissionWindow;
  submittedCount: number;
  maxSubmissions: number;
  status: SubmissionStatus | null;
}): SubmitBlock {
  if (input.readOnly) return "read_only";
  if (!input.isActiveLearner) return "not_learner";
  if (input.window === "not_open") return "not_open";
  if (input.window === "closed") return "closed";
  if (input.window === "late_rejected") return "late_rejected";
  if (input.status === "graded") return "graded";
  if (input.submittedCount >= input.maxSubmissions) return "limit_reached";
  return null;
}

export type QueueFilter = "all" | "to_grade" | "late" | "returned" | "graded" | "not_submitted";
export const QUEUE_FILTERS: QueueFilter[] = ["all", "to_grade", "late", "returned", "graded", "not_submitted"];

export type QueueRow = { status: SubmissionStatus | null; latestLate: boolean };

/** Staff queue membership; counts use the same predicate so they always match the list. */
export function inQueue(filter: QueueFilter, row: QueueRow): boolean {
  switch (filter) {
    case "all":
      return true;
    case "to_grade":
      return row.status === "submitted";
    case "late":
      return row.status !== null && row.status !== "draft" && row.latestLate;
    case "returned":
      return row.status === "returned";
    case "graded":
      return row.status === "graded";
    case "not_submitted":
      return row.status === null || row.status === "draft";
  }
}

export function queueCounts(rows: QueueRow[]): Record<QueueFilter, number> {
  const counts = { all: 0, to_grade: 0, late: 0, returned: 0, graded: 0, not_submitted: 0 } as Record<QueueFilter, number>;
  for (const r of rows) for (const f of QUEUE_FILTERS) if (inQueue(f, r)) counts[f]++;
  return counts;
}
