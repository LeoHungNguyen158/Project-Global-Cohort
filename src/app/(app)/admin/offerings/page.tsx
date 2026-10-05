import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/access";
import { listAdminCohorts, listAdminOfferings } from "@/lib/admin/data";
import { isUuid } from "@/lib/forms";
import { formatDate } from "@/lib/time";
import { PageBody } from "@/components/ui/page-header";
import { Table, td, th } from "@/components/admin/scroll-table";
import { EmptyState } from "@/components/ui/empty-state";
import { AutoSubmit } from "@/components/ui/auto-submit";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { OfferingStatusBadge, SectionTitle } from "@/components/admin/badges";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.offerings.title") };

const STATUSES = ["all", "draft", "published", "archived"] as const;
type Status = (typeof STATUSES)[number];
const selectClass = "block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-ink";

export default async function AdminOfferingsPage({ searchParams }: { searchParams: Promise<{ cohort?: string; status?: string; q?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireAdmin("/admin/offerings");
  const tz = ctx.user.timezone;
  const [cohorts, offerings] = await Promise.all([listAdminCohorts(ctx), listAdminOfferings(ctx)]);
  const cohort = isUuid(sp.cohort) && cohorts.some((c) => c.id === sp.cohort) ? sp.cohort : "";
  const status: Status = STATUSES.includes(sp.status as Status) ? (sp.status as Status) : "all";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const needle = q.toLocaleLowerCase();
  const rows = offerings.filter(
    (o) =>
      (!cohort || o.cohort_id === cohort) &&
      (status === "all" || o.status === status) &&
      (!needle || [o.code, o.term_label, o.courses?.code, o.courses?.title, o.course_versions?.title, o.cohorts?.name].join(" ").toLocaleLowerCase().includes(needle)),
  );

  return (
    <PageBody className="space-y-5">
      <SectionTitle
        title={t("admin.offerings.title")}
        description={t("admin.offerings.description")}
        actions={<ButtonLink href="/admin/offerings/new">{t("admin.offerings.new")}</ButtonLink>}
      />
      <form method="get" action="/admin/offerings" role="search" aria-label={t("admin.offerings.filters")} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-[2_1_14rem]">
          <label htmlFor="off-q" className="block text-xs text-muted">{t("admin.common.search")}</label>
          <input id="off-q" name="q" type="search" defaultValue={q} placeholder={t("admin.offerings.searchPlaceholder")} className="block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2" />
        </div>
        <div className="min-w-[10rem] flex-[1_1_10rem]">
          <label htmlFor="off-cohort" className="block text-xs text-muted">{t("admin.common.cohort")}</label>
          <select id="off-cohort" name="cohort" defaultValue={cohort} className={selectClass}>
            <option value="">{t("admin.common.anyCohort")}</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[9rem] flex-[1_1_9rem]">
          <label htmlFor="off-status" className="block text-xs text-muted">{t("admin.common.status")}</label>
          <select id="off-status" name="status" defaultValue={status} className={selectClass}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === "all" ? t("admin.offerings.allStatuses") : t(`admin.offeringStatus.${s}`)}</option>
            ))}
          </select>
        </div>
        <button type="submit" data-apply className={buttonClass("secondary")}>{t("admin.common.apply")}</button>
        <AutoSubmit />
      </form>
      <p className="text-sm" aria-live="polite">{rows.length === 1 ? t("admin.common.result") : t("admin.common.results", { count: rows.length })}</p>
      {rows.length === 0 ? (
        <EmptyState title={offerings.length === 0 ? t("admin.offerings.empty") : t("admin.offerings.noMatch")} />
      ) : (
        <Table caption={t("admin.offerings.caption")} captionHidden>
          <thead>
            <tr>
              <th scope="col" className={th}>{t("admin.common.offering")}</th>
              <th scope="col" className={th}>{t("admin.common.cohort")}</th>
              <th scope="col" className={th}>{t("admin.offerings.termLabel")}</th>
              <th scope="col" className={th}>{t("admin.offerings.dates")}</th>
              <th scope="col" className={th}>{t("admin.offerings.version")}</th>
              <th scope="col" className={th}>{t("admin.common.status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td className={td}>
                  <Link href={`/admin/offerings/${o.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{o.code}</Link>
                  <span className="block text-sm">{o.course_versions?.title ?? o.courses?.title}</span>
                  {o.is_sample ? <Badge className="mt-1">{t("admin.common.sample")}</Badge> : null}
                </td>
                <td className={td}>{o.cohorts?.name ?? "—"}</td>
                <td className={td}>{o.term_label || "—"}</td>
                <td className={`${td} whitespace-nowrap`}>{o.starts_at ? `${formatDate(o.starts_at, tz)} – ${formatDate(o.ends_at, tz) || "…"}` : t("admin.common.notSet")}</td>
                <td className={td}>
                  {o.courses?.code} v{o.course_versions?.version_no}
                  {o.course_versions?.status === "draft" ? <span className="block text-xs text-muted">{t("admin.offerings.draftVersion")}</span> : null}
                </td>
                <td className={td}><OfferingStatusBadge status={o.status} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </PageBody>
  );
}
