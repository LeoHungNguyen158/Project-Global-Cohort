import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/forms";
import { PageBody } from "@/components/ui/page-header";
import { CohortHeader } from "@/components/cohorts/cohort-header";
import { BackLink } from "@/components/announcements/screens";
import { TopicView } from "@/components/discussions/topic-view";
import { loadPostRevisions, loadTopic } from "@/lib/comms/discussion-queries";
import { pageInfo, POSTS_PAGE_SIZE, readPage } from "@/lib/comms/discussions";
import { loadCohort } from "@/lib/comms/queries";
import { topicsPath, type DiscussionScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("cohort.discussions") };

export default async function CohortTopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ cohortId: string; topicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cohortId, topicId } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/cohorts/${cohortId}/discussions/${topicId}`);
  if (!isUuid(cohortId) || !isUuid(topicId)) notFound();
  const cohort = await loadCohort(cohortId);
  if (!cohort) notFound();
  const requested = readPage(sp.page);
  let detail = await loadTopic(topicId, requested, POSTS_PAGE_SIZE);
  // Only this cohort's own topics are shown here: no sharing across cohorts.
  if (!detail || detail.topic.cohort_id !== cohort.id) notFound();
  const { page, pages } = pageInfo(detail.total, POSTS_PAGE_SIZE, requested);
  if (page !== requested) detail = (await loadTopic(topicId, page, POSTS_PAGE_SIZE)) ?? detail;
  const revisions = await loadPostRevisions(detail.posts.filter((p) => p.revision_count > 0).map((p) => p.id));
  const scope: DiscussionScope = { type: "cohort", id: cohort.id };
  const closedNote = detail.topic.locked ? t("disc.lockedNote") : null;

  return (
    <>
      <CohortHeader cohort={cohort} current={detail.topic.title} />
      <PageBody>
        <BackLink href={topicsPath(scope)} label={t("disc.backToTopics")} />
        <h2 className="mb-3 break-words text-xl font-semibold">{detail.topic.title}</h2>
        <TopicView
          scope={scope}
          detail={detail}
          revisions={revisions}
          viewerId={user.id}
          tz={user.timezone}
          canPost={closedNote === null}
          closedNote={closedNote}
          page={page}
          pages={pages}
          level={3}
        />
      </PageBody>
    </>
  );
}
