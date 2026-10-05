import { Lock, Pin } from "lucide-react";
import { createPost, editPost, hidePost, setTopicFlag } from "@/app/actions/discussions";
import { ResilientForm, ResilientSubmit } from "@/components/messages/resilient-form";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, Input } from "@/components/ui/field";
import { Pagination } from "@/components/ui/pagination";
import { RichText } from "@/components/ui/rich-text";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDateTime } from "@/lib/time";
import { buildPostTree, MAX_INDENT_DEPTH, type PostNode } from "@/lib/comms/discussions";
import type { PostRevision, TopicDetail } from "@/lib/comms/discussion-queries";
import { topicPath, type DiscussionScope } from "@/lib/comms/paths";
import { t } from "@/i18n";
import { PostBodyField } from "./post-body-field";

type Ctx = {
  scope: DiscussionScope;
  topicId: string;
  viewerId: string;
  tz: string;
  canPost: boolean;
  canModerate: boolean;
  revisions: Map<string, PostRevision[]>;
  page: number;
};

function Hidden({ fields }: { fields: Record<string, string> }) {
  return (
    <>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

/**
 * A discussion topic: opening post, moderation controls, one page of top-level posts
 * with their replies (indented up to a limit, each reply labeled with whom it answers),
 * and the forms to post, reply and edit. Stored HTML was sanitized on save and is
 * sanitized again when rendered.
 */
export function TopicView({
  scope,
  detail,
  revisions,
  viewerId,
  tz,
  canPost,
  closedNote,
  page,
  pages,
  level = 3,
}: {
  scope: DiscussionScope;
  detail: TopicDetail;
  revisions: Map<string, PostRevision[]>;
  viewerId: string;
  tz: string;
  canPost: boolean;
  closedNote: string | null;
  page: number;
  pages: number;
  /** Heading level of the sections inside the topic (the topic title is one level above). */
  level?: 2 | 3;
}) {
  const topic = detail.topic;
  const H = level === 2 ? "h2" : "h3";
  const tree = buildPostTree(detail.posts);
  const base = { scopeType: scope.type, scopeId: scope.id, topicId: topic.id };
  const ctx: Ctx = { scope, topicId: topic.id, viewerId, tz, canPost, canModerate: detail.can_moderate, revisions, page };
  const scopeWord = scope.type === "offering" ? t("disc.scopeCourse") : scope.type === "cohort" ? t("disc.scopeCohort") : t("disc.scopeCommunity");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
        {topic.pinned ? (
          <Badge tone="info">
            <Pin aria-hidden="true" className="h-3 w-3" /> {t("disc.pinned")}
          </Badge>
        ) : null}
        {topic.locked ? (
          <Badge tone="warning">
            <Lock aria-hidden="true" className="h-3 w-3" /> {t("disc.locked")}
          </Badge>
        ) : null}
        <span>
          {topic.author_name
            ? t("disc.startedByOn", { name: topic.author_name, time: formatDateTime(topic.created_at, tz) })
            : t("disc.startedOn", { time: formatDateTime(topic.created_at, tz) })}
        </span>
      </div>

      {detail.can_moderate ? (
        <section aria-label={t("disc.moderation")} className="flex flex-wrap items-start gap-2 rounded-md border border-line bg-panel px-4 py-3">
          <p className="w-full text-sm text-muted">{t("disc.manageNote")}</p>
          <ActionForm action={setTopicFlag}>
            <Hidden fields={{ ...base, flag: "pinned", value: topic.pinned ? "0" : "1" }} />
            <SubmitButton variant="secondary" size="sm" pendingText={t("ann.saving")}>
              {topic.pinned ? t("disc.unpin") : t("disc.pin")}
            </SubmitButton>
          </ActionForm>
          <ActionForm action={setTopicFlag}>
            <Hidden fields={{ ...base, flag: "locked", value: topic.locked ? "0" : "1" }} />
            <SubmitButton variant="secondary" size="sm" pendingText={t("ann.saving")}>
              {topic.locked ? t("disc.unlock") : t("disc.lock")}
            </SubmitButton>
          </ActionForm>
        </section>
      ) : null}

      {topic.body_html ? (
        <section aria-label={t("disc.opening")} className="rounded-[var(--radius-panel)] border border-line bg-panel px-4 py-4 sm:px-6">
          <RichText html={topic.body_html} className="break-words" />
        </section>
      ) : null}

      <p className="text-sm text-muted">
        {t("disc.scopeNote", { scope: scopeWord })} {t("common.timezoneNote", { tz })}.
      </p>
      {closedNote ? <Alert tone="info">{closedNote}</Alert> : null}

      <section aria-labelledby="posts-heading" className="space-y-3">
        <H id="posts-heading" className="text-lg font-semibold">
          {t("disc.postsHeading")}
          {pages > 1 ? <span className="text-base font-normal text-muted"> · {t("disc.pageOf", { page, pages })}</span> : null}
        </H>
        {tree.length === 0 ? (
          <p className="text-sm text-muted">{t("disc.noPosts")}</p>
        ) : (
          <ol className="space-y-3">
            {tree.map((post) => (
              <PostItem key={post.id} post={post} ctx={ctx} />
            ))}
          </ol>
        )}
        <Pagination page={page} pages={pages} hrefFor={(p) => `${topicPath(scope, topic.id)}${p > 1 ? `?page=${p}` : ""}`} />
      </section>

      {canPost ? (
        <section aria-labelledby="add-post-heading" className="rounded-[var(--radius-panel)] border border-line bg-panel px-4 py-4 sm:px-6">
          <H id="add-post-heading" className="text-lg font-semibold">{t("disc.addPost")}</H>
          <ResilientForm action={createPost} resetOnSuccess className="mt-3 space-y-3" failureMessage={t("disc.errPostUnconfirmed")}>
            <Hidden fields={{ ...base, page: String(page) }} />
            <PostBodyField id="new-post" label={t("disc.postLabel")} rows={6} />
            <ResilientSubmit pendingText={t("disc.posting")}>{t("disc.post")}</ResilientSubmit>
          </ResilientForm>
        </section>
      ) : null}
    </div>
  );
}

function PostItem({ post, ctx }: { post: PostNode; ctx: Ctx }) {
  const mine = post.author_id === ctx.viewerId;
  const hidden = Boolean(post.hidden_at);
  const author = post.author_name ?? t("msg.role.participant");
  const history = ctx.revisions.get(post.id) ?? [];
  const fields = { scopeType: ctx.scope.type, scopeId: ctx.scope.id, topicId: ctx.topicId, page: String(ctx.page) };
  const indent = post.depth < MAX_INDENT_DEPTH;

  return (
    <li>
      <article
        id={`p-${post.id}`}
        aria-labelledby={`p-${post.id}-by`}
        className={`scroll-mt-24 rounded-[var(--radius-panel)] border px-4 py-3 target:border-primary target:ring-2 target:ring-primary/30 sm:px-5 ${mine ? "border-[#c7d6fb] bg-primary-soft/40" : "border-line bg-panel"}`}
      >
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p id={`p-${post.id}-by`} className="font-semibold">
            {author}
            {mine ? <span className="font-normal text-muted"> {t("disc.you")}</span> : null}
          </p>
          <p className="text-sm text-muted">
            <time dateTime={post.created_at}>{formatDateTime(post.created_at, ctx.tz)}</time>
            {post.edited_at && !hidden ? <> · {t("disc.edited", { time: formatDateTime(post.edited_at, ctx.tz) })}</> : null}
          </p>
        </header>
        {post.depth > 0 && post.parentAuthor ? <p className="text-xs text-muted">{t("disc.inReplyTo", { name: post.parentAuthor })}</p> : null}
        {hidden ? (
          <div className="mt-2 rounded-md border border-dashed border-line bg-canvas px-3 py-2 text-sm">
            <p className="font-medium">{t("disc.hiddenByModerator")}</p>
            {post.hidden_reason ? <p className="text-muted">{t("disc.hiddenReason", { reason: post.hidden_reason })}</p> : null}
          </div>
        ) : (
          <RichText html={post.body_html} className="mt-2 break-words" />
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {/* Keys change when a reply is added or the post is edited, so the form closes afterwards. */}
          {ctx.canPost && !hidden ? (
            <Disclosure key={`reply-${post.replies.length}`} summary={t("disc.reply")} className="open:basis-full">
              <ResilientForm action={createPost} resetOnSuccess className="space-y-3" failureMessage={t("disc.errPostUnconfirmed")}>
                <Hidden fields={{ ...fields, parentId: post.id }} />
                <PostBodyField id={`reply-${post.id}`} label={t("disc.replyLabel", { name: author })} rows={4} />
                <ResilientSubmit size="sm" pendingText={t("disc.posting")}>{t("disc.sendReply")}</ResilientSubmit>
              </ResilientForm>
            </Disclosure>
          ) : null}
          {ctx.canPost && mine && !hidden ? (
            <Disclosure key={`edit-${post.edited_at ?? ""}`} summary={t("disc.edit")} className="open:basis-full">
              <ResilientForm action={editPost} className="space-y-3" failureMessage={t("disc.errPostUnconfirmed")}>
                <Hidden fields={{ ...fields, postId: post.id }} />
                <PostBodyField id={`edit-${post.id}`} label={t("disc.editLabel")} html={post.body_html} rows={4} />
                <ResilientSubmit size="sm" pendingText={t("ann.saving")}>{t("disc.saveEdit")}</ResilientSubmit>
              </ResilientForm>
            </Disclosure>
          ) : null}
          {history.length > 0 ? (
            <Disclosure summary={t("disc.history", { count: history.length })} className="open:basis-full">
              <ol className="space-y-2">
                {history.map((rev) => (
                  <li key={rev.id} className="rounded-md border border-line bg-canvas px-3 py-2">
                    <p className="text-xs font-medium text-muted">{t("disc.historyItem", { time: formatDateTime(rev.edited_at, ctx.tz) })}</p>
                    <RichText html={rev.body_html} className="mt-1 break-words" />
                  </li>
                ))}
              </ol>
            </Disclosure>
          ) : null}
          {ctx.canModerate && !hidden ? (
            <ConfirmForm
              action={hidePost}
              fields={{ scopeType: ctx.scope.type, scopeId: ctx.scope.id, topicId: ctx.topicId, postId: post.id }}
              trigger={
                <>
                  {t("disc.hide")}
                  <span className="sr-only"> {t("disc.postBy", { name: author })}</span>
                </>
              }
              title={t("disc.hideTitle")}
              description={t("disc.hideBody")}
              confirmLabel={t("disc.hideConfirm")}
              tone="danger"
              triggerVariant="ghost"
              size="sm"
            >
              <Field label={t("disc.hideReason")} htmlFor={`reason-${post.id}`} required>
                <Input id={`reason-${post.id}`} name="reason" required minLength={3} maxLength={500} autoComplete="off" />
              </Field>
            </ConfirmForm>
          ) : null}
        </div>
      </article>
      {post.replies.length > 0 ? (
        <ol className={`mt-3 space-y-3 ${indent ? "ml-2 border-l-2 border-line pl-3 sm:ml-4 sm:pl-5" : ""}`}>
          {post.replies.map((reply) => (
            <PostItem key={reply.id} post={reply} ctx={ctx} />
          ))}
        </ol>
      ) : null}
    </li>
  );
}
