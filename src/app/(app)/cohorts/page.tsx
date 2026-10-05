import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AccentBar } from "@/components/ui/panel";
import { CommunityCard } from "@/components/cohorts/community-card";
import { CohortStatusBadge } from "@/components/cohorts/badges";
import { loadCommunities, loadMyCohorts, type MyCohort } from "@/lib/comms/queries";
import { formatDay } from "@/lib/comms/dates";
import { t, type MessageKey } from "@/i18n";

export const metadata: Metadata = { title: t("cohort.title") };

const ROLE: Record<MyCohort["role"], MessageKey> = {
  admin: "cohort.role.admin",
  staff: "cohort.role.staff",
  participant: "cohort.role.participant",
  learner: "cohort.role.learner",
};

export default async function CohortsPage() {
  const user = await requireUser("/cohorts");
  const [cohorts, communities] = await Promise.all([loadMyCohorts(user), loadCommunities()]);

  return (
    <>
      <PageHeader title={t("cohort.title")} description={t("cohort.intro")} />
      <PageBody className="space-y-10">
        <section aria-labelledby="cohorts-heading" className="space-y-3">
          <h2 id="cohorts-heading" className="text-xl font-semibold">{t("cohort.yourCohorts")}</h2>
          {cohorts.length === 0 ? (
            <EmptyState title={t("cohort.none")}>{t("cohort.noneHelp")}</EmptyState>
          ) : (
            <ul className="space-y-3">
              {cohorts.map((c) => (
                <li key={c.id} className="flex rounded-[var(--radius-panel)] border border-line bg-panel">
                  <AccentBar color="#475569" />
                  <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-6">
                    <div className="min-w-0">
                      <p className="text-sm text-muted">{t("msg.idLabel", { code: c.code })}</p>
                      <h3 className="break-words font-semibold">
                        <Link href={`/cohorts/${c.id}`} className="hover:underline">
                          {c.name}
                        </Link>
                      </h3>
                      <p className="text-sm text-muted">
                        {c.starts_on || c.ends_on ? t("cohort.datesRange", { start: formatDay(c.starts_on), end: formatDay(c.ends_on) }) : t("cohort.noDates")}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CohortStatusBadge status={c.status} />
                      <Badge tone="info">{t(ROLE[c.role])}</Badge>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="communities" aria-labelledby="communities-heading" className="scroll-mt-24 space-y-3">
          <div>
            <h2 id="communities-heading" className="text-xl font-semibold">{t("community.title")}</h2>
            <p className="text-sm text-muted">{t("community.intro")}</p>
          </div>
          <Alert tone="info">{t("community.accessNote")}</Alert>
          {communities.length === 0 ? (
            <EmptyState title={t("community.none")} />
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {communities.map((c) => (
                <CommunityCard key={c.community_id} community={c} />
              ))}
            </ul>
          )}
        </section>
      </PageBody>
    </>
  );
}
