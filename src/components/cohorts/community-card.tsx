import Link from "next/link";
import { joinCommunity, leaveCommunity } from "@/app/actions/cohorts";
import { ActionForm } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { CommunitySummary } from "@/lib/comms/queries";
import { communityPath } from "@/lib/comms/paths";
import { t } from "@/i18n";

export function communityCounts(c: Pick<CommunitySummary, "member_count" | "topic_count">) {
  const members = c.member_count === 1 ? t("community.membersOne") : t("community.members", { count: c.member_count });
  const topics = c.topic_count === 1 ? t("community.topicsOne") : t("community.topics", { count: c.topic_count });
  return { members, topics };
}

/** Who can see the community: one cohort's people, or every participant (open or by invitation). */
export function communityAudience(c: Pick<CommunitySummary, "cohort_name" | "join_policy">) {
  if (c.cohort_name) return t("community.forCohort", { cohort: c.cohort_name });
  return c.join_policy === "invite" ? t("community.programWideInvite") : t("community.openToAll");
}

/** Join (open communities), leave (members), or the reason neither is offered. */
export function CommunityMembership({ community }: { community: CommunitySummary }) {
  if (community.is_member) {
    return (
      <ConfirmForm
        action={leaveCommunity}
        fields={{ communityId: community.community_id }}
        trigger={
          <>
            {t("community.leave")}
            <span className="sr-only"> {community.name}</span>
          </>
        }
        title={t("community.leaveConfirmTitle")}
        description={t("community.leaveConfirmBody")}
        confirmLabel={t("community.leave")}
        tone="danger"
        size="sm"
      />
    );
  }
  if (community.join_policy === "open") {
    return (
      <ActionForm action={joinCommunity}>
        <input type="hidden" name="communityId" value={community.community_id} />
        <SubmitButton size="sm" pendingText={t("ann.saving")}>
          {t("community.join")}
          <span className="sr-only"> {community.name}</span>
        </SubmitButton>
      </ActionForm>
    );
  }
  return <p className="text-sm text-muted">{t("community.inviteOnly")}</p>;
}

/** A community in the directory: who it is for, counts, the viewer's state and actions. */
export function CommunityCard({ community, headingLevel = 3 }: { community: CommunitySummary; headingLevel?: 3 | 4 }) {
  const H = headingLevel === 3 ? "h3" : "h4";
  const { members, topics } = communityCounts(community);
  return (
    <li className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-panel px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <H className="break-words font-semibold">
            <Link href={communityPath(community.community_id)} className="hover:underline">
              {community.name}
            </Link>
          </H>
          <p className="text-sm text-muted">
            {communityAudience(community)} · {members} · {topics}
          </p>
        </div>
        {community.is_member ? <Badge tone="success">{t("community.joinedBadge")}</Badge> : null}
      </div>
      {community.description ? <p className="break-words text-sm">{community.description}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <CommunityMembership community={community} />
      </div>
    </li>
  );
}
