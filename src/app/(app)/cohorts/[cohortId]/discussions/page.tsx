import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/forms";
import { PageBody } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { CohortHeader } from "@/components/cohorts/cohort-header";
import { SectionTitle } from "@/components/announcements/section-title";
import { TopicList } from "@/components/discussions/topic-list";
import { loadTopicList } from "@/lib/comms/discussion-queries";
import { pageInfo, readPage, TOPICS_PAGE_SIZE } from "@/lib/comms/discussions";
import { loadCohort, loadCohortOverview } from "@/lib/comms/queries";
import { newTopicPath, topicsPath, type DiscussionScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("cohort.discussions") };

export default async function CohortDiscussionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ cohortId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cohortId } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/cohorts/${cohortId}/discussions`);
  if (!isUuid(cohortId)) notFound();
  const [cohort, overview] = await Promise.all([loadCohort(cohortId), loadCohortOverview(cohortId)]);
  if (!cohort || !overview) notFound();
  const scope: DiscussionScope = { type: "cohort", id: cohort.id };
  const requested = readPage(sp.page);
  let list = await loadTopicList(scope, requested, TOPICS_PAGE_SIZE);
  if (!list) notFound();
  const { page, pages } = pageInfo(list.total, TOPICS_PAGE_SIZE, requested);
  if (page !== requested) list = (await loadTopicList(scope, page, TOPICS_PAGE_SIZE)) ?? list;

  return (
    <>
      <CohortHeader cohort={cohort} current={t("disc.title")} />
      <PageBody>
        <SectionTitle
          actions={
            overview.is_admin ? (
              <ButtonLink href={newTopicPath(scope)}>
                <Plus aria-hidden="true" className="h-4 w-4" /> {t("disc.newTopic")}
              </ButtonLink>
            ) : null
          }
          description={`${t("disc.scopeNote", { scope: t("disc.scopeCohort") })} ${t("common.timezoneNote", { tz: user.timezone })}.`}
        >
          {t("cohort.discussions")}
        </SectionTitle>
        {list.topics.length === 0 ? (
          <EmptyState title={t("disc.empty")}>{overview.is_admin ? t("disc.emptyStaff") : t("disc.emptyCohort")}</EmptyState>
        ) : (
          <TopicList topics={list.topics} scope={scope} tz={user.timezone} />
        )}
        <Pagination page={page} pages={pages} hrefFor={(p) => `${topicsPath(scope)}${p > 1 ? `?page=${p}` : ""}`} />
      </PageBody>
    </>
  );
}
