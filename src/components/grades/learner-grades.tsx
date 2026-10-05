import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPercent, formatPoints, type LearnerItemState, type TotalExclusion } from "@/lib/domain/grades";
import { formatDateTime, formatWithCourseTime } from "@/lib/time";
import { t, type MessageKey } from "@/i18n";
import type { LearnerGradeRow, LearnerOfferingGrades } from "./load";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const LEARNER_STATE: Record<LearnerItemState, { key: MessageKey; tone: Tone }> = {
  released: { key: "grades.state.released", tone: "success" },
  zero: { key: "grades.state.zero", tone: "warning" },
  missing: { key: "grades.state.missing", tone: "danger" },
  exempt: { key: "grades.state.exempt", tone: "neutral" },
  not_published: { key: "grades.state.notPublished", tone: "info" },
  awaiting_grading: { key: "grades.state.awaitingGrading", tone: "info" },
  returned: { key: "grades.state.returned", tone: "warning" },
  in_progress: { key: "grades.state.inProgress", tone: "info" },
  not_graded: { key: "grades.state.notGraded", tone: "neutral" },
};

const EXCLUSION: Record<TotalExclusion, MessageKey> = {
  not_counted: "grades.total.notCounted",
  hidden: "grades.total.notCounted",
  exempt: "grades.total.exempt",
  no_grade: "grades.total.noGrade",
  invalid_max: "grades.total.invalid",
};

const KIND: Record<LearnerGradeRow["item"]["kind"], MessageKey> = {
  assignment: "grades.kind.assignment",
  quiz: "grades.kind.quiz",
  participation: "grades.kind.participation",
  manual: "grades.kind.manual",
};

/** "35 / 40", "0 / 40" for missing work, or a dash when there is no released score. */
export function learnerScore(row: LearnerGradeRow): string {
  const r = row.released;
  if (!r) return t("grades.noScore");
  if (r.status === "missing") return t("grades.scoreMissing", { max: formatPoints(r.max_points) });
  if (r.status === "exempt" || r.points === null) return t("grades.noScore");
  return t("grades.score", { points: formatPoints(r.points), max: formatPoints(r.max_points) });
}

function DueLine({ row, tz, courseTz }: { row: LearnerGradeRow; tz: string; courseTz: string }) {
  if (!row.dueAt) return <>{t("grades.noDueDate")}</>;
  const when = formatWithCourseTime(row.dueAt, tz, courseTz);
  return (
    <>
      {row.dueKind === "closes" ? t("grades.closesOn", { date: when }) : t("grades.dueOn", { date: when })}
      {row.extended ? <> ({t("grades.extendedForYou")})</> : null}
    </>
  );
}

