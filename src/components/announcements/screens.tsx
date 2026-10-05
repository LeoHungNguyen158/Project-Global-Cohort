import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Panel } from "@/components/ui/panel";
import { ClearParams } from "@/components/messages/clear-param";
import { announcementState } from "@/lib/comms/announcements";
import type { AnnouncementItem, AnnouncementRevision } from "@/lib/comms/announcement-queries";
import type { AnnouncementScope } from "@/lib/comms/paths";
import { t, type MessageKey } from "@/i18n";
import { AnnouncementCard } from "./announcement-card";
import { AnnouncementEditor } from "./announcement-editor";
import { RevisionHistory } from "./revision-history";
import { SectionTitle } from "./section-title";

const SAVED: Record<string, MessageKey> = {
  draft: "ann.savedDraft",
  published: "ann.savedPublished",
  scheduled: "ann.savedScheduled",
  changes: "ann.savedChanges",
};

/** Confirmation after the editor saved (the list is opened with ?saved=…#a-<id>). */
export function SavedNotice({ saved }: { saved: string | string[] | undefined }) {
  const key = typeof saved === "string" ? SAVED[saved] : undefined;
  if (!key) return null;
  return (
    <>
      <Alert tone="success" live className="mb-4">
        {t(key)}
      </Alert>
      <ClearParams names={["saved"]} />
    </>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <p className="mb-3 text-sm">
      <Link href={href} className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" /> {label}
      </Link>
    </p>
  );
}

/** "New announcement" screen for a course or a cohort. */
export function NewAnnouncementScreen({ scope, scopeLabel, tz, listHref }: { scope: AnnouncementScope; scopeLabel: string; tz: string; listHref: string }) {
  return (
    <>
      <BackLink href={listHref} label={t("ann.backToList")} />
      <SectionTitle description={t("ann.createIn", { scope: scopeLabel })}>{t("ann.createTitle")}</SectionTitle>
      <Panel className="max-w-3xl px-4 py-5 sm:px-6">
        <AnnouncementEditor scope={scope} tz={tz} cancelHref={listHref} />
      </Panel>
    </>
  );
}

/**
 * Edit screen with the revision history underneath. Archived announcements (and
 * everything in an archived course) are shown read-only with the reason.
 */
export function EditAnnouncementScreen({
  scope,
  scopeLabel,
  item,
  revisions,
  tz,
  listHref,
  lockedReason,
}: {
  scope: AnnouncementScope;
  scopeLabel: string;
  item: AnnouncementItem;
  revisions: AnnouncementRevision[];
  tz: string;
  listHref: string;
  /** Set when nothing may be changed (archived course). */
  lockedReason?: string;
}) {
  const state = announcementState({ status: item.status, publish_at: item.publishAt });
  const readOnly = Boolean(lockedReason) || state === "archived";
  return (
    <>
      <BackLink href={listHref} label={t("ann.backToList")} />
      <SectionTitle description={scopeLabel}>{readOnly ? t("ann.historyFor", { title: item.title }) : t("ann.editTitle")}</SectionTitle>
      <div className="max-w-3xl space-y-8">
        {readOnly ? (
          <div className="space-y-3">
            <Alert tone="info">{lockedReason ?? t("ann.archivedNoEdit")}</Alert>
            <AnnouncementCard item={item} state={state} scope={scope} scopeName={scopeLabel} tz={tz} manage locked level={3} />
          </div>
        ) : (
          <Panel className="px-4 py-5 sm:px-6">
            <AnnouncementEditor scope={scope} item={item} state={state} tz={tz} cancelHref={listHref} />
          </Panel>
        )}
        <RevisionHistory revisions={revisions} tz={tz} />
      </div>
    </>
  );
}
