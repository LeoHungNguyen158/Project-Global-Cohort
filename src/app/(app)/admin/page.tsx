import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/access";
import { listAdminCohorts, listAdminOfferings } from "@/lib/admin/data";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { CohortStatusBadge, SectionTitle } from "@/components/admin/badges";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.title") };

type PlatformCounts = {
  users: number;
  suspended: number;
  unconfirmed: number;
  platform_admins: number;
  coordinators: number;
  quarantined_uploads: number;
  stale_pending_uploads: number;
};

function Stat({ href, value, label, note }: { href: string; value: number; label: string; note?: string }) {
  return (
    <li>
      <Link
        href={href}
        className="block h-full rounded-[var(--radius-panel)] border border-line bg-panel p-4 hover:border-primary focus-visible:border-primary"
      >
        <span className="block text-3xl font-semibold tabular-nums text-ink">{value}</span>
        <span className="mt-1 block text-sm font-medium text-ink">{label}</span>
        {note ? <span className="mt-1 block text-xs text-muted">{note}</span> : null}
      </Link>
    </li>
  );
}

export default async function AdminOverviewPage() {
  const ctx = await requireAdmin("/admin");
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const pendingInvites = () =>
    supabase.from("invitations").select("id", { count: "exact", head: true }).is("accepted_at", null).is("revoked_at", null).gt("expires_at", nowIso);

  const [countsRes, invitesRes, failedRes, requestsRes, cohorts, offerings] = await Promise.all([
    ctx.isPlatformAdmin ? supabase.rpc("admin_platform_counts") : Promise.resolve({ data: null, error: null }),
    pendingInvites(),
    pendingInvites().eq("email_status", "failed"),
    supabase.rpc("admin_list_access_requests", { p_status: "pending", p_limit: 1, p_offset: 0 }),
    listAdminCohorts(ctx),
    listAdminOfferings(ctx),
  ]);
  if (countsRes.error || invitesRes.error || failedRes.error || requestsRes.error) throw new Error("Could not load the overview");

  const counts = countsRes.data as PlatformCounts | null;
  const pendingRequests = Number((requestsRes.data as { total_count: number }[] | null)?.[0]?.total_count ?? 0);
  const activeCohorts = cohorts.filter((c) => c.status !== "archived");
  const runningOfferings = offerings.filter((o) => o.status === "published").length;
  const draftOfferings = offerings.filter((o) => o.status === "draft").length;
  const scanMode = serverEnv().uploadScanMode;

  return (
    <PageBody>
      <SectionTitle title={t("admin.overview.title")} description={t("admin.overview.description")} />

      <section aria-labelledby="overview-needs" className="mb-8">
        <h3 id="overview-needs" className="mb-3 text-lg font-semibold">{t("admin.overview.needsAttention")}</h3>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat href="/admin/invitations?status=pending" value={invitesRes.count ?? 0} label={t("admin.overview.pendingInvitations")} />
          <Stat
            href="/admin/invitations?status=pending&delivery=failed"
            value={failedRes.count ?? 0}
            label={t("admin.overview.failedEmails")}
            note={t("admin.overview.failedEmailsNote")}
          />
          <Stat href="/admin/access-requests" value={pendingRequests} label={t("admin.overview.pendingRequests")} />
          {counts ? (
            <Stat href="/admin/uploads" value={counts.quarantined_uploads} label={t("admin.overview.quarantined")} note={t(`admin.overview.scan.${scanMode}`)} />
          ) : null}
        </ul>
      </section>

      <section aria-labelledby="overview-program" className="mb-8">
        <h3 id="overview-program" className="mb-3 text-lg font-semibold">{t("admin.overview.program")}</h3>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {counts ? (
            <Stat
              href="/admin/users"
              value={counts.users}
              label={t("admin.overview.users")}
              note={t("admin.overview.usersNote", { suspended: counts.suspended, unconfirmed: counts.unconfirmed })}
            />
          ) : null}
          <Stat href="/admin/cohorts" value={activeCohorts.length} label={t("admin.overview.cohorts")} note={t("admin.overview.cohortsNote", { total: cohorts.length })} />
          <Stat
            href="/admin/offerings"
            value={runningOfferings}
            label={t("admin.overview.offerings")}
            note={t("admin.overview.offeringsNote", { drafts: draftOfferings, total: offerings.length })}
          />
          {counts ? (
            <Stat
              href="/admin/users?filter=admins"
              value={counts.platform_admins}
              label={t("admin.overview.admins")}
              note={t("admin.overview.adminsNote", { coordinators: counts.coordinators })}
            />
          ) : null}
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel aria-labelledby="overview-actions">
          <PanelHeader id="overview-actions" level={3} title={t("admin.overview.quickActions")} />
          <div className="flex flex-wrap gap-2 p-4 sm:px-6">
            <ButtonLink href="/admin/invitations#new-invitation" variant="primary">{t("admin.overview.invite")}</ButtonLink>
            <ButtonLink href="/admin/import" variant="secondary">{t("admin.overview.import")}</ButtonLink>
            <ButtonLink href="/admin/offerings/new" variant="secondary">{t("admin.overview.newOffering")}</ButtonLink>
            <ButtonLink href="/admin/reports" variant="secondary">{t("admin.overview.reports")}</ButtonLink>
          </div>
        </Panel>

        <Panel aria-labelledby="overview-cohorts">
          <PanelHeader id="overview-cohorts" level={3} title={ctx.isPlatformAdmin ? t("admin.overview.activeCohorts") : t("admin.overview.yourCohorts")} />
          {activeCohorts.length === 0 ? (
            <p className="p-4 text-sm text-muted sm:px-6">{t("admin.overview.noCohorts")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {activeCohorts.slice(0, 8).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
                  <Link href={`/admin/cohorts/${c.id}`} className="min-w-0 font-medium text-primary underline-offset-2 hover:underline [overflow-wrap:anywhere]">
                    {c.name}
                  </Link>
                  <span className="flex items-center gap-2 text-sm text-muted">
                    {c.code} <CohortStatusBadge status={c.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {counts && counts.stale_pending_uploads > 0 ? (
        <Alert tone="info" className="mt-6">
          {t("admin.overview.staleUploads", { count: counts.stale_pending_uploads })}
        </Alert>
      ) : null}
    </PageBody>
  );
}
