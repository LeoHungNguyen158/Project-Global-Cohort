import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/forms";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { ThreadView } from "@/components/messages/thread-view";
import { fetchThreadMessages, loadMessageScopes, loadScopeLabel, loadThread } from "@/lib/comms/queries";
import { timestampMicros } from "@/lib/comms/messages";
import { sameScope, scopeMessagesHref, type ScopeRef } from "@/lib/comms/scope";
import { t } from "@/i18n";

const MESSAGE_LIMIT = 200;

export async function generateMetadata({ params }: { params: Promise<{ threadId: string }> }): Promise<Metadata> {
  const { threadId } = await params;
  const thread = isUuid(threadId) ? await loadThread(threadId) : null;
  return { title: thread?.subject ?? t("msg.title") };
}

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { threadId } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/messages/${threadId}`);
  if (!isUuid(threadId)) notFound();
  // RLS returns conversations only to their participants; everyone else gets 404.
  const thread = await loadThread(threadId);
  if (!thread) notFound();

  const supabase = await createClient();
  const names = new Map(thread.participants.map((p) => [p.userId, p.name]));
  const [{ messages, hasEarlier }, scopes] = await Promise.all([
    fetchThreadMessages(supabase, thread.id, { limit: MESSAGE_LIMIT, names }),
    loadMessageScopes(),
  ]);

  const lastReadAt = thread.participants.find((p) => p.userId === user.id)?.lastReadAt ?? null;
  const since = lastReadAt ? timestampMicros(lastReadAt) : null;
  const unread = messages.filter((m) => m.senderId !== user.id && (since === null || (timestampMicros(m.createdAt) ?? 0) > since));
  // Opening the conversation marks it read and clears its message notifications.
  await supabase.rpc("mark_thread_read", { p_thread: thread.id });

  const scope: ScopeRef | null = thread.offeringId
    ? { type: "offering", id: thread.offeringId }
    : thread.cohortId
      ? { type: "cohort", id: thread.cohortId }
      : null;
  const active = scope ? (scopes.find((s) => sameScope(s, scope)) ?? null) : null;
  const label = active ?? (scope ? await loadScopeLabel(scope) : null);
  const code = label?.code ?? "—";
  const scopeName = label ? `${label.code} · ${label.title}` : t("msg.unknownScope");
  const others = thread.participants.filter((p) => p.userId !== user.id);

  return (
    <>
      <PageHeader
        title={<span className="break-words">{thread.subject}</span>}
        crumbs={[
          { label: t("msg.title"), href: "/messages" },
          scope ? { label: code, href: scopeMessagesHref(scope) } : { label: code },
          { label: thread.subject.length > 60 ? `${thread.subject.slice(0, 57)}…` : thread.subject },
        ]}
        description={t("msg.conversationIn", { scope: scopeName })}
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0 space-y-4">
            <p className="text-sm text-muted">{t("common.timezoneNote", { tz: user.timezone })}.</p>
            <ThreadView
              key={thread.id}
              threadId={thread.id}
              viewerId={user.id}
              tz={user.timezone}
              initialMessages={messages}
              hasEarlier={hasEarlier}
              canReply={Boolean(active)}
              justSent={sp.sent === "1"}
              hadUnread={unread.length > 0}
              firstUnreadId={unread.length > 0 && unread.length < messages.length ? unread[0].id : null}
              signInHref={`/login?next=${encodeURIComponent(`/messages/${thread.id}`)}`}
            />
            {!active ? <Alert tone="info">{t("msg.replyClosed")}</Alert> : null}
          </div>
          <aside className="min-w-0 lg:order-none">
            <Panel aria-labelledby="participants-heading">
              <PanelHeader id="participants-heading" title={t("msg.participants")} level={2} />
              <ul className="space-y-1 px-4 py-3 text-sm sm:px-6">
                <li className="break-words">
                  {user.displayName} <span className="text-muted">{t("msg.youSuffix")}</span>
                </li>
                {others.map((p) => (
                  <li key={p.userId} className="break-words">{p.name}</li>
                ))}
              </ul>
            </Panel>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
