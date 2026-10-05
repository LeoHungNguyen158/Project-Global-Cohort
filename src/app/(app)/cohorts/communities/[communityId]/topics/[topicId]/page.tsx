import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/forms";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/announcements/screens";
import { TopicView } from "@/components/discussions/topic-view";
import { loadPostRevisions, loadTopic } from "@/lib/comms/discussion-queries";
import { pageInfo, POSTS_PAGE_SIZE, readPage } from "@/lib/comms/discussions";
import { loadCommunities } from "@/lib/comms/queries";
import { communityPath, type DiscussionScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("disc.title") };

export default async function CommunityTopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ communityId: string; topicId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { communityId, topicId } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/cohorts/communities/${communityId}/topics/${topicId}`);
  if (!isUuid(communityId) || !isUuid(topicId)) notFound();
  const [community] = await loadCommunities(communityId);
  if (!community) notFound();
  const requested = readPage(sp.page);
  // Visible to members only (comms_topic_posts checks is_community_member), and only under its own community.
  let detail = await loadTopic(topicId, requested, POSTS_PAGE_SIZE);
  if (!detail || detail.topic.community_id !== community.community_id) notFound();
  const { page, pages } = pageInfo(detail.total, POSTS_PAGE_SIZE, requested);
  if (page !== requested) detail = (await loadTopic(topicId, page, POSTS_PAGE_SIZE)) ?? detail;
  const revisions = await loadPostRevisions(detail.posts.filter((p) => p.revision_count > 0).map((p) => p.id));
  const scope: DiscussionScope = { type: "community", id: community.community_id };
  const back = communityPath(community.community_id);
  const closedNote = detail.topic.locked ? t("disc.lockedNote") : null;

  return (
    <>
      <PageHeader
        title={<span className="break-words">{detail.topic.title}</span>}
        crumbs={[
          { label: t("cohort.allCohorts"), href: "/cohorts" },
          { label: community.name, href: back },
          { label: detail.topic.title.length > 60 ? `${detail.topic.title.slice(0, 57)}…` : detail.topic.title },
        ]}
      />
      <PageBody>
        <BackLink href={`${back}#topics`} label={t("disc.backToTopics")} />
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
          level={2}
        />
      </PageBody>
    </>
  );
}
