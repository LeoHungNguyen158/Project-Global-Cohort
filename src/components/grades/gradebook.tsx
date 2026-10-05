import Link from "next/link";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { OfferingAccess } from "@/lib/data/offering-access";
import { offeringTitle } from "@/lib/data/offerings";
import {
  GRADEBOOK_STATUS_FILTERS,
  cellMatches,
  formatPoints,
  isGradebookStatusFilter,
  matchesSearch,
  type CourseTotal,
  type GradebookStatusFilter,
} from "@/lib/domain/grades";
import { formatDateTime } from "@/lib/time";
import { t, type MessageKey } from "@/i18n";
import { Alert } from "@/components/ui/alert";
import { AutoSubmit } from "@/components/ui/auto-submit";
import { buttonClass } from "@/components/ui/button";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, td, th } from "@/components/ui/table";
import { publishGrades } from "@/app/actions/grades";
import { cellKey, learnerTotals, loadGradebook, loadReleasedSnapshots } from "./load";
import { AddGradeItemButton, GradebookGrid } from "./gradebook-grid";
import type { GridCell, GridItem, GridRow, GridTotal } from "./gradebook-types";

export type GradebookSearch = { item?: string; status?: string; q?: string };

export const STATUS_FILTER_LABEL: Record<GradebookStatusFilter, MessageKey> = {
  all: "gradebook.filter.all",
  needs_grading: "gradebook.filter.needsGrading",
  ungraded: "gradebook.filter.ungraded",
  graded: "gradebook.filter.graded",
  missing: "gradebook.filter.missing",
  exempt: "gradebook.filter.exempt",
  unpublished: "gradebook.filter.unpublished",
  published: "gradebook.filter.published",
};

const selectClass = "block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-ink";

function gridTotal(total: CourseTotal): GridTotal {
  return { percent: total.percent, earned: total.earned, possible: total.possible };
}

/**
 * Staff gradebook for one offering (course Grades tab). Data is read as the signed-in
 * staff member; set/publish/unpublish are authorized again by the database.
 */
