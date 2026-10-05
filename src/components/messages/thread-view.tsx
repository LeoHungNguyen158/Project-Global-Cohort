"use client";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Paperclip, RotateCcw, Send } from "lucide-react";
import { markThreadRead, sendReply } from "@/app/actions/messages";
import type { UploadedAsset } from "@/components/uploads/file-uploader";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Textarea } from "@/components/ui/field";
import { formatBytes } from "@/lib/uploads/mime";
import { formatDateTime } from "@/lib/time";
import {
  latestCursor, mergeMessages, newClientKey, pollAfter, pollDelay, THREAD_POLL_MS, timestampMicros, type ThreadMessage,
} from "@/lib/comms/messages";
import { t } from "@/i18n";
import { AttachmentPicker } from "./attachment-picker";

type PollState = { kind: "ok" } | { kind: "error"; retryIn: number } | { kind: "signedOut" } | { kind: "gone" };
type Problem = { message: string; retry: boolean };

function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return (timestampMicros(b) ?? 0) > (timestampMicros(a) ?? 0) ? b : a;
}

/**
 * An open conversation: messages oldest first, new ones fetched every few seconds
 * while the tab is visible (paused when hidden, backing off after failures), and a
 * reply box that keeps its text until the server confirms the reply was stored.
 */
export function ThreadView({
  threadId,
  viewerId,
  tz,
  initialMessages,
  hasEarlier,
  canReply,
  justSent,
  hadUnread,
  firstUnreadId,
  signInHref,
}: {
  threadId: string;
  viewerId: string;
  tz: string;
  initialMessages: ThreadMessage[];
  hasEarlier: boolean;
  canReply: boolean;
  justSent: boolean;
  hadUnread: boolean;
  firstUnreadId: string | null;
  signInHref: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [propMessages, setPropMessages] = useState(initialMessages);
  const [sentIds, setSentIds] = useState<string[]>([]);
  const [poll, setPoll] = useState<PollState>({ kind: "ok" });
  const [announcement, setAnnouncement] = useState("");
  const cursor = useRef<string | null>(latestCursor(initialMessages));
  const known = useRef(new Set(initialMessages.map((m) => m.id)));
  const pollNow = useRef<() => void>(() => undefined);

  // A server re-render (refresh) brings a fresh copy of the latest messages: merge it.
  if (propMessages !== initialMessages) {
    setPropMessages(initialMessages);
    setMessages((prev) => mergeMessages(prev, initialMessages));
  }

  useEffect(() => {
    cursor.current = later(cursor.current, latestCursor(initialMessages));
    for (const m of initialMessages) known.current.add(m.id);
  }, [initialMessages]);

  // Values from the first render stay put when a refresh re-renders the page.
  const [unreadMarker] = useState(firstUnreadId);
  const [showSent] = useState(justSent);
  const refreshed = useRef(false);

  // The page marked the conversation read while rendering; refresh once so counts
  // rendered alongside it (the navigation badge) reflect that.
  useEffect(() => {
    if (!hadUnread || refreshed.current) return;
    refreshed.current = true;
    router.refresh();
  }, [hadUnread, router]);

  // Drop ?sent=1 from the address so a reload does not repeat the notice.
  useEffect(() => {
    if (showSent) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [showSent]);

  useEffect(() => {
    if (unreadMarker) document.getElementById(`m-${unreadMarker}`)?.scrollIntoView({ block: "nearest" });
  }, [unreadMarker]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let failures = 0;
    let controller: AbortController | null = null;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") timer = setTimeout(run, ms);
    };

    async function run() {
      if (stopped || document.visibilityState !== "visible") return;
      clearTimeout(timer);
      controller?.abort();
      const own = new AbortController();
      controller = own;
      const after = pollAfter(cursor.current);
      const url = `/api/messages/poll?thread=${encodeURIComponent(threadId)}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
      try {
        const res = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: own.signal });
        if (res.status === 401) {
          stopped = true;
          setPoll({ kind: "signedOut" });
          return;
        }
        if (res.status === 404) {
          stopped = true;
          setPoll({ kind: "gone" });
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { thread?: { messages?: ThreadMessage[] } };
        const incoming = body.thread?.messages ?? [];
        failures = 0;
        setPoll({ kind: "ok" });
        if (incoming.length > 0) {
          cursor.current = later(cursor.current, latestCursor(incoming));
          const fresh = incoming.filter((m) => !known.current.has(m.id));
          for (const m of incoming) known.current.add(m.id);
          setMessages((prev) => mergeMessages(prev, incoming));
          const fromOthers = fresh.filter((m) => m.senderId !== viewerId);
          if (fromOthers.length > 0) {
            setAnnouncement(
              fromOthers.length === 1 ? t("msg.newFrom", { name: fromOthers[0].senderName }) : t("msg.newCount", { count: fromOthers.length }),
            );
            // The conversation is open and visible, so what just arrived has been seen.
            markThreadRead(threadId).catch(() => undefined);
          }
        }
      } catch (err) {
        if (own.signal.aborted || (err as Error).name === "AbortError") return;
        failures += 1;
        setPoll({ kind: "error", retryIn: Math.round(pollDelay(failures) / 1000) });
      }
      schedule(pollDelay(failures, THREAD_POLL_MS));
    }

    pollNow.current = () => void run();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void run();
      else {
        clearTimeout(timer);
        controller?.abort();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule(THREAD_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [threadId, viewerId]);

  function onReplySent(message: ThreadMessage) {
    known.current.add(message.id);
    setMessages((prev) => mergeMessages(prev, [message]));
    setSentIds((prev) => [...prev, message.id]);
    requestAnimationFrame(() => document.getElementById(`m-${message.id}`)?.scrollIntoView({ block: "nearest" }));
  }

  return (
    <div className="space-y-6">
      {showSent ? (
        <Alert tone="success" live>
          {t("msg.sentNotice")}
        </Alert>
      ) : null}
      {hasEarlier ? <p className="text-sm text-muted">{t("msg.earlierNotShown", { count: initialMessages.length })}</p> : null}

      <section aria-labelledby={`${threadId}-messages`}>
        <h2 id={`${threadId}-messages`} className="sr-only">{t("msg.messagesHeading")}</h2>
        <ol className="space-y-3">
          {messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              mine={m.senderId === viewerId}
              tz={tz}
              sent={sentIds.includes(m.id)}
              firstUnread={m.id === unreadMarker}
            />
          ))}
        </ol>
      </section>

      <div className="text-sm text-muted">
        {poll.kind === "ok" ? <p>{t("msg.autoUpdate")}</p> : null}
        {poll.kind === "error" ? (
          <p className="flex flex-wrap items-center gap-2">
            <span>{t("msg.pollError", { seconds: poll.retryIn })}</span>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => pollNow.current()}>
              <RotateCcw aria-hidden="true" className="h-4 w-4" /> {t("msg.checkNow")}
            </button>
          </p>
        ) : null}
        {poll.kind === "signedOut" ? (
          <Alert tone="warning">
            <p>{t("msg.sessionEnded")}</p>
            <Link href={signInHref} className="font-medium underline">{t("msg.signIn")}</Link>
          </Alert>
        ) : null}
        {poll.kind === "gone" ? <Alert tone="warning">{t("msg.threadGone")}</Alert> : null}
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>

      {canReply && poll.kind !== "gone" ? <ReplyForm threadId={threadId} onSent={onReplySent} /> : null}
    </div>
  );
}

function MessageItem({ message, mine, tz, sent, firstUnread }: { message: ThreadMessage; mine: boolean; tz: string; sent: boolean; firstUnread: boolean }) {
  return (
    <li id={`m-${message.id}`} className="scroll-mt-24">
      {firstUnread ? (
        <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
          <span aria-hidden="true" className="h-px flex-1 bg-primary/40" />
          {t("msg.unreadDivider")}
          <span aria-hidden="true" className="h-px flex-1 bg-primary/40" />
        </p>
      ) : null}
      <article className={`rounded-[var(--radius-panel)] border px-4 py-3 sm:px-5 ${mine ? "border-[#c7d6fb] bg-primary-soft/50" : "border-line bg-panel"}`}>
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="font-semibold">
            {message.senderName}
            {mine ? <span className="font-normal text-muted"> {t("msg.youSuffix")}</span> : null}
          </h3>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <time dateTime={message.createdAt}>{formatDateTime(message.createdAt, tz)}</time>
            {sent ? (
              <Badge tone="success">
                <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" /> {t("msg.sentLabel")}
              </Badge>
            ) : null}
          </p>
        </header>
        <div className="mt-2 whitespace-pre-wrap break-words">{message.body || t("msg.emptyBodyHidden")}</div>
        {message.attachments.length > 0 ? (
          <div className="mt-3">
            <p className="sr-only">{t("msg.attachmentsLabel")}</p>
            <ul className="flex flex-wrap gap-2">
              {message.attachments.map((a) => (
                <li key={a.id} className="max-w-full">
                  <a
                    href={`/api/assets/${a.id}?download=1`}
                    className="inline-flex max-w-full items-center gap-2 rounded-md border border-line bg-panel px-3 py-1.5 text-sm hover:bg-canvas"
                  >
                    <Paperclip aria-hidden="true" className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 break-all underline">{a.filename}</span>
                    <span className="shrink-0 text-muted">({formatBytes(a.size)})</span>
                    <span className="sr-only">{t("msg.download", { name: a.filename })}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </article>
    </li>
  );
}

function ReplyForm({ threadId, onSent }: { threadId: string; onSent: (message: ThreadMessage) => void }) {
  const fieldId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const keyRef = useRef<string | null>(null);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<UploadedAsset[]>([]);
  const [uploaderKey, setUploaderKey] = useState(0);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [confirmed, setConfirmed] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (pending) return;
    if (!body.trim()) {
      setProblem({ message: t("msg.needBody"), retry: false });
      textRef.current?.focus();
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setProblem({ message: t("msg.offline"), retry: true });
      return;
    }
    keyRef.current ??= newClientKey();
    const formData = new FormData();
    formData.set("threadId", threadId);
    formData.set("clientKey", keyRef.current);
    formData.set("body", body);
    for (const a of attachments) formData.append("assetIds", a.assetId);
    setProblem(null);
    setConfirmed("");
    startTransition(async () => {
      try {
        const result = await sendReply(formData);
        if (result.ok && result.data) {
          keyRef.current = null;
          setBody("");
          setAttachments([]);
          setUploaderKey((k) => k + 1);
          setConfirmed(t("msg.replySent"));
          onSent(result.data.message);
          return;
        }
        setProblem({ message: result.ok ? t("msg.replyFailed") : result.error, retry: false });
      } catch {
        setProblem({ message: t("msg.networkFailed"), retry: true });
      }
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <section aria-labelledby={`${fieldId}-heading`} className="rounded-[var(--radius-panel)] border border-line bg-panel px-4 py-4 sm:px-5">
      <h2 id={`${fieldId}-heading`} className="text-lg font-semibold">{t("msg.replyHeading")}</h2>
      <form onSubmit={onSubmit} className="mt-3 space-y-4" aria-busy={pending || undefined}>
        <div className="space-y-1">
          <label htmlFor={fieldId} className="block text-sm font-medium">{t("msg.replyLabel")}</label>
          <p id={`${fieldId}-hint`} className="text-xs text-muted">{t("msg.bodyHelp")}</p>
          <Textarea
            ref={textRef}
            id={fieldId}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              if (confirmed) setConfirmed("");
            }}
            onKeyDown={onKeyDown}
            readOnly={pending}
            rows={5}
            maxLength={20000}
            aria-describedby={`${fieldId}-hint`}
          />
        </div>
        <Disclosure summary={<span className="inline-flex items-center gap-1"><Paperclip aria-hidden="true" className="h-4 w-4" /> {t("msg.attachFiles")}{attachments.length > 0 ? ` (${attachments.length})` : ""}</span>}>
          <AttachmentPicker value={attachments} onChange={setAttachments} uploaderKey={uploaderKey} disabled={pending} />
        </Disclosure>
        <div aria-live="polite" className="empty:hidden">
          {problem ? (
            <Alert tone="error">
              <p>{problem.message}</p>
              {problem.retry ? (
                <button type="button" className={`${buttonClass("secondary", "sm")} mt-2`} onClick={submit}>
                  <RotateCcw aria-hidden="true" className="h-4 w-4" /> {t("msg.tryAgain")}
                </button>
              ) : null}
            </Alert>
          ) : null}
          {confirmed && !problem ? <Alert tone="success">{confirmed}</Alert> : null}
        </div>
        <button type="submit" className={buttonClass("primary")} disabled={pending} aria-disabled={pending || undefined}>
          <Send aria-hidden="true" className="h-4 w-4" />
          {pending ? t("msg.sending") : t("msg.sendReply")}
        </button>
      </form>
    </section>
  );
}
