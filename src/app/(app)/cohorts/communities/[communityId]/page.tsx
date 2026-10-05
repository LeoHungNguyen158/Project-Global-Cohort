import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/forms";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { CommunityMembership, communityAudience, communityCounts } from "@/components/cohorts/community-card";
import { SectionTitle } from "@/components/announcements/section-title";
import { TopicList } from "@/components/discussions/topic-list";
import { loadTopicList } from "@/lib/comms/discussion-queries";
import { pageInfo, readPage, TOPICS_PAGE_SIZE } from "@/lib/comms/discussions";
import { loadCommunities, loadCommunityMembers } from "@/lib/comms/queries";
import { communityPath, newTopicPath, type DiscussionScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

const MEMBERS_SHOWN = 60;

export async function generateMetadata({ params }: { params: Promise<{ communityId: string }> }): Promise<Metadata> {
  const { communityId } = await params;
  const [community] = isUuid(communityId) ? await loadCommunities(communityId) : [];
  return { title: community?.name ?? t("community.title") };
}

export default async function CommunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ communityId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { communityId } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/cohorts/communities/${communityId}`);
  if (!isUuid(communityId)) notFound();
  // Communities of other cohorts are not visible (can_view_community), so they do not exist here.
  const [community] = await loadCommunities(communityId);
  if (!community) notFound();
  const scope: DiscussionScope = { type: "community", id: community.community_id };
  // Members see members and topics; so do the community's administrators (is_community_member).
  const insider = community.is_member || community.can_manage;
  const requested = readPage(sp.page);
  let [members, topics] = insider
    ? await Promise.all([loadCommunityMembers(community.community_id), loadTopicList(scope, requested, TOPICS_PAGE_SIZE)])
    : [null, null];
  const { page, pages } = pageInfo(topics?.total ?? 0, TOPICS_PAGE_SIZE, requested);
  if (topics && page !== requested) topics = (await loadTopicList(scope, page, TOPICS_PAGE_SIZE)) ?? topics;
  members = members ?? [];
  const { members: memberText, topics: topicText } = communityCounts(community);

  return (
    <>
      <PageHeader
        title={community.name}
        crumbs={[{ label: t("cohort.allCohorts"), href: "/cohorts" }, { label: t("community.crumb"), href: "/cohorts#communities" }, { label: community.name }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {communityAudience(community)} · {memberText} · {topicText}
            </span>
            {community.is_member ? <Badge tone="success">{t("community.joinedBadge")}</Badge> : null}
          </span>
        }
        actions={
          <>
            <CommunityMembership community={community} />
            {/* Administrators add and remove members (invitation-only communities included) in Administration. */}
            {community.can_manage ? (
              <ButtonLink href={`/admin/communities/${community.community_id}`} variant="secondary" size="sm">
                {t("community.manage")}
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <PageBody className="space-y-6">
        <Alert tone="info">{t("community.accessNote")}</Alert>
        {community.description ? <p className="max-w-3xl break-words">{community.description}</p> : null}
        {community.can_manage && !community.is_member ? <p className="text-sm text-muted">{t("community.adminView")}</p> : null}
        {!insider ? (
          <EmptyState title={t("community.membersHidden")}>{community.join_policy === "open" ? t("community.joinToSee") : t("community.inviteOnly")}</EmptyState>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <section id="topics" aria-labelledby="topics-heading" className="min-w-0 scroll-mt-24">
              <SectionTitle
                id="topics-heading"
                actions={
                  <ButtonLink href={newTopicPath(scope)} size="sm">
                    <Plus aria-hidden="true" className="h-4 w-4" /> {t("disc.newTopic")}
                  </ButtonLink>
                }
                description={`${t("community.newTopicHelp")} ${t("common.timezoneNote", { tz: user.timezone })}.`}
              >
                {t("community.topicsHeading")}
              </SectionTitle>
              {!topics || topics.topics.length === 0 ? (
                <EmptyState title={t("community.emptyTopics")}>{t("community.emptyTopicsHelp")}</EmptyState>
              ) : (
                <TopicList topics={topics.topics} scope={scope} tz={user.timezone} />
              )}
              <Pagination page={page} pages={pages} hrefFor={(p) => `${communityPath(community.community_id)}${p > 1 ? `?page=${p}` : ""}#topics`} />
            </section>
            <aside className="min-w-0">
              <Panel aria-labelledby="members-heading">
                <PanelHeader id="members-heading" title={`${t("community.membersHeading")} (${members.length})`} />
                <div className="space-y-2 px-4 py-3 text-sm sm:px-6">
                  {members.length === 0 ? (
                    <p className="text-muted">{t("community.noMembers")}</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {members.slice(0, MEMBERS_SHOWN).map((m) => (
                        <li key={m.user_id} className="break-words py-1">
                          {m.display_name}
                          {m.user_id === user.id ? <span className="text-muted"> {t("msg.youSuffix")}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {members.length > MEMBERS_SHOWN ? (
                    <Disclosure summary={t("cohort.showAll", { count: members.length })}>
                      <ul className="divide-y divide-line">
                        {members.slice(MEMBERS_SHOWN).map((m) => (
                          <li key={m.user_id} className="break-words py-1">{m.display_name}</li>
                        ))}
                      </ul>
                    </Disclosure>
                  ) : null}
                  <p className="text-xs text-muted">{t("cohort.rosterPrivacy")}</p>
                </div>
              </Panel>
            </aside>
          </div>
        )}
      </PageBody>
    </>
  );
}