function Rubric({ row }: { row: LearnerGradeRow }) {
  const scores = row.released?.rubric_scores;
  if (!row.released || row.rubric.length === 0 || !scores || Object.keys(scores).length === 0) return null;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[16rem] border-collapse text-left text-sm">
        <caption className="pb-1 text-left font-semibold">{t("grades.rubricCaption", { item: row.item.title })}</caption>
        <thead>
          <tr>
            <th scope="col" className="border-b border-line py-1 pr-3 font-medium text-muted">{t("grades.rubricCriterion")}</th>
            <th scope="col" className="border-b border-line py-1 text-right font-medium text-muted">{t("grades.rubricPoints")}</th>
          </tr>
        </thead>
        <tbody>
          {row.rubric.map((c) => {
            const v = scores[c.id];
            return (
              <tr key={c.id}>
                <th scope="row" className="border-b border-line py-1.5 pr-3 font-normal">
                  {c.criterion}
                  {c.description ? <span className="block text-xs text-muted">{c.description}</span> : null}
                </th>
                <td className="border-b border-line py-1.5 text-right tabular-nums">
                  {v === undefined || v === null ? t("grades.rubricNotScored") : t("grades.score", { points: formatPoints(v), max: formatPoints(c.points) })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ItemCard({ row, tz, courseTz }: { row: LearnerGradeRow; tz: string; courseTz: string }) {
  const state = LEARNER_STATE[row.state];
  const id = `item-${row.item.id}`;
  const r = row.released;
  return (
    <li>
      <article
        id={id}
        aria-labelledby={`${id}-title`}
        className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-panel p-4 target:border-primary target:ring-2 target:ring-primary sm:p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-[1_1_16rem]">
            <h3 id={`${id}-title`} className="text-base font-semibold [overflow-wrap:anywhere]">{row.item.title}</h3>
            <p className="mt-0.5 text-sm text-muted">
              {t(KIND[row.item.kind])}
              <span aria-hidden="true"> · </span>
              <DueLine row={row} tz={tz} courseTz={courseTz} />
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <Badge tone={state.tone}>{t(state.key)}</Badge>
            <p className="text-lg font-semibold tabular-nums">
              <span className="sr-only">{t("grades.colScore")}: </span>
              {learnerScore(row)}
            </p>
          </div>
        </div>

        <p className="mt-2 text-sm">
          <span className="font-medium">{t("grades.colTotal")}: </span>
          {row.exclusion === null ? t("grades.total.counted") : t(EXCLUSION[row.exclusion])}
          {r?.status === "missing" ? <> · {t("grades.missingNote")}</> : null}
          {r?.status === "exempt" ? <> · {t("grades.exemptNote")}</> : null}
        </p>
        {row.newerWorkPending ? <p className="mt-1 text-sm text-muted">{t("grades.newerWorkPending")}</p> : null}

        {r ? (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-xs text-muted">{t("grades.releasedOn", { date: formatDateTime(r.released_at, tz) })}</p>
            <h4 className="mt-2 text-sm font-semibold">{t("grades.feedback")}</h4>
            {r.feedback.trim() ? (
              <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{r.feedback}</p>
            ) : (
              <p className="mt-1 text-sm text-muted">{t("grades.noFeedback")}</p>
            )}
            <Rubric row={row} />
          </div>
        ) : null}

        {row.href ? (
          <p className="mt-3 text-sm">
            <Link href={row.href} className="text-primary underline underline-offset-2">
              {row.item.kind === "quiz" ? t("grades.openQuiz") : t("grades.openAssignment")}
              <span className="sr-only">: {row.item.title}</span>
            </Link>
          </p>
        ) : null}
      </article>
    </li>
  );
}

/**
 * A learner's own grades for one offering: the running total with an explicit list of
 * what is counted, then every grade item with its status. Used by /grades/[offeringId]
 * and the course Grades tab. Only released grades and the learner's own work are shown.
 */
export function LearnerGrades({
  data,
  courseTitle,
  courseTz,
  tz,
}: {
  data: LearnerOfferingGrades;
  courseTitle: string;
  courseTz: string;
  tz: string;
}) {
  const { total, rows } = data;
  const titleOf = new Map(rows.map((r) => [r.item.id, r.item.title]));
  const rowOf = new Map(rows.map((r) => [r.item.id, r]));
  const percent = formatPercent(total.percent);
  return (
    <div className="space-y-6">
      <section aria-labelledby="grades-total" className="rounded-[var(--radius-panel)] border border-line bg-panel p-4 sm:p-6">
        <h2 id="grades-total" className="text-lg font-semibold">{t("grades.summaryHeading")}</h2>
        <p className="mt-2 text-2xl font-semibold tabular-nums" data-testid="running-total">
          {percent ? t("grades.totalValue", { percent, earned: total.earned, possible: total.possible }) : t("grades.noReleased")}
        </p>
        <dl className="mt-4 grid gap-4 text-sm md:grid-cols-2">
          <div>
            <dt className="font-semibold">{t("grades.countedLabel")}</dt>
            <dd className="mt-1">
              {total.included.length === 0 ? (
                <span className="text-muted">{t("grades.countedNone")}</span>
              ) : (
                <ul className="space-y-0.5">
                  {total.included.map((id) => (
                    <li key={id} className="[overflow-wrap:anywhere]">
                      <a href={`#item-${id}`} className="underline underline-offset-2">{titleOf.get(id)}</a>: <span className="tabular-nums">{learnerScore(rowOf.get(id)!)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">{t("grades.notCountedLabel")}</dt>
            <dd className="mt-1">
              {total.excluded.length === 0 ? (
                <span className="text-muted">{t("grades.countedNone")}</span>
              ) : (
                <ul className="space-y-0.5">
                  {total.excluded.map((e) => (
                    <li key={e.id} className="[overflow-wrap:anywhere]">
                      <a href={`#item-${e.id}`} className="underline underline-offset-2">{titleOf.get(e.id)}</a>: {t(EXCLUSION[e.reason])}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
        <Disclosure summary={t("grades.howCalculated")} className="mt-4" summaryClassName="text-primary">
          <p className="max-w-3xl text-sm text-muted">{t("grades.calculation")}</p>
        </Disclosure>
      </section>

      <section aria-labelledby="grades-items">
        <h2 id="grades-items" className="mb-3 text-lg font-semibold">{t("grades.itemsHeading")}</h2>
        {rows.length === 0 ? (
          <EmptyState title={t("grades.noItems")}>{t("grades.emptyLearner")}</EmptyState>
        ) : (
          <ul className="space-y-3" aria-label={t("grades.itemsCaption", { course: courseTitle })}>
            {rows.map((row) => (
              <ItemCard key={row.item.id} row={row} tz={tz} courseTz={courseTz} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