export async function Gradebook({ access, search }: { access: OfferingAccess; search: GradebookSearch }) {
  const { offering, user } = access;
  const tz = user.timezone;
  const db = await createClient();
  const [data, released] = await Promise.all([loadGradebook(db, offering.id), loadReleasedSnapshots(db, offering.id)]);
  const readOnly = offering.status === "archived";
  const permissions = { canGrade: access.canGrade, canPublish: access.canPublishGrades, canAuthor: access.canAuthor, readOnly };
  const base = `/courses/${offering.id}/grades`;

  const itemFilter = data.items.find((i) => i.id === search.item) ?? null;
  const status: GradebookStatusFilter = isGradebookStatusFilter(search.status) ? search.status : "all";
  const q = (search.q ?? "").trim().slice(0, 100);
  const columns = itemFilter ? [itemFilter] : data.items;
  const filterActive = Boolean(itemFilter) || status !== "all" || q !== "";

  const gradesPerItem = new Map<string, number>();
  for (const c of data.cells.values()) if (c.grade) gradesPerItem.set(c.itemId, (gradesPerItem.get(c.itemId) ?? 0) + 1);

  const gridItems: GridItem[] = columns.map((it) => ({
    id: it.id,
    title: it.title,
    kind: it.kind,
    maxPoints: formatPoints(it.max_points),
    counts: it.counts_toward_total,
    visible: it.visible_to_learners,
    editable: access.canAuthor && !readOnly && (it.kind === "manual" || it.kind === "participation"),
    hasGrades: (gradesPerItem.get(it.id) ?? 0) > 0,
    workHref: it.assignment_id
      ? `/courses/${offering.id}/assignments/${it.assignment_id}/grade`
      : it.quiz_id
        ? `/courses/${offering.id}/quizzes/${it.quiz_id}`
        : null,
  }));

  const rows: GridRow[] = [];
  const toPublish: { gradeId: string; itemId: string }[] = [];
  for (const learner of data.learners) {
    if (!matchesSearch(learner.name, q)) continue;
    const cells: GridCell[] = columns.map((it) => {
      const c = data.cells.get(cellKey(learner.userId, it.id));
      const g = c?.grade ?? null;
      const cell = c?.cell ?? { entry: "ungraded" as const, publication: "none" as const, needsGrading: false, publishable: false };
      return {
        itemId: it.id,
        gradeId: g?.id ?? null,
        entry: cell.entry,
        publication: cell.publication,
        needsGrading: cell.needsGrading,
        publishable: cell.publishable,
        points: g && g.status === "graded" && g.points !== null ? formatPoints(g.points) : null,
        feedback: g?.feedback ?? "",
        publishedAt: c?.releasedAt ? formatDateTime(c.releasedAt, tz) : null,
        match: cellMatches(cell, status),
      };
    });
    if (status !== "all" && !cells.some((c) => c.match)) continue;
    for (const c of cells) if (c.match && c.publishable && c.gradeId) toPublish.push({ gradeId: c.gradeId, itemId: c.itemId });
    const totals = learnerTotals(learner, data.items, data.cells, released);
    rows.push({
      userId: learner.userId,
      name: learner.name,
      enrollmentStatus: learner.enrollmentStatus,
      cells,
      released: gridTotal(totals.released),
      working: gridTotal(totals.working),
    });
  }

  const publishByItem = columns
    .map((it) => ({ title: it.title, count: toPublish.filter((p) => p.itemId === it.id).length }))
    .filter((x) => x.count > 0);
  const publishCount = toPublish.length;
  const course = offeringTitle(offering);
  const caption = t("gradebook.caption", { course, learners: rows.length, items: columns.length });
  const reasonId = "publish-unavailable-reason";

  return (
    <div className="space-y-8">
      <section aria-labelledby="gradebook-heading" className="space-y-4">
        <div className="max-w-3xl">
          <h2 id="gradebook-heading" className="text-xl font-semibold">{t("gradebook.heading")}</h2>
          <p className="mt-1 text-sm text-muted">{t("gradebook.intro")}</p>
        </div>
        {readOnly ? <Alert tone="warning">{t("gradebook.archivedReadOnly")}</Alert> : null}
        {!access.canGrade && !readOnly ? <Alert tone="info">{t("gradebook.noGradePermission")}</Alert> : null}

        <div role="group" aria-label={t("gradebook.actions")} className="flex flex-wrap items-start gap-2">
          {readOnly ? null : access.canPublishGrades ? (
            <ConfirmForm
              action={publishGrades}
              fields={{ offering_id: offering.id }}
              trigger={
                publishCount === 0
                  ? t("gradebook.publishConfirm")
                  : publishCount === 1
                    ? t("gradebook.publishButtonOne")
                    : t("gradebook.publishButton", { count: publishCount })
              }
              triggerVariant="primary"
              disabled={publishCount === 0}
              title={publishCount === 1 ? t("gradebook.publishTitleOne") : t("gradebook.publishTitle", { count: publishCount })}
              description={t("gradebook.publishDescription")}
              confirmLabel={t("gradebook.publishConfirm")}
            >
              <div className="space-y-2 text-sm">
                <p className="font-medium">{t("gradebook.publishSummary")}</p>
                <ul className="list-disc space-y-0.5 pl-5" data-testid="publish-summary">
                  {publishByItem.map((p) => (
                    <li key={p.title} className="[overflow-wrap:anywhere]">
                      {p.count === 1 ? t("gradebook.publishSummaryItemOne", { item: p.title }) : t("gradebook.publishSummaryItem", { item: p.title, count: p.count })}
                    </li>
                  ))}
                </ul>
                <p className="text-muted">{t("gradebook.publishScope")}</p>
              </div>
              {toPublish.map((p) => (
                <input key={p.gradeId} type="hidden" name="grade_id" value={p.gradeId} />
              ))}
            </ConfirmForm>
          ) : (
            <div className="max-w-md">
              <button type="button" disabled aria-describedby={reasonId} className={buttonClass("primary")}>
                {t("gradebook.publishConfirm")}
              </button>
              <p id={reasonId} className="mt-1 text-sm text-muted">{t("gradebook.noPublishPermission")}</p>
            </div>
          )}
          {readOnly ? null : access.canAuthor ? (
            <AddGradeItemButton offeringId={offering.id} />
          ) : (
            <p className="max-w-md self-center text-sm text-muted">{t("gradebook.noAuthorPermission")}</p>
          )}
          <a href={`/api/grades/${offering.id}/export`} download className={buttonClass("secondary")} aria-describedby="export-hint">
            <Download aria-hidden="true" className="h-4 w-4" />
            {t("gradebook.export")}
          </a>
          <p id="export-hint" className="basis-full text-xs text-muted">{t("gradebook.exportHint")}</p>
          {access.canPublishGrades && !readOnly && publishCount === 0 ? (
            <p className="basis-full text-sm text-muted">{t("gradebook.publishNone")}</p>
          ) : null}
        </div>

        <form method="get" action={base} role="search" aria-label={t("gradebook.filters")} className="flex flex-wrap items-end gap-3 rounded-[var(--radius-panel)] border border-line bg-panel p-3">
          <div className="min-w-0 flex-[1_1_12rem]">
            <label htmlFor="gb-item" className="block text-xs text-muted">{t("gradebook.filterItem")}</label>
            <select id="gb-item" name="item" defaultValue={itemFilter?.id ?? ""} className={selectClass}>
              <option value="">{t("gradebook.allItems")}</option>
              {data.items.map((it) => (
                <option key={it.id} value={it.id}>{it.title}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0 flex-[1_1_10rem]">
            <label htmlFor="gb-status" className="block text-xs text-muted">{t("gradebook.filterStatus")}</label>
            <select id="gb-status" name="status" defaultValue={status} className={selectClass}>
              {GRADEBOOK_STATUS_FILTERS.map((f) => (
                <option key={f} value={f}>{t(STATUS_FILTER_LABEL[f])}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0 flex-[2_1_12rem]">
            <label htmlFor="gb-q" className="block text-xs text-muted">{t("gradebook.search")}</label>
            <input id="gb-q" name="q" type="search" defaultValue={q} maxLength={100} className={selectClass} />
          </div>
          <button type="submit" data-apply className={buttonClass("secondary")}>{t("gradebook.apply")}</button>
          {filterActive ? (
            <Link href={base} className="inline-flex min-h-10 items-center text-sm text-primary underline underline-offset-2">
              {t("gradebook.clear")}
            </Link>
          ) : null}
          <AutoSubmit />
        </form>

        {data.learners.length === 0 ? (
          <EmptyState title={t("gradebook.noLearners")} />
        ) : data.items.length === 0 ? (
          <EmptyState title={t("gradebook.noItems")} />
        ) : (
          <>
            <p className="text-sm text-muted" aria-live="polite">{t("gradebook.showing", { shown: rows.length, total: data.learners.length })}</p>
            {rows.length === 0 ? (
              <EmptyState
                title={t("gradebook.noMatches")}
                action={
                  <Link href={base} className={buttonClass("secondary")}>
                    {t("gradebook.clear")}
                  </Link>
                }
              />
            ) : (
              <GradebookGrid
                key={`${itemFilter?.id ?? "all"}:${status}:${q}`}
                offeringId={offering.id}
                caption={caption}
                items={gridItems}
                rows={rows}
                permissions={permissions}
                filterActive={filterActive}
              />
            )}
          </>
        )}
      </section>

      <section id="needs-grading" aria-labelledby="queue-heading" className="scroll-mt-24 space-y-3">
        <h2 id="queue-heading" className="text-lg font-semibold">{t("gradebook.queue", { count: data.queue.length })}</h2>
        {data.queue.length === 0 ? (
          <p className="text-sm text-muted">{t("gradebook.queueEmpty")}</p>
        ) : (
          <Table caption={t("gradebook.queueCaption")} captionHidden>
            <thead>
              <tr>
                <th scope="col" className={th}>{t("gradebook.learner")}</th>
                <th scope="col" className={th}>{t("gradebook.queueWork")}</th>
                <th scope="col" className={th}>{t("gradebook.queueSubmitted")}</th>
                <th scope="col" className={th}>{t("gradebook.queueAction")}</th>
              </tr>
            </thead>
            <tbody>
              {data.queue.map((e) => (
                <tr key={e.key}>
                  <td className={td}>{e.learner}</td>
                  <td className={td}>
                    <span className="block font-medium [overflow-wrap:anywhere]">{e.itemTitle}</span>
                    <span className="text-xs text-muted">
                      {e.kind === "submission" ? t("gradebook.queueSubmission") : t("gradebook.queueAttempt", { number: e.attemptNo ?? 1 })}
                    </span>
                  </td>
                  <td className={td}>{e.submittedAt ? formatDateTime(e.submittedAt, tz) : "—"}</td>
                  <td className={td}>
                    <Link href={e.href} className="text-primary underline underline-offset-2" aria-label={t("gradebook.queueGradeLabel", { item: e.itemTitle, learner: e.learner })}>
                      {t("gradebook.queueGrade")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="calc-heading" className="max-w-3xl space-y-2">
        <h2 id="calc-heading" className="text-lg font-semibold">{t("gradebook.calcHeading")}</h2>
        <p className="text-sm text-muted">{t("grades.calculation")}</p>
        <p className="text-sm text-muted">{t("gradebook.totalsHelp")}</p>
      </section>
    </div>
  );
}
