"use client";
import { useId, useRef, useState } from "react";
import { Upload as UploadIcon, X, RotateCcw, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { Upload as TusUpload } from "tus-js-client";
import { getBrowserClient } from "@/lib/supabase/browser";
import { publicEnv } from "@/lib/env";
import { registerUpload, finalizeUpload, type UploadPurpose } from "@/app/actions/uploads";
import { guessMime, formatBytes } from "@/lib/uploads/mime";
import { buttonClass } from "@/components/ui/button";
import { t } from "@/i18n";

export type UploadedAsset = { assetId: string; filename: string; size: number; mime: string; status: "ready" | "quarantined" };

type ItemState =
  | { phase: "registering" }
  | { phase: "uploading"; percent: number | null }
  | { phase: "verifying" }
  | { phase: "ready" }
  | { phase: "quarantined" }
  | { phase: "rejected"; message: string }
  | { phase: "error"; message: string }
  | { phase: "canceled" };

type Item = { key: string; file: File; mime: string; state: ItemState; assetId?: string; abort?: () => void };

const TUS_THRESHOLD = 6 * 1024 * 1024;
const TUS_CHUNK = 6 * 1024 * 1024; // Supabase Storage requires 6 MB chunks for resumable uploads.

/**
 * Direct-to-storage uploader. Files go from the browser straight to private Supabase
 * Storage (resumable for large files), never through the web server. The server
 * registers each file first and verifies its size and signature afterwards; only
 * verified files are reported as uploaded.
 */
export function FileUploader({
  purpose,
  offeringId,
  courseVersionId,
  accept,
  multiple = false,
  name,
  label,
  hint,
  initial = [],
  onUploaded,
  disabled,
}: {
  purpose: UploadPurpose;
  offeringId?: string;
  courseVersionId?: string;
  accept?: string;
  multiple?: boolean;
  /** When set, a hidden input with this name carries each verified asset id to the surrounding form. */
  name?: string;
  label: string;
  hint?: string;
  initial?: UploadedAsset[];
  onUploaded?: (asset: UploadedAsset) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [done, setDone] = useState<UploadedAsset[]>(initial);
  const [announcement, setAnnouncement] = useState("");

  const update = (key: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  async function run(item: Item) {
    const { file, mime, key } = item;
    update(key, { state: { phase: "registering" } });
    const reg = await registerUpload({ purpose, filename: file.name, mime, size: file.size, offeringId, courseVersionId });
    if (!reg.ok || !reg.data) {
      const message = reg.ok ? t("common.uploadCouldNotStart") : reg.error;
      update(key, { state: { phase: "rejected", message } });
      setAnnouncement(t("common.uploadSaidError", { name: file.name, error: message }));
      return;
    }
    const { assetId, bucket, objectPath } = reg.data;
    update(key, { assetId, state: { phase: "uploading", percent: file.size > TUS_THRESHOLD ? 0 : null } });

    const supabase = getBrowserClient();
    try {
      if (file.size > TUS_THRESHOLD) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("session");
        await new Promise<void>((resolve, reject) => {
          const upload = new TusUpload(file, {
            endpoint: `${publicEnv.supabaseUrl}/storage/v1/upload/resumable`,
            retryDelays: [0, 2000, 5000, 10000, 20000],
            headers: { authorization: `Bearer ${token}`, "x-upsert": "false" },
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            metadata: { bucketName: bucket, objectName: objectPath, contentType: mime, cacheControl: "3600" },
            chunkSize: TUS_CHUNK,
            onError: (err) => reject(err),
            onProgress: (sent, total) => update(key, { state: { phase: "uploading", percent: Math.floor((sent / total) * 100) } }),
            onSuccess: () => resolve(),
          });
          update(key, {
            abort: () => {
              void upload.abort(true);
              reject(new Error("canceled"));
            },
          });
          upload.start();
        });
      } else {
        const { error } = await supabase.storage.from(bucket).upload(objectPath, file, { contentType: mime, upsert: false });
        if (error) throw new Error(error.message);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "";
      if (reason === "canceled") {
        update(key, { state: { phase: "canceled" }, abort: undefined });
        setAnnouncement(t("common.uploadSaidCanceled", { name: file.name }));
      } else {
        const message = reason === "session" ? t("common.uploadSessionEnded") : t("common.uploadInterrupted");
        update(key, { state: { phase: "error", message }, abort: undefined });
        setAnnouncement(t("common.uploadSaidInterrupted", { name: file.name }));
      }
      return;
    }

    update(key, { state: { phase: "verifying" }, abort: undefined });
    const fin = await finalizeUpload(assetId);
    if (!fin.ok || !fin.data) {
      update(key, { state: { phase: "error", message: fin.ok ? t("common.uploadCouldNotVerify") : fin.error } });
      return;
    }
    if (fin.data.status === "rejected") {
      const reason = fin.data.reason ?? t("common.uploadFileRejected");
      update(key, { state: { phase: "rejected", message: reason } });
      setAnnouncement(t("common.uploadSaidRejected", { name: file.name, reason }));
      return;
    }
    const status = fin.data.status === "quarantined" ? "quarantined" : "ready";
    update(key, { state: { phase: status } });
    const asset: UploadedAsset = { assetId, filename: file.name, size: file.size, mime, status };
    setDone((prev) => (multiple ? [...prev, asset] : [asset]));
    setAnnouncement(t(status === "ready" ? "common.uploadSaidDone" : "common.uploadSaidHeld", { name: file.name }));
    onUploaded?.(asset);
  }

  function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list).slice(0, multiple ? 10 : 1);
    const next: Item[] = files.map((file) => ({
      key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      file,
      mime: guessMime(file.name, file.type),
      state: { phase: "registering" },
    }));
    setItems((prev) => [...prev.filter((i) => !["ready", "quarantined"].includes(i.state.phase)), ...next]);
    next.forEach((it) => void run(it));
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium">{label}</label>
      {hint ? <p id={hintId} className="text-xs text-muted">{hint}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onFiles(e.target.files)}
          className="block w-full max-w-md text-sm file:mr-3 file:min-h-10 file:rounded-md file:border file:border-line file:bg-panel file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-canvas"
        />
        <UploadIcon aria-hidden="true" className="hidden h-5 w-5 text-muted sm:block" />
      </div>
      {name ? done.map((a) => <input key={a.assetId} type="hidden" name={name} value={a.assetId} />) : null}
      {items.length > 0 ? (
        <ul className="space-y-2" aria-label={t("common.uploads")}>
          {items.map((it) => (
            <li key={it.key} className="rounded-md border border-line bg-panel px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-all font-medium">{it.file.name} <span className="font-normal text-muted">({formatBytes(it.file.size)})</span></span>
                <span className="flex items-center gap-2">
                  <StatusText state={it.state} />
                  {it.state.phase === "uploading" && it.abort ? (
                    <button type="button" className={buttonClass("ghost", "sm")} onClick={() => it.abort?.()}>
                      <X aria-hidden="true" className="h-4 w-4" /> {t("common.cancel")}
                    </button>
                  ) : null}
                  {it.state.phase === "error" || it.state.phase === "canceled" ? (
                    <button type="button" className={buttonClass("secondary", "sm")} onClick={() => void run(it)}>
                      <RotateCcw aria-hidden="true" className="h-4 w-4" /> {t("common.uploadRetry")}
                    </button>
                  ) : null}
                </span>
              </div>
              {it.state.phase === "uploading" ? (
                <progress className="mt-2 h-2 w-full" max={100} value={it.state.percent ?? undefined} aria-label={t("common.uploadProgress", { name: it.file.name })} />
              ) : null}
              {it.state.phase === "rejected" || it.state.phase === "error" ? <p className="mt-1 text-danger">{it.state.message}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
  );
}

function StatusText({ state }: { state: ItemState }) {
  switch (state.phase) {
    case "registering":
      return <span className="text-muted">{t("common.uploadPreparing")}</span>;
    case "uploading":
      return <span className="text-muted">{state.percent === null ? t("common.uploadUploading") : t("common.uploadPercent", { percent: state.percent })}</span>;
    case "verifying":
      return <span className="text-muted">{t("common.uploadChecking")}</span>;
    case "ready":
      return <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 aria-hidden="true" className="h-4 w-4" /> {t("common.uploadDone")}</span>;
    case "quarantined":
      return <span className="inline-flex items-center gap-1 text-warning"><Clock aria-hidden="true" className="h-4 w-4" /> {t("common.uploadHeld")}</span>;
    case "rejected":
      return <span className="inline-flex items-center gap-1 text-danger"><AlertCircle aria-hidden="true" className="h-4 w-4" /> {t("common.uploadRejected")}</span>;
    case "error":
      return <span className="inline-flex items-center gap-1 text-danger"><AlertCircle aria-hidden="true" className="h-4 w-4" /> {t("common.uploadFailed")}</span>;
    case "canceled":
      return <span className="text-muted">{t("common.uploadCanceled")}</span>;
  }
}
