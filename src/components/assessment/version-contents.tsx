import { ExternalLink, FileText } from "lucide-react";
import { Disclosure } from "@/components/ui/disclosure";
import { formatBytes } from "@/lib/uploads/mime";
import { t } from "@/i18n";

export type VersionContentsInput = { body_text: string; url: string | null; asset_ids: string[] };
export type VersionAsset = { id: string; filename: string; size_bytes: number; status: string };

/**
 * What one submitted version contains: its text, its https link and its files. Files are
 * always offered as downloads through /api/assets (which checks access again), so code and
 * text files arrive as plain-text attachments and are never rendered or run in the browser.
 * `text="full"` shows the whole text (for graders); the default collapses it.
 */
export function VersionContents({
  version,
  assets,
  text = "collapsed",
}: {
  version: VersionContentsInput;
  assets: Map<string, VersionAsset>;
  text?: "collapsed" | "full";
}) {
  const body = version.body_text ?? "";
  const url = version.url && /^https:\/\//i.test(version.url) ? version.url : null;
  const hasAnything = body.trim() !== "" || url || version.asset_ids.length > 0;
  if (!hasAnything) return <p className="text-sm text-muted">{t("assign.grade.noText")}</p>;
  return (
    <div className="min-w-0 space-y-3 text-sm">
      {body.trim() !== "" ? (
        text === "full" ? (
          <div>
            <p className="font-medium">{t("assign.detail.textExcerpt", { count: body.length })}</p>
            <div className="mt-1 max-h-[32rem] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-canvas px-3 py-2">{body}</div>
          </div>
        ) : (
          <Disclosure summary={t("assign.detail.textExcerpt", { count: body.length })} summaryClassName="font-medium text-primary">
            <div className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-canvas px-3 py-2">{body}</div>
          </Disclosure>
        )
      ) : null}
      {url ? (
        <p className="min-w-0">
          <span className="font-medium">{t("assign.detail.link")}: </span>
          <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 break-all text-primary underline underline-offset-2">
            {url}
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          </a>
        </p>
      ) : null}
      {version.asset_ids.length > 0 ? (
        <div>
          <p className="font-medium">{t("assign.detail.files")}</p>
          <ul className="mt-1 space-y-1">
            {version.asset_ids.map((id) => {
              const a = assets.get(id);
              return (
                <li key={id} className="flex min-w-0 items-start gap-2">
                  <FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  {a && a.status === "ready" ? (
                    <span className="min-w-0 break-all">
                      <a href={`/api/assets/${id}?download=1`} className="text-primary underline underline-offset-2" aria-label={t("assign.detail.download", { name: a.filename })}>
                        {a.filename}
                      </a>{" "}
                      <span className="text-muted">({formatBytes(Number(a.size_bytes))})</span>
                    </span>
                  ) : (
                    <span className="min-w-0 break-all text-muted">{a ? t("assign.detail.fileUnavailable", { name: a.filename }) : t("assign.detail.unknownFile")}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
