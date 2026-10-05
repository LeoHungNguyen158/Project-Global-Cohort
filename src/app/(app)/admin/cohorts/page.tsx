import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/access";
import { listAdminCohorts, listAdminOfferings } from "@/lib/admin/data";
import { createClient } from "@/lib/supabase/server";
import { createCohort } from "@/app/actions/admin/cohorts";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, td, th } from "@/components/admin/scroll-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Disclosure } from "@/components/ui/disclosure";
import { Badge } from "@/components/ui/badge";
import { CohortStatusBadge, SectionTitle } from "@/components/admin/badges";
import { CohortFields } from "@/components/admin/cohort-fields";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.cohorts.title") };

export default async function AdminCohortsPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireAdmin("/admin/cohorts");
  const showArchived = sp.archived === "1";
  const [cohorts, offerings] = await Promise.all([listAdminCohorts(ctx), listAdminOfferings(ctx)]);
  const supabase = await createClient();
  const ids = cohorts.map((c) => c.id);
  const { data: participation } = ids.length
    ? await supabase.from("cohort_participation").select("cohort_id").in("cohort_id", ids).eq("status", "active")
    : { data: [] as { cohort_id: string }[] };
  const participants = new Map<string, number>();
  for (const p of participation ?? []) participants.set(p.cohort_id, (participants.get(p.cohort_id) ?? 0) + 1);
  const offeringCount = new Map<string, number>();
  for (const o of offerings) offeringCount.set(o.cohort_id, (offeringCount.get(o.cohort_id) ?? 0) + 1);
  const visible = cohorts.filter((c) => showArchived || c.status !== "archived");
  const archivedCount = cohorts.length - cohorts.filter((c) => c.status !== "archived").length;

  return (
    <PageBody className="space-y-6">
      <SectionTitle title={t("admin.cohorts.title")} description={t("admin.cohorts.description")} />

      {ctx.isPlatformAdmin ? (
        <Panel aria-labelledby="new-cohort">
          <PanelHeader id="new-cohort" title={t("admin.cohorts.newTitle")} />
          <div className="p-4 sm:px-6">
            <Disclosure summary={t("admin.cohorts.newShow")} summaryClassName="text-primary">
              <ActionForm action={createCohort} className="space-y-4">
                <CohortFields idPrefix="new-cohort" />
                <SubmitButton>{t("admin.cohorts.create")}</SubmitButton>
              </ActionForm>
            </Disclosure>
          </div>
        </Panel>
      ) : (
        <p className="text-sm text-muted">{t("admin.cohorts.coordinatorNote")}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" aria-live="polite">{visible.length === 1 ? t("admin.common.result") : t("admin.common.results", { count: visible.length })}</p>
        {archivedCount > 0 ? (
          <Link href={showArchived ? "/admin/cohorts" : "/admin/cohorts?archived=1"} className="inline-flex min-h-10 items-center text-sm text-primary underline-offset-2 hover:underline">
            {showArchived ? t("admin.cohorts.hideArchived") : t("admin.cohorts.showArchived", { count: archivedCount })}
          </Link>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <EmptyState title={t("admin.cohorts.empty")} />
      ) : (
        <Table caption={t("admin.cohorts.caption")} captionHidden>
          <thead>
            <tr>
              <th scope="col" className={th}>{t("admin.cohorts.name")}</th>
              <th scope="col" className={th}>{t("admin.common.code")}</th>
              <th scope="col" className={th}>{t("admin.common.status")}</th>
              <th scope="col" className={th}>{t("admin.cohorts.dates")}</th>
              <th scope="col" className={th}>{t("admin.cohorts.timezone")}</th>
              <th scope="col" className={th}>{t("admin.cohorts.participants")}</th>
              <th scope="col" className={th}>{t("admin.nav.offerings")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.id}>
                <td className={td}>
                  <Link href={`/admin/cohorts/${c.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{c.name}</Link>
                  {c.is_sample ? <Badge className="ml-2">{t("admin.common.sample")}</Badge> : null}
                </td>
                <td className={`${td} whitespace-nowrap`}>{c.code}</td>
                <td className={td}><CohortStatusBadge status={c.status} /></td>
                <td className={`${td} whitespace-nowrap`}>{c.starts_on || c.ends_on ? `${c.starts_on ?? "…"} – ${c.ends_on ?? "…"}` : t("admin.common.notSet")}</td>
                <td className={td}>{c.timezone}</td>
                <td className={`${td} tabular-nums`}>{participants.get(c.id) ?? 0}</td>
                <td className={`${td} tabular-nums`}>{offeringCount.get(c.id) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </PageBody>
  );
}
