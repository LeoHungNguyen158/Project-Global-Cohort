import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/forms";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { BackLink } from "@/components/announcements/screens";
import { TopicEditor } from "@/components/discussions/topic-editor";
import { loadCommunities } from "@/lib/comms/queries";
import { communityPath, type DiscussionScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("disc.createTitle") };

export default async function NewCommunityTopicPage({ params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;
  await requireUser(`/cohorts/communities/${communityId}/topics/new`);
  if (!isUuid(communityId)) notFound();
  const [community] = await loadCommunities(communityId);
  // Members (and the community's administrators) may open topics.
  if (!community || !(community.is_member || community.can_manage)) notFound();
  const scope: DiscussionScope = { type: "community", id: community.community_id };
  const back = communityPath(community.community_id);
  return (
    <>
      <PageHeader
        title={t("disc.createTitle")}
        crumbs={[
          { label: t("cohort.allCohorts"), href: "/cohorts" },
          { label: community.name, href: back },
          { label: t("disc.createTitle") },
        ]}
        description={t("disc.createIn", { scope: community.name })}
      />
      <PageBody>
        <BackLink href={`${back}#topics`} label={t("disc.backToTopics")} />
        <Panel className="max-w-3xl px-4 py-5 sm:px-6">
          <TopicEditor scope={scope} moderator={community.can_manage} cancelHref={`${back}#topics`} />
        </Panel>
      </PageBody>
    </>
  );
}
