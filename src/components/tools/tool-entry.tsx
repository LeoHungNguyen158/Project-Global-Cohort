import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { formatDate } from "@/lib/time";
import { archiveToolResource, restoreToolResource } from "@/app/actions/tools";
import { Badge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { RichText } from "@/components/ui/rich-text";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { t } from "@/i18n";
import { linkHost } from "./validation";
import type { ToolRow } from "./scopes";

/**
 * One Tools entry. The title links to the resource (new tab) when it has a link;
 * Markdown details open in a disclosure. Staff who manage the entry's scope also see
 * its status and the edit, archive or restore controls.
 */
export function ToolEntry({
  row,
  scope,
  canManage,
  timezone,
  returnTo,
  highlighted,
}: {
  row: ToolRow;
  scope: string;
  canManage: boolean;
  timezone: string;
  returnTo: string;
  highlighted: boolean;
}) {
  const headingId = `tool-title-${row.id}`;
  const host = linkHost(row.url);
  const archived = Boolean(row.archived_at);
  return (
    <li
      id={`tool-${row.id}`}
      data-testid="tool-entry"
      data-tool-id={row.id}
      data-state={archived ? "archived" : row.published ? "published" : "draft"}
      className={cn(
        "scroll-mt-20 rounded-[var(--radius-panel)] border border-line bg-panel px-4 py-4 sm:px-5",
        highlighted && "ring-2 ring-primary",
      )}
    >
      <article aria-labelledby={headingId}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 id={headingId} className="min-w-0 break-words font-semibold">
            {row.url ? (
              <a href={row.url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                {row.title}
                <ExternalLink aria-hidden="true" className="ml-1 inline h-4 w-4 align-[-2px]" />
                <span className="sr-only"> {t("tools.opensNewTab")}</span>
              </a>
            ) : (
              row.title
            )}
          </h3>
          {archived ? (
            <Badge>{t("tools.badge.archived")}</Badge>
          ) : !row.published ? (
            <Badge tone="warning">{t("tools.badge.draft")}</Badge>
          ) : null}
        </div>
        <p className="mt-0.5 break-words text-xs text-muted">
          <span className="sr-only">{t("tools.form.scope")}: </span>
          {scope}
          {host ? <span> · {t("tools.linkTo", { host })}</span> : null}
        </p>
        {row.description ? <p className="mt-2 whitespace-pre-line break-words text-sm">{row.description}</p> : null}
        {row.body_html ? (
          <Disclosure
            className="mt-2"
            summaryClassName="text-primary"
            summary={
              <>
                {t("tools.details")}
                <span className="sr-only">: {row.title}</span>
              </>
            }
          >
            <RichText html={row.body_html} className="text-sm" />
          </Disclosure>
        ) : null}
        {canManage ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="mr-auto text-xs text-muted">{t("tools.updated", { date: formatDate(row.updated_at, timezone) })}</span>
            {archived ? (
              <ActionForm action={restoreToolResource}>
                <input type="hidden" name="tool_id" value={row.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                <SubmitButton variant="secondary" size="sm" pendingText={t("common.working")} aria-label={t("tools.restoreFor", { title: row.title })}>
                  {t("tools.restore")}
                </SubmitButton>
              </ActionForm>
            ) : (
              <>
                <Link href={`/tools/${row.id}/edit`} className={buttonClass("secondary", "sm")} aria-label={t("tools.editFor", { title: row.title })}>
                  {t("tools.edit")}
                </Link>
                <ConfirmForm
                  action={archiveToolResource}
                  fields={{ tool_id: row.id, return_to: returnTo }}
                  size="sm"
                  tone="danger"
                  trigger={
                    <>
                      {t("tools.archive")}
                      <span className="sr-only"> {row.title}</span>
                    </>
                  }
                  title={t("tools.archiveTitle", { title: row.title })}
                  description={t("tools.archiveBody")}
                  confirmLabel={t("tools.archive")}
                />
              </>
            )}
          </div>
        ) : null}
      </article>
    </li>
  );
}
