// Completion report shaping and CSV export. Pure functions (unit tested).
import { toCsv } from "@/lib/domain/grades";
import { t } from "@/i18n";

export type CompletionRow = {
  user_id: string;
  display_name: string;
  enrollment_status: string;
  required_total: number;
  required_completed: number;
  completed_at: string | null;
};

/** Whole-number share of required lessons completed; null when there are none. */
export function progressPercent(done: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  const pct = Math.floor((Math.max(0, Math.min(done, total)) / total) * 100);
  return pct;
}

export type CompletionSummary = { enrollments: number; active: number; finished: number; averagePercent: number | null };

/** Counts for the report header. Average progress covers active and completed enrollments. */
export function summarizeCompletion(rows: CompletionRow[]): CompletionSummary {
  const counted = rows.filter((r) => r.enrollment_status === "active" || r.enrollment_status === "completed");
  const percents = counted.map((r) => progressPercent(r.required_completed, r.required_total)).filter((p): p is number => p !== null);
  return {
    enrollments: rows.length,
    active: rows.filter((r) => r.enrollment_status === "active").length,
    finished: rows.filter((r) => r.completed_at).length,
    averagePercent: percents.length > 0 ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : null,
  };
}

/**
 * CSV for spreadsheet programs: names and progress only (no email addresses), cells
 * that could be read as formulas are neutralized by csvCell, times are UTC ISO 8601.
 */
export function completionCsv(rows: CompletionRow[]): string {
  const header = [
    t("admin.reports.csv.learner"),
    t("admin.reports.csv.enrollmentStatus"),
    t("admin.reports.csv.requiredCompleted"),
    t("admin.reports.csv.requiredTotal"),
    t("admin.reports.csv.percent"),
    t("admin.reports.csv.completedAt"),
  ];
  const body = rows.map((r) => [
    r.display_name,
    r.enrollment_status,
    r.required_completed,
    r.required_total,
    progressPercent(r.required_completed, r.required_total) ?? "",
    r.completed_at ? new Date(r.completed_at).toISOString() : "",
  ]);
  return toCsv([header, ...body]);
}

/** Safe download name, for example completion-AAF-F26-2026-10-05.csv. */
export function completionFilename(code: string, now = new Date()): string {
  const safe = code.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64) || "offering";
  return `completion-${safe}-${now.toISOString().slice(0, 10)}.csv`;
}
