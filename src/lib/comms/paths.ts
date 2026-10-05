// Canonical URLs for comms records. Notification links and other areas depend on
// the announcement anchors (#a-<id>) and the message thread URL staying exactly so.

export type DiscussionScope =
  | { type: "offering"; id: string }
  | { type: "cohort"; id: string }
  | { type: "community"; id: string };

export type AnnouncementScope = { type: "offering"; id: string } | { type: "cohort"; id: string };

export function threadPath(threadId: string): string {
  return `/messages/${threadId}`;
}

export function announcementsPath(scope: AnnouncementScope): string {
  return scope.type === "offering" ? `/courses/${scope.id}/announcements` : `/cohorts/${scope.id}`;
}

export function announcementAnchor(scope: AnnouncementScope, announcementId: string): string {
  return `${announcementsPath(scope)}#a-${announcementId}`;
}

export function announcementEditorBase(scope: AnnouncementScope): string {
  return scope.type === "offering" ? `/courses/${scope.id}/announcements` : `/cohorts/${scope.id}/announcements`;
}

/** Where a scope's topics are listed (a community lists them on its own page). */
export function topicsPath(scope: DiscussionScope): string {
  switch (scope.type) {
    case "offering":
      return `/courses/${scope.id}/discussions`;
    case "cohort":
      return `/cohorts/${scope.id}/discussions`;
    case "community":
      return `/cohorts/communities/${scope.id}`;
  }
}

function topicBase(scope: DiscussionScope): string {
  return scope.type === "community" ? `/cohorts/communities/${scope.id}/topics` : topicsPath(scope);
}

export function topicPath(scope: DiscussionScope, topicId: string): string {
  return `${topicBase(scope)}/${topicId}`;
}

export function newTopicPath(scope: DiscussionScope): string {
  return `${topicBase(scope)}/new`;
}

export function communityPath(communityId: string): string {
  return `/cohorts/communities/${communityId}`;
}

/** The scope of a stored topic row (exactly one of the three ids is set). */
export function topicScope(row: { offering_id: string | null; cohort_id: string | null; community_id: string | null }): DiscussionScope | null {
  if (row.offering_id) return { type: "offering", id: row.offering_id };
  if (row.cohort_id) return { type: "cohort", id: row.cohort_id };
  if (row.community_id) return { type: "community", id: row.community_id };
  return null;
}

export function announcementScope(row: { offering_id: string | null; cohort_id: string | null }): AnnouncementScope | null {
  if (row.offering_id) return { type: "offering", id: row.offering_id };
  if (row.cohort_id) return { type: "cohort", id: row.cohort_id };
  return null;
}
