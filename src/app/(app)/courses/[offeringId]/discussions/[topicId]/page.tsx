import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOffering } from "@/lib/data/offering-access";
import { isUuid } from "@/lib/forms";
import { PageBody } from "@/components/ui/page-header";
import { BackLink } from "@/components/announcements/screens";
import { TopicView } from "@/components/discussions/topic-view";
import { loadPostRevisions, loadTopic } from "@/lib/comms/discussion-queries";
import { pageInfo, POSTS_PAGE_SIZE, readPage } from "@/lib/comms/discussions";
import { topicsPath, type DiscussionScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("disc.title") };

export default async function CourseTopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string; topicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { offeringId, topicId } = await params;
  const sp = await searchParams;
  const access = await requireOffering(offeringId);
  const { offering, user } = access;
  if (!isUuid(topicId)) notFound();
  const requested = readPage(sp.page);
  let detail = await loadTopic(topicId, requested, POSTS_PAGE_SIZE);
  // A topic is shown only under its own course: no cross-course or cross-cohort URLs.
  if (!detail || detail.topic.offering_id !== offering.id) notFound();
  const { page, pages } = pageInfo(detail.total, POSTS_PAGE_SIZE, requested);
  if (page !== requested) detail = (await loadTopic(topicId, page, POSTS_PAGE_SIZE)) ?? detail;
  const revisions = await loadPostRevisions(detail.posts.filter((p) => p.revision_count > 0).map((p) => p.id));
  const scope: DiscussionScope = { type: "offering", id: offering.id };
  const closedNote =
    offering.status === "archived" ? t("disc.archivedNote") : access.readOnly ? t("disc.readOnlyNote") : detail.topic.locked ? t("disc.lockedNote") : null;

  return (
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
  );
}
