import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/access";
import { listAdminOfferings, offeringLabel, type AdminOffering } from "@/lib/admin/data";
import { progressPercent, summarizeCompletion, type CompletionRow } from "@/lib/admin/reports";
import { isUuid } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, td, th } from "@/components/admin/scroll-table";
import { EmptyState } from "@/components/ui/empty-state";
import { AutoSubmit } from "@/components/ui/auto-submit";
import { buttonClass } from "@/components/ui/button";
import { EnrollmentStatusBadge, OfferingStatusBadge, SectionTitle } from "@/components/admin/badges";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.reports.title") };

function groupByCohort(offerings: AdminOffering[]) {
  const groups = new Map<string, { label: string; items: AdminOffering[] }>();
  for (const o of offerings) {
    const key = o.cohort_id;
    const label = o.cohorts ? `${o.cohorts.name} (${o.cohorts.code})` : "—";
    groups.set(key, { label, items: [...(groups.get(key)?.items ?? []), o] });
  }
  return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-panel p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<{ offering?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireAdmin("/admin/reports");
  const tz = ctx.user.timezone;
  const offerings = await listAdminOfferings(ctx);
  const selected = isUuid(sp.offering) ? (offerings.find((o) => o.id === sp.offering) ?? null) : null;

  let rows: CompletionRow[] = [];
  if (selected) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("completion_report", { p_offering: selected.id });
    if (error) throw new Error("Could not load the completion report");
    rows = (data ?? []) as CompletionRow[];
  }
  const summary = summarizeCompletion(rows);
  const requiredTotal = rows[0]?.required_total ?? 0;

  return (
    <PageBody className="space-y-5">
      <SectionTitle title={t("admin.reports.title")} description={t("admin.reports.description")} />
      <form method="get" action="/admin/reports" role="search" aria-label={t("admin.reports.chooseLabel")} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[1_1_18rem]">
          <label htmlFor="report-offering" className="block text-sm font-medium">{t("admin.common.offering")}</label>
          <select
            id="report-offering"
            name="offering"
            defaultValue={selected?.id ?? ""}
            className="block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-ink"
          >
            <option value="" disabled>{t("admin.common.chooseOffering")}</option>
            {groupByCohort(offerings).map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((o) => (
                  <option key={o.id} value={o.id}>{offeringLabel(o)}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <button type="submit" data-apply className={buttonClass("secondary")}>{t("admin.reports.show")}</button>
        <AutoSubmit />
      </form>

      {offerings.length === 0 ? (
        <EmptyState title={t("admin.reports.noOfferings")} />
      ) : !selected ? (
        <p className="text-sm text-muted">{t("admin.reports.pick")}</p>
      ) : (
        <Panel aria-labelledby="report-title">
          <PanelHeader
            id="report-title"
            title={
              <span className="inline-flex flex-wrap items-center gap-2">
                <Link href={`/admin/offerings/${selected.id}`} className="text-primary underline-offset-2 hover:underline [overflow-wrap:anywhere]">{offeringLabel(selected)}</Link>
                <OfferingStatusBadge status={selected.status} />
              </span>
            }
            actions={
              rows.length > 0 ? (
                <a href={`/api/admin/reports/completion/${selected.id}`} download className={buttonClass("secondary", "sm")}>
                  {t("admin.reports.export")}
                </a>
              ) : null
            }
          />
          <div className="space-y-4 p-4 sm:px-6">
            <p className="text-sm text-muted">{t("admin.reports.definition", { count: requiredTotal })}</p>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t("admin.reports.enrollments")} value={String(summary.enrollments)} />
              <Stat label={t("admin.reports.activeEnrollments")} value={String(summary.active)} />
              <Stat label={t("admin.reports.finished")} value={String(summary.finished)} />
              <Stat label={t("admin.reports.average")} value={summary.averagePercent === null ? "—" : `${summary.averagePercent}%`} />
            </dl>
            {rows.length === 0 ? (
              <p className="text-sm text-muted">{t("admin.reports.noLearners")}</p>
            ) : (
              <Table caption={t("admin.reports.caption", { code: selected.code })} captionHidden>
                <thead>
                  <tr>
                    <th scope="col" className={th}>{t("admin.reports.csv.learner")}</th>
                    <th scope="col" className={th}>{t("admin.common.status")}</th>
                    <th scope="col" className={th}>{t("admin.reports.requiredLessons")}</th>
                    <th scope="col" className={th}>{t("admin.reports.progress")}</th>
                    <th scope="col" className={th}>{t("admin.reports.finishedOn")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const pct = progressPercent(r.required_completed, r.required_total);
                    return (
                      <tr key={r.user_id}>
                        <td className={td}>{r.display_name}</td>
                        <td className={td}><EnrollmentStatusBadge status={r.enrollment_status} /></td>
                        <td className={`${td} whitespace-nowrap tabular-nums`}>{t("admin.reports.ofTotal", { done: r.required_completed, total: r.required_total })}</td>
                        <td className={td}>
                          {pct === null ? (
                            "—"
                          ) : (
                            <span className="flex min-w-[8rem] items-center gap-2">
                              <span className="h-2 flex-1 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
                                <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                              </span>
                              <span className="tabular-nums">{pct}%</span>
                            </span>
                          )}
                        </td>
                        <td className={`${td} whitespace-nowrap`}>{r.completed_at ? formatDate(r.completed_at, tz) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
            <p className="text-xs text-muted">{t("admin.reports.csvNote")}</p>
          </div>
        </Panel>
      )}
    </PageBody>
  );
}
