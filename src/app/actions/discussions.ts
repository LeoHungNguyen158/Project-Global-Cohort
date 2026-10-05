"use server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { bool, int, str, uuid } from "@/lib/forms";
import { markdownToSafeHtml } from "@/lib/markdown";
import { POSTS_PAGE_SIZE } from "@/lib/comms/discussions";
import { topicPath, topicsPath, topicScope, type DiscussionScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

// Topics and posts are written directly to their tables. RLS decides: topics may be
// opened by course staff who communicate, cohort administrators or community members;
// posts by anyone who can view the topic while it is not locked; authors edit their
// own visible posts; moderators update topics. Moderators hide posts through
// hide_discussion_post(). Markdown is converted and sanitized here, before saving.

const MAX_TITLE = 300;
const MAX_BODY = 20_000;

function readScope(formData: FormData): DiscussionScope | null {
  const type = str(formData, "scopeType", 16);
  const id = uuid(formData, "scopeId");
  if (!id || (type !== "offering" && type !== "cohort" && type !== "community")) return null;
  return { type, id: id.toLowerCase() } as DiscussionScope;
}

type TopicRow = { id: string; offering_id: string | null; cohort_id: string | null; community_id: string | null; locked: boolean };

/** Loads a topic the caller can see and checks it belongs to the scope the form came from. */
async function scopedTopic(topicId: string, scope: DiscussionScope): Promise<TopicRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("discussion_topics").select("id, offering_id, cohort_id, community_id, locked").eq("id", topicId).maybeSingle();
  if (!data) return null;
  const actual = topicScope(data);
  return actual && actual.type === scope.type && actual.id === scope.id ? (data as TopicRow) : null;
}

function refresh(scope: DiscussionScope, topicId?: string) {
  revalidatePath(topicsPath(scope));
  if (topicId) revalidatePath(topicPath(scope, topicId));
}

/** Opens a topic. Pinning or locking it at creation is offered to moderators only. */
export async function createTopic(_prev: unknown, formData: FormData): Promise<ActionResult<{ redirectTo: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: t("msg.sessionExpired") };
  const scope = readScope(formData);
  if (!scope) return { ok: false, error: t("msg.invalidRequest") };
  const title = str(formData, "title", MAX_TITLE + 1);
  if (!title || title.length > MAX_TITLE) return { ok: false, error: t("disc.errTitle"), fieldErrors: { title: t("disc.errTitle") } };
  const bodyHtml = markdownToSafeHtml(str(formData, "body", MAX_BODY));

  const supabase = await createClient();
  // Communities: any member may open a topic, but only their moderators may pin or lock it.
  let moderator = scope.type !== "community";
  if (scope.type === "community") {
    const { data: community } = await supabase.from("communities").select("cohort_id").eq("id", scope.id).maybeSingle();
    moderator = Boolean(user.isPlatformAdmin || (community?.cohort_id && user.coordinatorCohorts.includes(community.cohort_id)));
  }
  const column = scope.type === "offering" ? "offering_id" : scope.type === "cohort" ? "cohort_id" : "community_id";
  const { data, error } = await supabase
    .from("discussion_topics")
    .insert({
      [column]: scope.id,
      title,
      body_html: bodyHtml,
      pinned: moderator && bool(formData, "pinned"),
      locked: moderator && bool(formData, "locked"),
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: friendlyError(error, t("disc.errCreate")) };
  refresh(scope);
  return { ok: true, data: { redirectTo: topicPath(scope, data.id) } };
}

/** Adds a post or a reply. Success opens the page that shows it, at its anchor. */
export async function createPost(_prev: unknown, formData: FormData): Promise<ActionResult<{ redirectTo: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: t("msg.sessionExpired") };
  const scope = readScope(formData);
  const topicId = uuid(formData, "topicId");
  const rawParent = str(formData, "parentId", 64);
  const parentId = rawParent ? uuid(formData, "parentId") : null;
  if (!scope || !topicId || (rawParent && !parentId)) return { ok: false, error: t("msg.invalidRequest") };
  const bodyHtml = markdownToSafeHtml(str(formData, "body", MAX_BODY));
  if (!bodyHtml) return { ok: false, error: t("disc.errPost"), fieldErrors: { body: t("disc.errPost") } };

  const topic = await scopedTopic(topicId, scope);
  if (!topic) return { ok: false, error: t("msg.threadGone") };
  if (topic.locked) return { ok: false, error: t("disc.lockedNote") };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("discussion_posts")
    .insert({ topic_id: topicId, parent_id: parentId, author_id: user.id, body_html: bodyHtml })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: friendlyError(error, t("disc.errPostFailed")) };

  let page = Math.max(int(formData, "page") ?? 1, 1);
  if (!parentId) {
    // New top-level posts come last: open the last page.
    const { count } = await supabase.from("discussion_posts").select("id", { count: "exact", head: true }).eq("topic_id", topicId).is("parent_id", null);
    page = Math.max(Math.ceil((count ?? 1) / POSTS_PAGE_SIZE), 1);
  }
  refresh(scope, topicId);
  return { ok: true, data: { redirectTo: `${topicPath(scope, topicId)}?page=${page}#p-${data.id}` } };
}

