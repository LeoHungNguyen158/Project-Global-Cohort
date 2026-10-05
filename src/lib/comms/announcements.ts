// Announcement states and publication rules. Learners only ever receive released
// announcements (RLS: published and due by database time); these helpers label and
// order what staff see, and validate a requested publication before it is saved.
import { compareTimestamps, timestampMicros } from "./timestamps";

export type AnnouncementStatus = "draft" | "published" | "archived";
export type AnnouncementState = "draft" | "scheduled" | "published" | "archived";
export type PublishMode = "draft" | "now" | "schedule" | "keep";

export type AnnouncementTiming = { status: string; publish_at: string | null; created_at: string; pinned?: boolean };

export function announcementState(a: Pick<AnnouncementTiming, "status" | "publish_at">, now: Date = new Date()): AnnouncementState {
  if (a.status === "archived") return "archived";
  if (a.status !== "published") return "draft";
  if (a.publish_at && (timestampMicros(a.publish_at) ?? 0) > now.getTime() * 1000) return "scheduled";
  return "published";
}

/** The date shown as "Posted": the publication time, or creation time for older rows. */
export function announcementDate(a: Pick<AnnouncementTiming, "publish_at" | "created_at">): string {
  return a.publish_at ?? a.created_at;
}

/** Pinned first, then newest first. */
export function sortAnnouncements<T extends AnnouncementTiming>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return compareTimestamps(announcementDate(b), announcementDate(a));
  });
}

export function groupByState<T extends AnnouncementTiming>(list: T[], now: Date = new Date()): Record<AnnouncementState, T[]> {
  const out: Record<AnnouncementState, T[]> = { published: [], scheduled: [], draft: [], archived: [] };
  for (const a of list) out[announcementState(a, now)].push(a);
  out.published = sortAnnouncements(out.published);
  out.scheduled.sort((a, b) => compareTimestamps(announcementDate(a), announcementDate(b)));
  out.draft.sort((a, b) => compareTimestamps(b.created_at, a.created_at));
  out.archived = sortAnnouncements(out.archived);
  return out;
}

export function parsePublishMode(value: string): PublishMode | null {
  return value === "draft" || value === "now" || value === "schedule" || value === "keep" ? value : null;
}

export type PublicationChange =
  | { ok: true; status?: AnnouncementStatus; publish_at?: string | null }
  | { ok: false; error: "scheduleMissing" | "schedulePast" | "scheduleInvalid" };

/**
 * Translates the form's publication choice into column changes. "now" leaves
 * publish_at empty so the database stamps its own time; "schedule" needs a future
 * time; "keep" changes nothing (editing an already published announcement).
 */
export function resolvePublication(mode: PublishMode, scheduled: string | null | "invalid", now: Date = new Date()): PublicationChange {
  switch (mode) {
    case "draft":
      return { ok: true, status: "draft", publish_at: null };
    case "now":
      return { ok: true, status: "published", publish_at: null };
    case "keep":
      return { ok: true };
    case "schedule": {
      if (scheduled === "invalid") return { ok: false, error: "scheduleInvalid" };
      if (!scheduled) return { ok: false, error: "scheduleMissing" };
      if (new Date(scheduled).getTime() <= now.getTime()) return { ok: false, error: "schedulePast" };
      return { ok: true, status: "published", publish_at: scheduled };
    }
  }
}

/** Status changes offered from the list for each state (the database re-checks permission). */
export type AnnouncementOp = "publish" | "unschedule" | "archive" | "restore" | "pin" | "unpin";

export function allowedOps(state: AnnouncementState, pinned: boolean): AnnouncementOp[] {
  const ops: AnnouncementOp[] = [];
  if (state === "draft" || state === "scheduled") ops.push("publish");
  if (state === "scheduled") ops.push("unschedule");
  if (state !== "archived") ops.push(pinned ? "unpin" : "pin", "archive");
  if (state === "archived") ops.push("restore");
  return ops;
}

export function isAllowedOp(op: string, state: AnnouncementState, pinned: boolean): op is AnnouncementOp {
  return (allowedOps(state, pinned) as string[]).includes(op);
}
