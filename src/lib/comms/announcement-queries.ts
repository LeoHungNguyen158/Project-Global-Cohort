import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AnnouncementStatus } from "./announcements";
import type { AnnouncementScope } from "./paths";

// Announcements are read as the signed-in user: RLS returns only released ones
// (published and due by database time) to learners and cohort members, and every
// state to staff who may communicate in the course or administer the cohort.

export type AnnouncementItem = {
  id: string;
  title: string;
  bodyHtml: string;
  status: AnnouncementStatus;
  publishAt: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  authorId: string | null;
  authorName: string | null;
  revisions: number;
};

type Row = {
  id: string;
  title: string;
  body_html: string;
  status: AnnouncementStatus;
  publish_at: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  profiles: { display_name: string } | null;
  announcement_revisions?: { count: number }[];
};

const BASE = "id, title, body_html, status, publish_at, pinned, created_at, updated_at, created_by, profiles!announcements_created_by_fkey(display_name)";

function toItem(r: Row): AnnouncementItem {
  return {
    id: r.id,
    title: r.title,
    bodyHtml: r.body_html,
    status: r.status,
    publishAt: r.publish_at,
    pinned: r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    authorId: r.created_by,
    authorName: r.profiles?.display_name ?? null,
    revisions: Number(r.announcement_revisions?.[0]?.count ?? 0),
  };
}

function scopeColumn(scope: AnnouncementScope) {
  return scope.type === "offering" ? "offering_id" : "cohort_id";
}

/** Announcements of a course or cohort visible to the viewer (at most 300, newest first). */
export async function loadAnnouncements(scope: AnnouncementScope, opts: { staff: boolean }): Promise<AnnouncementItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("announcements")
    .select(opts.staff ? `${BASE}, announcement_revisions(count)` : BASE)
    .eq(scopeColumn(scope), scope.id)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error("Could not load announcements");
  return ((data ?? []) as unknown as Row[]).map(toItem);
}

/** One announcement, only when it belongs to the given course or cohort and is visible to the viewer. */
export async function loadAnnouncement(scope: AnnouncementScope, announcementId: string): Promise<AnnouncementItem | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("announcements")
    .select(`${BASE}, announcement_revisions(count)`)
    .eq("id", announcementId)
    .eq(scopeColumn(scope), scope.id)
    .maybeSingle();
  return data ? toItem(data as unknown as Row) : null;
}

export type AnnouncementRevision = { id: string; title: string; bodyHtml: string; editedAt: string; editorName: string | null };

/** Earlier versions of a published announcement (staff and cohort administrators only, by RLS). */
export async function loadRevisions(announcementId: string): Promise<AnnouncementRevision[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("announcement_revisions")
    .select("id, title, body_html, edited_at, profiles!announcement_revisions_edited_by_fkey(display_name)")
    .eq("announcement_id", announcementId)
    .order("edited_at", { ascending: false })
    .limit(100);
  return ((data ?? []) as unknown as { id: string; title: string; body_html: string; edited_at: string; profiles: { display_name: string } | null }[]).map((r) => ({
    id: r.id,
    title: r.title,
    bodyHtml: r.body_html,
    editedAt: r.edited_at,
    editorName: r.profiles?.display_name ?? null,
  }));
}
