"use client";
import { useState, type Dispatch, type SetStateAction } from "react";
import { Paperclip, X } from "lucide-react";
import { FileUploader, type UploadedAsset } from "@/components/uploads/file-uploader";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { formatBytes } from "@/lib/uploads/mime";
import { t } from "@/i18n";

/** create_thread/send_message accept at most this many attachments per message. */
export const MAX_ATTACHMENTS = 10;

/** File types accepted for message attachments (the database's upload_limits decides). */
export const MESSAGE_ACCEPT = ".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv";

/**
 * Message attachments. Files upload straight to private storage through the shared
 * uploader; only verified files are attached, listed here with a Remove button, and
 * sent as `assetIds`. Files held for review are reported and never attached.
 */
export function AttachmentPicker({
  value,
  onChange,
  uploaderKey,
  disabled,
}: {
  value: UploadedAsset[];
  onChange: Dispatch<SetStateAction<UploadedAsset[]>>;
  /** Changing this clears the uploader's own list (after a message was sent). */
  uploaderKey: string | number;
  disabled?: boolean;
}) {
  const [held, setHeld] = useState<string[]>([]);
  const full = value.length >= MAX_ATTACHMENTS;

  return (
    <div className="space-y-3">
      <FileUploader
        key={uploaderKey}
        purpose="message"
        multiple
        accept={MESSAGE_ACCEPT}
        label={t("msg.attachments")}
        hint={t("msg.attachmentsHelp")}
        disabled={disabled || full}
        onUploaded={(asset) => {
          if (asset.status !== "ready") {
            setHeld((prev) => [...prev, asset.filename]);
            return;
          }
          onChange((prev) => (prev.some((a) => a.assetId === asset.assetId) || prev.length >= MAX_ATTACHMENTS ? prev : [...prev, asset]));
        }}
      />
      {full ? <p className="text-sm text-muted">{t("msg.maxAttachments", { count: MAX_ATTACHMENTS })}</p> : null}
      {value.length > 0 ? (
        <div>
          <p className="text-sm font-medium">{t("msg.attachedHeading")}</p>
          <ul className="mt-1 space-y-1">
            {value.map((a) => (
              <li key={a.assetId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-canvas px-3 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Paperclip aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 break-all">{a.filename}</span>
                  <span className="shrink-0 text-muted">({formatBytes(a.size)})</span>
                </span>
                <button
                  type="button"
                  className={buttonClass("ghost", "sm")}
                  onClick={() => onChange((prev) => prev.filter((x) => x.assetId !== a.assetId))}
                  aria-label={t("msg.removeAttachment", { name: a.filename })}
                  disabled={disabled}
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {value.map((a) => (
        <input key={a.assetId} type="hidden" name="assetIds" value={a.assetId} />
      ))}
      {held.length > 0 ? (
        <Alert tone="warning">
          {held.map((name, i) => (
            <p key={`${name}-${i}`}>{t("msg.heldForReview", { name })}</p>
          ))}
        </Alert>
      ) : null}
    </div>
  );
}
