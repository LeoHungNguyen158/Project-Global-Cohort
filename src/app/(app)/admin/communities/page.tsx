import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/access";
import { listAdminCohorts, listAdminCommunities } from "@/lib/admin/data";
import { createClient } from "@/lib/supabase/server";
import { createCommunity } from "@/app/actions/admin/communities";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, td, th } from "@/components/admin/scroll-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Disclosure } from "@/components/ui/disclosure";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/admin/badges";
import { CommunityFields } from "@/components/admin/community-fields";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.communities.title") };

export default async function AdminCommunitiesPage() {
  const ctx = await requireAdmin("/admin/communities");
  const [communities, cohorts] = await Promise.all([listAdminCommunities(ctx), listAdminCohorts(ctx)]);
  const openCohorts = cohorts.filter((c) => c.status !== "archived");
  const supabase = await createClient();
  const ids = communities.map((c) => c.id);
  // Administrators of a community see its member rows (community_members_select).
  const { data: memberRows } = ids.length
    ? await supabase.from("community_members").select("community_id").in("community_id", ids)
    : { data: [] as { community_id: string }[] };
  const members = new Map<string, number>();
  for (const m of memberRows ?? []) members.set(m.community_id, (members.get(m.community_id) ?? 0) + 1);
  const canCreate = ctx.isPlatformAdmin || openCohorts.length > 0;

  return (
    <PageBody className="space-y-6">
      <SectionTitle title={t("admin.communities.title")} description={t("admin.communities.description")} />

      <Panel aria-labelledby="new-community">
        <PanelHeader id="new-community" title={t("admin.communities.newTitle")} />
        <div className="space-y-3 p-4 sm:px-6">
          {ctx.isPlatformAdmin ? null : <p className="text-sm text-muted">{t("admin.communities.coordinatorNote")}</p>}
          {canCreate ? (
            <Disclosure summary={t("admin.communities.newShow")} summaryClassName="text-primary">
              <ActionForm action={createCommunity} className="space-y-4">
                <CommunityFields idPrefix="new-community" cohorts={openCohorts} allowProgramWide={ctx.isPlatformAdmin} />
                <SubmitButton>{t("admin.communities.create")}</SubmitButton>
              </ActionForm>
            </Disclosure>
          ) : (
            <p className="text-sm text-muted">{t("admin.communities.noCohorts")}</p>
          )}
        </div>
      </Panel>

      <p className="text-sm" aria-live="polite">{communities.length === 1 ? t("admin.common.result") : t("admin.common.results", { count: communities.length })}</p>

      {communities.length === 0 ? (
        <EmptyState title={t("admin.communities.empty")} />
      ) : (
        <Table caption={t("admin.communities.caption")} captionHidden>
          <thead>
            <tr>
              <th scope="col" className={th}>{t("admin.communities.name")}</th>
              <th scope="col" className={th}>{t("admin.communities.cohort")}</th>
              <th scope="col" className={th}>{t("admin.communities.joinPolicy")}</th>
              <th scope="col" className={th}>{t("admin.communities.members")}</th>
            </tr>
          </thead>
          <tbody>
            {communities.map((c) => (
              <tr key={c.id}>
                <td className={td}>
                  <Link href={`/admin/communities/${c.id}`} className="font-medium text-primary underline-offset-2 hover:underline [overflow-wrap:anywhere]">{c.name}</Link>
                  {c.is_sample ? <Badge className="ml-2">{t("admin.common.sample")}</Badge> : null}
                </td>
                <td className={td}>{c.cohorts ? `${c.cohorts.name} (${c.cohorts.code})` : t("admin.communities.programWide")}</td>
                <td className={td}>
                  <Badge tone={c.join_policy === "open" ? "success" : "info"}>{t(`admin.communities.policy.${c.join_policy}`)}</Badge>
                </td>
                <td className={`${td} tabular-nums`}>{members.get(c.id) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </PageBody>
  );
}
