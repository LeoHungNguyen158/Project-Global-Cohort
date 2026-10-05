import Link from "next/link";
import { saveAnnouncement } from "@/app/actions/announcements";
import { ResilientForm, ResilientSubmit } from "@/components/messages/resilient-form";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/datetime-field";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { MarkdownField } from "@/components/ui/markdown-field";
import { formatDateTime } from "@/lib/time";
import type { AnnouncementState, PublishMode } from "@/lib/comms/announcements";
import type { AnnouncementItem } from "@/lib/comms/announcement-queries";
import type { AnnouncementScope } from "@/lib/comms/paths";
import { t, type MessageKey } from "@/i18n";

const MODE_LABEL: Record<PublishMode, MessageKey> = {
  draft: "ann.modeDraft",
  now: "ann.modeNow",
  schedule: "ann.modeSchedule",
  keep: "ann.modeKeepSchedule",
};

/**
 * Create or edit an announcement. Drafts and scheduled announcements choose how to
 * publish; a published one keeps its publication and its replaced version goes to the
 * revision history. Times are entered in the viewer's zone and stored in UTC.
 */
export function AnnouncementEditor({
  scope,
  item,
  state,
  tz,
  cancelHref,
}: {
  scope: AnnouncementScope;
  item?: AnnouncementItem;
  state?: AnnouncementState;
  tz: string;
  cancelHref: string;
}) {
  const current = item ? (state ?? "draft") : null;
  const modes: PublishMode[] = current === "scheduled" ? ["keep", "schedule", "now", "draft"] : current === "published" ? [] : ["draft", "now", "schedule"];
  const defaultMode: PublishMode = current === "scheduled" ? "keep" : "draft";
  const label = (mode: PublishMode) =>
    mode === "keep" && item?.publishAt ? t("ann.keepScheduleAt", { time: formatDateTime(item.publishAt, tz) }) : t(MODE_LABEL[mode]);

  return (
    <ResilientForm action={saveAnnouncement} className="space-y-5" aria-label={item ? t("ann.editTitle") : t("ann.createTitle")}>
      <input type="hidden" name="scopeType" value={scope.type} />
      <input type="hidden" name="scopeId" value={scope.id} />
      {item ? <input type="hidden" name="announcementId" value={item.id} /> : null}
      <Field label={t("ann.formTitle")} htmlFor="ann-title" required>
        <Input id="ann-title" name="title" defaultValue={item?.title ?? ""} required maxLength={300} autoComplete="off" />
      </Field>
      <MarkdownField name="body" label={t("ann.formBody")} html={item?.bodyHtml ?? ""} rows={10} required />
      <Checkbox name="pinned" label={t("ann.formPinned")} defaultChecked={item?.pinned ?? false} />
      {current === "published" ? (
        <>
          <input type="hidden" name="mode" value="keep" />
          <Alert tone="info">{t("ann.editPublishedNote")}</Alert>
        </>
      ) : (
        <fieldset className="space-y-2 rounded-md border border-line px-4 py-3">
          <legend className="px-1 text-sm font-medium">{t("ann.publication")}</legend>
          {modes.map((mode) => (
            <label key={mode} className="flex min-h-10 items-start gap-2 text-sm">
              <input type="radio" name="mode" value={mode} defaultChecked={mode === defaultMode} className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]" />
              <span>{label(mode)}</span>
            </label>
          ))}
          <DateTimeField
            name="scheduleAt"
            label={t("ann.scheduleAt")}
            tz={tz}
            defaultValue={current === "scheduled" ? item?.publishAt : null}
            hint={`${t("ann.scheduleOnlyHint")} ${t("ann.scheduleHelp")}`}
          />
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <ResilientSubmit pendingText={t("ann.saving")}>{item ? t("ann.saveChanges") : t("ann.save")}</ResilientSubmit>
        <Link href={cancelHref} className={buttonClass("ghost")}>
          {t("msg.cancel")}
        </Link>
      </div>
    </ResilientForm>
  );
}
