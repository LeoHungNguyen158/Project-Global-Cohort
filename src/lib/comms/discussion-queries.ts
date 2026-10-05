import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PostRow } from "./discussions";
import type { DiscussionScope } from "./paths";

// Discussion reads go through comms_topic_list / comms_topic_posts (definer functions
// that check can_view_offering, cohort or community membership and return names
// only) and RLS-protected tables for edit history.

export type TopicSummary = {
  id: string;
  title: string;
  pinned: boolean;
  locked: boolean;
  created_at: string;
  author_name: string | null;
  post_count: number;
  last_activity_at: string;
};

export type TopicPage = { total: number; page: number; page_size: number; topics: TopicSummary[] };

/** One page of a scope's topics, pinned first, then by latest activity. Null when the viewer may not see them. */
export async function loadTopicList(scope: DiscussionScope, page: number, pageSize: number): Promise<TopicPage | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("comms_topic_list", {
    p_offering: scope.type === "offering" ? scope.id : null,
    p_cohort: scope.type === "cohort" ? scope.id : null,
    p_community: scope.type === "community" ? scope.id : null,
    p_page: page,
    p_page_size: pageSize,
  });
  if (error) {
    if (error.code === "42501") return null;
    throw new Error("Could not load discussion topics");
  }
  const d = data as TopicPage;
  return { total: Number(d.total ?? 0), page: Number(d.page ?? 1), page_size: Number(d.page_size ?? pageSize), topics: d.topics ?? [] };
}

export type TopicInfo = {
  id: string;
  title: string;
  body_html: string;
  pinned: boolean;
  locked: boolean;
  created_at: string;
  author_name: string | null;
  offering_id: string | null;
  cohort_id: string | null;
  community_id: string | null;
};

export type TopicDetail = { topic: TopicInfo; can_moderate: boolean; total: number; page: number; page_size: number; posts: PostRow[] };

/** A topic with one page of top-level posts and all their replies; null when not visible. */
export async function loadTopic(topicId: string, page: number, pageSize: number): Promise<TopicDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("comms_topic_posts", { p_topic: topicId, p_page: page, p_page_size: pageSize });
  if (error) {
    if (error.code === "42501") return null;
    throw new Error("Could not load the discussion");
  }
  const d = data as TopicDetail;
  return { ...d, total: Number(d.total ?? 0), posts: d.posts ?? [] };
}

export type PostRevision = { id: string; post_id: string; body_html: string; edited_at: string };

/** Earlier versions of posts (RLS: their authors and moderators only), newest first. */
export async function loadPostRevisions(postIds: string[]): Promise<Map<string, PostRevision[]>> {
  const out = new Map<string, PostRevision[]>();
  if (postIds.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from("discussion_post_revisions")
    .select("id, post_id, body_html, edited_at")
    .in("post_id", postIds)
    .order("edited_at", { ascending: false })
    .limit(500);
  for (const r of (data ?? []) as PostRevision[]) {
    const list = out.get(r.post_id) ?? [];
    list.push(r);
    out.set(r.post_id, list);
  }
  return out;
}
