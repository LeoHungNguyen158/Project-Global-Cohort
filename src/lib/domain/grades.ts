import Decimal from "decimal.js";

// Grade calculation and gradebook rules, shared by the learner pages, the staff
// gradebook and the CSV export so every surface shows the same numbers.
//
// Documented calculation (points-based, the only scheme offerings support):
// - The running total uses RELEASED grades only (for learners) or the current working
//   grades (staff "working total"); both use exactly the same rules below.
// - Denominator: the max points of every item that counts toward the total, is visible to
//   learners, and has a grade of "graded" (any score, including zero) or "missing".
// - Missing counts as zero earned points. Exempt items are left out of both numerator and
//   denominator. Ungraded, pending and unpublished items are left out until released.
// - Arithmetic uses decimal.js (no binary floating point). Display rounding is
//   half-up: points to at most 2 decimal places, percentages to exactly 2 decimal places.

export type GradeStatus = "graded" | "missing" | "exempt";

export type ReleasedGrade = {
  status: GradeStatus;
  points: number | string | null;
  max_points: number | string;
  counts_toward_total: boolean;
};

export type RunningTotal = {
  earned: string;
  possible: string;
  percent: string | null; // null => "No released grades"
  included: number;
};

const HALF_UP = Decimal.ROUND_HALF_UP;