/** Edits the caller's own post; the replaced text is kept in the post's history. */
export async function editPost(_prev: unknown, formData: FormData): Promise<ActionResult<{ redirectTo: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: t("msg.sessionExpired") };
  const scope = readScope(formData);
  const topicId = uuid(formData, "topicId");
  const postId = uuid(formData, "postId");
  if (!scope || !topicId || !postId) return { ok: false, error: t("msg.invalidRequest") };
  const bodyHtml = markdownToSafeHtml(str(formData, "body", MAX_BODY));
  if (!bodyHtml) return { ok: false, error: t("disc.errPost"), fieldErrors: { body: t("disc.errPost") } };

  const topic = await scopedTopic(topicId, scope);
  if (!topic) return { ok: false, error: t("msg.threadGone") };
  if (topic.locked) return { ok: false, error: t("disc.lockedNote") };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("discussion_posts")
    .update({ body_html: bodyHtml })
    .eq("id", postId)
    .eq("topic_id", topicId)
    .eq("author_id", user.id)
    .select("id");
  if (error) return { ok: false, error: friendlyError(error, t("disc.errPostFailed")) };
  // RLS allows authors to edit only their own posts that are not hidden.
  if (!data || data.length === 0) return { ok: false, error: t("disc.errEditGone") };
  refresh(scope, topicId);
  const page = Math.max(int(formData, "page") ?? 1, 1);
  return { ok: true, data: { redirectTo: `${topicPath(scope, topicId)}?page=${page}#p-${postId}` } };
}

/** Moderators replace a post with a removal notice and record why (audited). */
export async function hidePost(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: t("msg.sessionExpired") };
  const scope = readScope(formData);
  const topicId = uuid(formData, "topicId");
  const postId = uuid(formData, "postId");
  const reason = str(formData, "reason", 500);
  if (!scope || !topicId || !postId) return { ok: false, error: t("msg.invalidRequest") };
  if (reason.length < 3) return { ok: false, error: t("disc.errReason"), fieldErrors: { reason: t("disc.errReason") } };
  if (!(await scopedTopic(topicId, scope))) return { ok: false, error: t("msg.threadGone") };

  const supabase = await createClient();
  const { data: post } = await supabase.from("discussion_posts").select("id").eq("id", postId).eq("topic_id", topicId).maybeSingle();
  if (!post) return { ok: false, error: t("disc.errModerate") };
  const { error } = await supabase.rpc("hide_discussion_post", { p_post: postId, p_reason: reason });
  if (error) return { ok: false, error: friendlyError(error, t("disc.errModerate")) };
  refresh(scope, topicId);
  return { ok: true, message: t("disc.hiddenDone") };
}

/** Moderators pin/unpin or lock/unlock a topic. */
export async function setTopicFlag(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: t("msg.sessionExpired") };
  const scope = readScope(formData);
  const topicId = uuid(formData, "topicId");
  const flag = str(formData, "flag", 16);
  if (!scope || !topicId || (flag !== "pinned" && flag !== "locked")) return { ok: false, error: t("msg.invalidRequest") };
  if (!(await scopedTopic(topicId, scope))) return { ok: false, error: t("msg.threadGone") };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("discussion_topics")
    .update({ [flag]: bool(formData, "value") })
    .eq("id", topicId)
    .select("id");
  if (error) return { ok: false, error: friendlyError(error, t("disc.errModerate")) };
  if (!data || data.length === 0) return { ok: false, error: t("disc.errModerate") };
  refresh(scope, topicId);
  return { ok: true, message: t("disc.topicUpdated") };
}
