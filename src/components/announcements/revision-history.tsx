import { Disclosure } from "@/components/ui/disclosure";
import { RichText } from "@/components/ui/rich-text";
import { formatDateTime } from "@/lib/time";
import type { AnnouncementRevision } from "@/lib/comms/announcement-queries";
import { t } from "@/i18n";

/** Earlier versions of a published announcement, newest first (staff only). */
export function RevisionHistory({ revisions, tz, headingLevel = 2 }: { revisions: AnnouncementRevision[]; tz: string; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <section id="history" aria-labelledby="history-heading" className="scroll-mt-24 space-y-3">
      <div>
        <H id="history-heading" className="text-lg font-semibold">{t("ann.historyTitle")}</H>
        <p className="text-sm text-muted">{t("ann.historyIntro")}</p>
      </div>
      {revisions.length === 0 ? (
        <p className="text-sm text-muted">{t("ann.historyEmpty")}</p>
      ) : (
        <ol className="space-y-2">
          {revisions.map((r) => (
            <li key={r.id} className="rounded-md border border-line bg-panel px-4 py-3">
              <Disclosure
                summary={
                  <span>
                    <span className="font-medium">{t("ann.historyItem", { time: formatDateTime(r.editedAt, tz) })}</span>
                    {r.editorName ? <span className="text-muted"> · {t("ann.historyBy", { name: r.editorName })}</span> : null}
                  </span>
                }
              >
                <div className="border-t border-line pt-2">
                  <p className="break-words font-semibold">{r.title}</p>
                  <RichText html={r.bodyHtml} className="mt-1 break-words text-sm" />
                </div>
              </Disclosure>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
