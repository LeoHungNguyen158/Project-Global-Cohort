import Link from "next/link";
import { AccentBar } from "@/components/ui/panel";
import { cn } from "@/components/ui/cn";
import { offeringPhase, offeringTitle, type OfferingSummary } from "@/lib/data/offerings";
import { formatPercent } from "@/lib/domain/grades";
import { formatDate } from "@/lib/time";
import { t } from "@/i18n";
import type { LearnerOfferingGrades, StaffSummary } from "./load";

export type OverviewEntry =
  | { role: "learner"; offering: OfferingSummary; completed: boolean; grades: LearnerOfferingGrades | null }
  | { role: "instructor" | "ta"; offering: OfferingSummary; canPublish: boolean; summary: StaffSummary | null };

const chip = "inline-flex min-h-10 items-center rounded-full border px-3 text-sm font-medium underline-offset-2 hover:underline";

function LearnerSide({ entry }: { entry: Extract<OverviewEntry, { role: "learner" }> }) {
  const o = entry.offering;
  const g = entry.grades;
  const percent = formatPercent(g?.total.percent ?? null);
  const total = g?.rows.length ?? 0;
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <span className="text-xs text-muted">{t("grades.pillLabel")}</span>
      <span
        data-testid="grade-pill"
        className={cn(
          "inline-flex min-h-8 items-center rounded-full px-3 text-sm font-semibold tabular-nums",
          percent ? "bg-sidebar text-white" : "border border-line bg-canvas text-ink",
        )}
      >
        {percent ?? t("grades.noReleased")}
      </span>
      {total > 0 ? <span className="text-xs text-muted">{t("grades.itemsReleased", { released: g?.releasedCount ?? 0, total })}</span> : null}
      <Link href={`/grades/${o.id}`} className="text-sm font-medium text-primary underline underline-offset-2">
        {t("grades.viewAllWork", { count: total })}
        <span className="sr-only">: {offeringTitle(o)}</span>
      </Link>
    </div>
  );
}

function StaffSide({ entry }: { entry: Extract<OverviewEntry, { role: "instructor" | "ta" }> }) {
  const o = entry.offering;
  const s = entry.summary;
  const gradebook = `/courses/${o.id}/grades`;
  const toGrade = s ? s.submissions_to_grade + s.attempts_to_grade : 0;
  const toPublish = s?.grades_to_publish ?? 0;
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      {s === null ? (
        <p className="text-sm text-muted">{t("grades.summaryUnavailable")}</p>
      ) : toGrade === 0 && toPublish === 0 ? (
        <p className="text-sm text-muted">{t("grades.caughtUp")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2 sm:justify-end">
          {toGrade > 0 ? (
            <li>
              <Link href={`${gradebook}#needs-grading`} className={cn(chip, "border-[#c7d6fb] bg-primary-soft text-primary")}>
                {toGrade === 1 ? t("grades.toGradeOne") : t("grades.toGrade", { count: toGrade })}
                <span className="sr-only">: {offeringTitle(o)}</span>
              </Link>
            </li>
          ) : null}
          {toPublish > 0 && entry.canPublish ? (
            <li>
              <Link href={`${gradebook}?status=unpublished`} className={cn(chip, "border-[#fde68a] bg-warning-soft text-ink")}>
                {toPublish === 1 ? t("grades.postOne") : t("grades.postGrades", { count: toPublish })}
                <span className="sr-only">: {offeringTitle(o)}</span>
              </Link>
            </li>
          ) : null}
          {toPublish > 0 && !entry.canPublish ? (
            <li className="text-sm">
              {t("grades.awaitingPublication", { count: toPublish })}
              <span className="block text-xs text-muted">{t("grades.publishNeedsPermission")}</span>
            </li>
          ) : null}
        </ul>
      )}
      {s ? <span className="text-xs text-muted">{t("grades.learnerCount", { count: s.learners })}</span> : null}
      <Link href={gradebook} className="text-sm font-medium text-primary underline underline-offset-2">
        {t("grades.openGradebook")}
        <span className="sr-only">: {offeringTitle(o)}</span>
      </Link>
    </div>
  );
}

function roleLabel(entry: OverviewEntry): string {
  if (entry.role !== "learner") return entry.role === "instructor" ? t("grades.roleInstructor") : t("grades.roleTa");
  return entry.completed ? t("grades.roleCompleted") : t("grades.roleLearner");
}

/** One offering on /grades: accent bar, code and title, then the learner or staff summary. */
export function OverviewCard({ entry, tz }: { entry: OverviewEntry; tz: string }) {
  const o = entry.offering;
  const phase = offeringPhase(o);
  const title = offeringTitle(o);
  const href = entry.role === "learner" ? `/grades/${o.id}` : `/courses/${o.id}/grades`;
  const headingId = `grades-course-${o.id}`;
  return (
    <li>
      <article aria-labelledby={headingId} className="flex rounded-[var(--radius-panel)] border border-line bg-panel">
        <AccentBar color={o.accent_color} />
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-4 p-4 sm:px-6">
          <div className="min-w-0 flex-[1_1_16rem]">
            <p className="text-sm text-muted">
              {o.code}
              {o.cohorts?.name ? ` · ${o.cohorts.name}` : ""}
            </p>
            <h2 id={headingId} className="text-lg font-semibold [overflow-wrap:anywhere]">
              <Link href={href} className="hover:underline">{title}</Link>
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {roleLabel(entry)}
              {phase === "upcoming" && o.starts_at ? ` · ${t("grades.startsOn", { date: formatDate(o.starts_at, tz) })}` : ""}
              {phase === "archived" && o.ends_at ? ` · ${t("grades.closedOn", { date: formatDate(o.ends_at, tz) })}` : ""}
            </p>
          </div>
          {entry.role === "learner" ? <LearnerSide entry={entry} /> : <StaffSide entry={entry} />}
        </div>
      </article>
    </li>
  );
}
