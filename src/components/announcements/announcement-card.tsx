import Link from "next/link";
import { Pin } from "lucide-react";
import { changeAnnouncement } from "@/app/actions/announcements";
import { ActionForm } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { RichText } from "@/components/ui/rich-text";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDateTime } from "@/lib/time";
import { allowedOps, announcementDate, type AnnouncementState } from "@/lib/comms/announcements";
import type { AnnouncementItem } from "@/lib/comms/announcement-queries";
import { announcementEditorBase, type AnnouncementScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

const STATE_BADGE: Record<AnnouncementState, { tone: "neutral" | "info" | "success" | "warning"; key: "ann.draft" | "ann.scheduled" | "ann.published" | "ann.archived" }> = {
  draft: { tone: "neutral", key: "ann.draft" },
  scheduled: { tone: "warning", key: "ann.scheduled" },
  published: { tone: "success", key: "ann.published" },
  archived: { tone: "neutral", key: "ann.archived" },
};

/**
 * One announcement. The element id `a-<id>` is the anchor used by notifications and
 * links (`…/announcements#a-<id>`, `/cohorts/<id>#a-<id>`). Staff also see its state,
 * how many earlier versions exist, and the actions allowed in that state.
 */
export function AnnouncementCard({
  item,
  state,
  scope,
  scopeName,
  tz,
  manage,
  locked,
  authorFallback,
  level = 3,
}: {
  item: AnnouncementItem;
  state: AnnouncementState;
  scope: AnnouncementScope;
  scopeName: string;
  tz: string;
  /** Staff view: state badges, history link and actions. */
  manage: boolean;
  /** Staff view of an archived course: nothing can be changed. */
  locked?: boolean;
  authorFallback?: string;
  level?: 3 | 4;
}) {
  const H = level === 3 ? "h3" : "h4";
  const titleId = `a-${item.id}-title`;
  const when =
    state === "scheduled"
      ? t("ann.scheduledFor", { time: formatDateTime(item.publishAt, tz) })
      : state === "draft"
        ? t("ann.createdOn", { time: formatDateTime(item.createdAt, tz) })
        : t("ann.postedOn", { time: formatDateTime(announcementDate({ publish_at: item.publishAt, created_at: item.createdAt }), tz) });
  const author = item.authorName ?? authorFallback;
  const editBase = `${announcementEditorBase(scope)}/${item.id}`;
  const badge = STATE_BADGE[state];

  return (
    <article
      id={`a-${item.id}`}
      aria-labelledby={titleId}
      className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-panel px-4 py-4 target:border-primary target:ring-2 target:ring-primary/30 sm:px-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <H id={titleId} className="break-words text-lg font-semibold">{item.title}</H>
          <p className="text-sm text-muted">
            <time dateTime={state === "draft" ? item.createdAt : (item.publishAt ?? item.createdAt)}>{when}</time>
            {author ? ` ${t("ann.by", { name: author })}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {item.pinned ? (
            <Badge tone="info">
              <Pin aria-hidden="true" className="h-3 w-3" /> {t("ann.pinned")}
            </Badge>
          ) : null}
          {manage ? <Badge tone={badge.tone}>{t(badge.key)}</Badge> : null}
          {manage && item.revisions > 0 ? (
            <Link href={`${editBase}/edit#history`} className="text-xs text-muted underline-offset-2 hover:underline">
              {item.revisions === 1 ? t("ann.editedOne") : t("ann.edited", { count: item.revisions })}
            </Link>
          ) : null}
        </div>
      </header>
      <RichText html={item.bodyHtml} className="mt-3 break-words" />
      {manage && !locked ? <Actions item={item} state={state} scope={scope} scopeName={scopeName} editHref={`${editBase}/edit`} /> : null}
    </article>
  );
}

function Actions({
  item,
  state,
  scope,
  scopeName,
  editHref,
}: {
  item: AnnouncementItem;
  state: AnnouncementState;
  scope: AnnouncementScope;
  scopeName: string;
  editHref: string;
}) {
  const ops = allowedOps(state, item.pinned);
  const fields = { announcementId: item.id, scopeType: scope.type, scopeId: scope.id };
  // Each button names its announcement for screen readers ("Archive “Week 3 lab”").
  const named = (label: string) => (
    <>
      {label}
      <span className="sr-only"> “{item.title}”</span>
    </>
  );
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
      {state === "archived" ? (
        <ButtonLink href={`${editHref}#history`} variant="secondary" size="sm">{named(t("ann.viewHistory"))}</ButtonLink>
      ) : (
        <ButtonLink href={editHref} variant="secondary" size="sm">{named(t("ann.edit"))}</ButtonLink>
      )}
      {ops.includes("publish") ? (
        <ConfirmForm
          action={changeAnnouncement}
          fields={{ ...fields, op: "publish" }}
          trigger={named(t("ann.publishNow"))}
          title={t("ann.publishConfirmTitle")}
          description={t("ann.publishConfirmBody", { scope: scopeName })}
          confirmLabel={t("ann.publishNow")}
          triggerVariant="primary"
          size="sm"
        />
      ) : null}
      {ops.includes("unschedule") ? (
        <ConfirmForm
          action={changeAnnouncement}
          fields={{ ...fields, op: "unschedule" }}
          trigger={named(t("ann.toDraft"))}
          title={t("ann.unscheduleConfirmTitle")}
          description={t("ann.unscheduleConfirmBody")}
          confirmLabel={t("ann.toDraft")}
          size="sm"
        />
      ) : null}
      {ops.includes("pin") || ops.includes("unpin") ? (
        <ActionForm action={changeAnnouncement}>
          {Object.entries({ ...fields, op: item.pinned ? "unpin" : "pin" }).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <SubmitButton variant="secondary" size="sm" pendingText={t("ann.saving")}>
            {named(item.pinned ? t("ann.unpin") : t("ann.pin"))}
          </SubmitButton>
        </ActionForm>
      ) : null}
      {ops.includes("archive") ? (
        <ConfirmForm
          action={changeAnnouncement}
          fields={{ ...fields, op: "archive" }}
          trigger={named(t("ann.archive"))}
          title={t("ann.archiveConfirmTitle")}
          description={t("ann.archiveConfirmBody")}
          confirmLabel={t("ann.archive")}
          tone="danger"
          triggerVariant="ghost"
          size="sm"
        />
      ) : null}
      {ops.includes("restore") ? (
        <ActionForm action={changeAnnouncement}>
          {Object.entries({ ...fields, op: "restore" }).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <SubmitButton variant="secondary" size="sm" pendingText={t("ann.saving")}>
            {named(t("ann.restore"))}
          </SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}
