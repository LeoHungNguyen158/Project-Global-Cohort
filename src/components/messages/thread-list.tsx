import Link from "next/link";
import { Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/time";
import { summarizeNames } from "@/lib/comms/messages";
import { threadPath } from "@/lib/comms/paths";
import type { ThreadSummary } from "@/lib/comms/queries";
import { t } from "@/i18n";

/** Conversations in one scope: subject, people (names only), last activity and unread state. */
export function ThreadList({ threads, tz, others }: { threads: ThreadSummary[]; tz: string; others: Map<string, number> }) {
  return (
    <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-panel">
      {threads.map((th) => {
        const unread = th.unread > 0;
        const total = others.get(th.id) ?? th.participantNames.length;
        const { shown, more } = summarizeNames(th.participantNames, total);
        const people = shown.length === 0 ? t("msg.onlyYou") : more > 0 ? `${shown.join(", ")} ${t("msg.andMore", { count: more })}` : shown.join(", ");
        return (
          <li key={th.id} className={`relative flex gap-3 px-4 py-3 sm:px-6 ${unread ? "bg-primary-soft/60" : ""}`}>
            <span aria-hidden="true" className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${unread ? "bg-primary" : "bg-transparent"}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className={`min-w-0 break-words ${unread ? "font-semibold" : "font-medium"}`}>
                  <Link href={threadPath(th.id)} prefetch={false} className="hover:underline">
                    {th.subject}
                  </Link>
                </h3>
                <p className="text-sm text-muted">
                  <time dateTime={th.lastMessageAt}>{t("msg.lastActivity", { time: formatDateTime(th.lastMessageAt, tz) })}</time>
                </p>
              </div>
              <p className="text-sm text-muted">{t("msg.with", { names: people })}</p>
              {th.preview ? (
                <p className="mt-0.5 line-clamp-2 break-words text-sm">
                  {th.lastSender ? <span className="font-medium">{t("msg.lastFrom", { name: th.lastSender })} </span> : null}
                  {th.preview}
                </p>
              ) : null}
              {unread ? <Badge tone="info" className="mt-1">{t("msg.unread", { count: th.unread })}</Badge> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function AttachmentIcon() {
  return <Paperclip aria-hidden="true" className="h-4 w-4 shrink-0" />;
}
