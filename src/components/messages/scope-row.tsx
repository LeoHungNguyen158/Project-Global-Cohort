import Link from "next/link";
import { SquarePen } from "lucide-react";
import { AccentBar } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { composeHref, scopeMessagesHref, type MessageScope, type ScopeRef } from "@/lib/comms/scope";
import { t } from "@/i18n";

/** One course or cohort row (reference layout R3): accent, "ID: <code>", title, counts and New Message. */
export function ScopeRow({
  scope,
  readOnly,
  compose,
}: {
  scope: Pick<MessageScope, "code" | "title" | "accent" | "unread" | "threads"> & ScopeRef;
  readOnly?: boolean;
  /** The title starts a new message instead of opening the conversation list. */
  compose?: boolean;
}) {
  const unreadText =
    scope.unread === 0 ? t("msg.noUnread") : scope.unread === 1 ? t("msg.unreadMessage") : t("msg.unreadMessages", { count: scope.unread });
  const threadsText = scope.threads === 1 ? t("msg.conversation") : t("msg.conversations", { count: scope.threads });
  return (
    <li className="flex rounded-[var(--radius-panel)] border border-line bg-panel">
      <AccentBar color={scope.accent} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-sm text-muted">{t("msg.idLabel", { code: scope.code })}</p>
          <h3 className="font-semibold leading-snug">
            <Link href={compose ? composeHref(scope) : scopeMessagesHref(scope)} className="hover:underline">
              {scope.title}
            </Link>
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            {scope.unread > 0 ? <Badge tone="info">{unreadText}</Badge> : <span>{unreadText}</span>}
            <span aria-hidden="true">·</span>
            <span>{threadsText}</span>
          </p>
        </div>
        {readOnly || compose ? null : (
          <Link href={composeHref(scope)} className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-[0.95rem] text-ink hover:bg-canvas hover:underline">
            <SquarePen aria-hidden="true" className="h-5 w-5" />
            {t("msg.new")}
            <span className="sr-only"> {t("msg.newIn", { code: scope.code })}</span>
          </Link>
        )}
      </div>
    </li>
  );
}