function displayPoints(d: Decimal): string {
  return d.toDecimalPlaces(2, HALF_UP).toString();
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

/** Why an item is left out of the denominator. */
export type TotalExclusion = "not_counted" | "hidden" | "exempt" | "no_grade" | "invalid_max";

export type TotalInput = {
  id: string;
  /** Max points used for this grade: the released snapshot for released grades. */
  maxPoints: number | string;
  countsTowardTotal: boolean;
  visibleToLearners: boolean;
  grade: { status: GradeStatus | "pending"; points: number | string | null } | null;
};

export type CourseTotal = {
  earned: string;
  possible: string;
  /** Exactly two decimals, e.g. "87.50"; null when nothing is in the denominator. */
  percent: string | null;
  /** Item ids that entered the denominator, in input order. */
  included: string[];
  excluded: { id: string; reason: TotalExclusion }[];
};

function toDecimal(v: number | string | null | undefined): Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    const d = new Decimal(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export function exclusionReason(item: TotalInput): TotalExclusion | null {
  if (!item.countsTowardTotal) return "not_counted";
  if (!item.visibleToLearners) return "hidden";
  const g = item.grade;
  if (!g || g.status === "pending") return "no_grade";
  if (g.status === "exempt") return "exempt";
  if (g.status === "graded" && toDecimal(g.points) === null) return "no_grade";
  const max = toDecimal(item.maxPoints);
  if (!max || max.lte(0)) return "invalid_max";
  return null;
}

/** Points-based total with an explicit list of what entered the denominator. */
export function courseTotal(items: TotalInput[]): CourseTotal {
  let earned = new Decimal(0);
  let possible = new Decimal(0);
  const included: string[] = [];
  const excluded: CourseTotal["excluded"] = [];
  for (const item of items) {
    const reason = exclusionReason(item);
    if (reason) {
      excluded.push({ id: item.id, reason });
      continue;
    }
    possible = possible.plus(new Decimal(item.maxPoints));
    if (item.grade?.status === "graded") earned = earned.plus(new Decimal(item.grade.points as number | string));
    included.push(item.id);
  }
  return {
    earned: displayPoints(earned),
    possible: displayPoints(possible),
    percent: possible.isZero() ? null : earned.div(possible).times(100).toDecimalPlaces(2, HALF_UP).toFixed(2),
    included,
    excluded,
  };
}

/**
 * Points-based running total over RELEASED grades only (kept for existing callers;
 * same rules as courseTotal).
 * - graded: earned = points, possible += max
 * - missing: earned = 0 (counts as zero), possible += max
 * - exempt: excluded from numerator and denominator
 * - ungraded / not yet released: excluded (they never reach this function)
 * Display rounding: percent rounded half-up to 2 decimal places.
 */
export function runningTotal(grades: ReleasedGrade[]): RunningTotal {
  const total = courseTotal(
    grades.map((g, i) => ({
      id: String(i),
      maxPoints: g.max_points,
      countsTowardTotal: g.counts_toward_total,
      visibleToLearners: true,
      grade: { status: g.status, points: g.points },
    })),
  );
  return { earned: total.earned, possible: total.possible, percent: total.percent, included: total.included.length };
}

export function formatPoints(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return new Decimal(v).toDecimalPlaces(2, HALF_UP).toString();
}

/** "87.50%", or null when there is no released total (never a fabricated 0%). */
export function formatPercent(percent: string | null | undefined): string | null {
  return percent === null || percent === undefined ? null : `${percent}%`;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const POINTS_RE = /^\d{1,8}(?:[.,]\d{1,2})?$/;

export type PointsResult = { ok: true; value: number; text: string } | { ok: false; reason: "required" | "format" | "range" };

/**
 * Validates points typed by staff: digits with at most two decimals ("7", "7.5", "7,25"),
 * between 0 and the item's max points inclusive.
 */
export function parsePoints(raw: string | null | undefined, max: number | string): PointsResult {
  const s = (raw ?? "").trim();
  if (s === "") return { ok: false, reason: "required" };
  if (!POINTS_RE.test(s)) return { ok: false, reason: "format" };
  const d = new Decimal(s.replace(",", "."));
  const m = toDecimal(max);
  if (!m || d.lt(0) || d.gt(m)) return { ok: false, reason: "range" };
  return { ok: true, value: d.toNumber(), text: displayPoints(d) };
}

/** Max points for a grade item: greater than 0, at most 999999.99, two decimals. */
export function parseMaxPoints(raw: string | null | undefined): PointsResult {
  const s = (raw ?? "").trim();
  if (s === "") return { ok: false, reason: "required" };
  if (!/^\d{1,6}(?:[.,]\d{1,2})?$/.test(s)) return { ok: false, reason: "format" };
  const d = new Decimal(s.replace(",", "."));
  if (d.lte(0)) return { ok: false, reason: "range" };
  return { ok: true, value: d.toNumber(), text: displayPoints(d) };
}

// ---------------------------------------------------------------------------
// Learner view: one clear state per grade item
// ---------------------------------------------------------------------------

export type LearnerWork =
  | { kind: "assignment"; submissionStatus: "draft" | "submitted" | "returned" | "graded" | null }
  | { kind: "quiz"; attemptStatuses: string[] }
  | { kind: "other" };

export type LearnerItemState =
  | "released" // released, scored above zero
  | "zero" // released, scored zero
  | "missing" // released as missing (counts as zero)
  | "exempt" // released as exempt (not counted)
  | "not_published" // the learner's work was graded, but the grade is not released yet
  | "awaiting_grading" // submitted, waiting for staff
  | "returned" // assignment returned for revision
  | "in_progress" // quiz attempt in progress
  | "not_graded"; // nothing graded or submitted yet

export type ReleasedForLearner = { status: GradeStatus; points: number | string | null } | null;

/**
 * State shown to a learner for one grade item. The learner never receives working
 * grades; "not published" is inferred only from the learner's own submission or
 * attempt status, which they can already see.
 */
export function learnerItemState(released: ReleasedForLearner, work: LearnerWork): { state: LearnerItemState; newerWorkPending: boolean } {
  const pendingWork =
    (work.kind === "assignment" && work.submissionStatus === "submitted") ||
    (work.kind === "quiz" && work.attemptStatuses.includes("submitted"));
  if (released) {
    if (released.status === "missing") return { state: "missing", newerWorkPending: pendingWork };
    if (released.status === "exempt") return { state: "exempt", newerWorkPending: pendingWork };
    const pts = toDecimal(released.points);
    return { state: pts && pts.isZero() ? "zero" : "released", newerWorkPending: pendingWork };
  }
  if (work.kind === "assignment") {
    switch (work.submissionStatus) {
      case "graded":
        return { state: "not_published", newerWorkPending: false };
      case "submitted":
        return { state: "awaiting_grading", newerWorkPending: false };
      case "returned":
        return { state: "returned", newerWorkPending: false };
      default:
        return { state: "not_graded", newerWorkPending: false };
    }
  }
  if (work.kind === "quiz") {
    const live = work.attemptStatuses.filter((s) => s !== "voided");
    if (live.includes("submitted")) return { state: "awaiting_grading", newerWorkPending: false };
    if (live.includes("graded")) return { state: "not_published", newerWorkPending: false };
    if (live.includes("in_progress")) return { state: "in_progress", newerWorkPending: false };
  }
  return { state: "not_graded", newerWorkPending: false };
}

// ---------------------------------------------------------------------------
// Staff gradebook cells
// ---------------------------------------------------------------------------

export type WorkingGrade = { id: string; status: GradeStatus | "pending"; points: number | string | null; dirty: boolean };

export type StaffCell = {
  entry: "ungraded" | "pending" | GradeStatus;
  /** none: nothing to publish; unpublished: never released; changed: learners see an older version. */
  publication: "none" | "unpublished" | "published" | "changed";
  needsGrading: boolean;
  /** Would be released by publish_grades (dirty and not pending). */
  publishable: boolean;
};

export function staffCell(grade: WorkingGrade | null, released: boolean, workAwaitingGrading = false): StaffCell {
  if (!grade) {
    return { entry: "ungraded", publication: released ? "changed" : "none", needsGrading: workAwaitingGrading, publishable: false };
  }
  const publishable = grade.dirty && grade.status !== "pending";
  let publication: StaffCell["publication"];
  if (released) publication = grade.dirty ? "changed" : "published";
  else publication = grade.status === "pending" ? "none" : "unpublished";
  return {
    entry: grade.status,
    publication,
    needsGrading: workAwaitingGrading || grade.status === "pending",
    publishable,
  };
}

export const GRADEBOOK_STATUS_FILTERS = ["all", "needs_grading", "ungraded", "graded", "missing", "exempt", "unpublished", "published"] as const;
export type GradebookStatusFilter = (typeof GRADEBOOK_STATUS_FILTERS)[number];

export function isGradebookStatusFilter(v: unknown): v is GradebookStatusFilter {
  return typeof v === "string" && (GRADEBOOK_STATUS_FILTERS as readonly string[]).includes(v);
}

export function cellMatches(cell: StaffCell, filter: GradebookStatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needs_grading":
      return cell.needsGrading;
    case "ungraded":
      return cell.entry === "ungraded" || cell.entry === "pending";
    case "graded":
    case "missing":
    case "exempt":
      return cell.entry === filter;
    case "unpublished":
      return cell.publishable;
    case "published":
      return cell.publication === "published";
  }
}

// ---------------------------------------------------------------------------
// Search (Vietnamese and other accented names)
// ---------------------------------------------------------------------------

/** Lowercase and remove diacritics so "tran" finds "Trần" and "dang" finds "Đặng". */
export function foldForSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesSearch(text: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (text.toLocaleLowerCase().includes(q.toLocaleLowerCase())) return true;
  return foldForSearch(text).includes(foldForSearch(q));
}

export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" }) || a.localeCompare(b);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Neutralize spreadsheet formula injection in CSV cells and quote safely. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export type CsvItem = { id: string; title: string; maxPoints: number | string };

export type CsvLearnerRow = {
  name: string;
  enrollmentStatus: string;
  cells: Record<string, { cell: StaffCell; points: number | string | null } | undefined>;
  released: CourseTotal;
  working: CourseTotal;
};

export type CsvLabels = {
  learner: string;
  enrollment: string;
  pointsHeader: (title: string, max: string) => string;
  statusHeader: (title: string) => string;
  releasedEarned: string;
  releasedPossible: string;
  releasedPercent: string;
  workingPercent: string;
  cellStatus: (cell: StaffCell) => string;
  enrollmentStatus: (status: string) => string;
};

/**
 * Gradebook export rows: display name and enrollment status only (no emails or account
 * ids), points and status per item, then the released and working totals computed with
 * courseTotal. Every cell goes through csvCell, so formulas are neutralized.
 */
export function gradebookCsv(items: CsvItem[], learners: CsvLearnerRow[], labels: CsvLabels): string {
  const header: unknown[] = [labels.learner, labels.enrollment];
  for (const it of items) header.push(labels.pointsHeader(it.title, formatPoints(it.maxPoints)), labels.statusHeader(it.title));
  header.push(labels.releasedEarned, labels.releasedPossible, labels.releasedPercent, labels.workingPercent);
  const rows: unknown[][] = [header];
  for (const l of learners) {
    const row: unknown[] = [l.name, labels.enrollmentStatus(l.enrollmentStatus)];
    for (const it of items) {
      const c = l.cells[it.id];
      const cell = c?.cell ?? staffCell(null, false);
      const points = cell.entry === "graded" ? formatPoints(c?.points) : cell.entry === "missing" ? "0" : "";
      row.push(points, labels.cellStatus(cell));
    }
    const hasReleased = l.released.percent !== null;
    row.push(hasReleased ? l.released.earned : "", hasReleased ? l.released.possible : "", l.released.percent ?? "", l.working.percent ?? "");
    rows.push(row);
  }
  return toCsv(rows);
}
