import Decimal from "decimal.js";

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

/**
 * Points-based running total over RELEASED grades only.
 * - graded: earned = points, possible += max
 * - missing: earned = 0 (counts as zero), possible += max
 * - exempt: excluded from numerator and denominator
 * - ungraded / not yet released: excluded (they never reach this function)
 * Display rounding: percent rounded half-up to 2 decimal places.
 */
export function runningTotal(grades: ReleasedGrade[]): RunningTotal {
  let earned = new Decimal(0);
  let possible = new Decimal(0);
  let included = 0;
  for (const g of grades) {
    if (!g.counts_toward_total || g.status === "exempt") continue;
    const max = new Decimal(g.max_points);
    if (max.lte(0)) continue;
    if (g.status === "missing") {
      possible = possible.plus(max);
      included++;
    } else if (g.status === "graded" && g.points !== null && g.points !== undefined) {
      earned = earned.plus(new Decimal(g.points));
      possible = possible.plus(max);
      included++;
    }
  }
  return {
    earned: earned.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(),
    possible: possible.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(),
    percent: possible.isZero() ? null : earned.div(possible).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
    included,
  };
}

export function formatPoints(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString();
}

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
