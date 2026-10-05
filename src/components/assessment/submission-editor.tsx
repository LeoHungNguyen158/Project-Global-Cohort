"use client";
import { useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import { saveSubmissionDraft, submitAssignmentWork, type Receipt } from "@/app/actions/assignments";
import { FileUploader, type UploadedAsset } from "@/components/uploads/file-uploader";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n/client/assessment";
import { formatDateTime } from "@/lib/time";
import { formatBytes } from "@/lib/uploads/mime";
import type { SubmissionTypeKey } from "@/lib/assessment/assignment-status";

export type EditorAsset = { id: string; filename: string; size: number; status: "ready" | "quarantined" | "pending" | "rejected" | "deleted" | string };

const ACCEPT = ".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.markdown,.csv,.py,.js,.ts,.json,.ipynb,.sql,.r";
const TEXT_MAX = 100_000;

/**
 * The learner's work for one assignment: text, an https link and files, kept as a draft and
 * submitted as numbered versions. Actions are called directly with try/catch, so a dropped
 * connection keeps everything on the page and says nothing was saved. A retry of the same
 * content reuses its idempotency key and returns the original receipt instead of a new version.
 */
export function SubmissionEditor({
  assignmentId,
  offeringId,
  types,
  initialText,
  initialUrl,
  initialAssets,
  initialSavedAt,
  canEdit,
  canSubmit,
  submitBlockedReason,
  nextVersion,
  maxSubmissions,
  lateWarning,
  tz,
}: {
  assignmentId: string;
  offeringId: string;
  types: SubmissionTypeKey[];
  initialText: string;
  initialUrl: string;
  initialAssets: EditorAsset[];
  initialSavedAt: string | null;
  canEdit: boolean;
  canSubmit: boolean;
  submitBlockedReason: string | null;
  nextVersion: number;
  maxSubmissions: number;
  lateWarning: boolean;
  tz: string;
}) {
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState(initialUrl);
  const [assets, setAssets] = useState<EditorAsset[]>(initialAssets);
  const [savedAt, setSavedAt] = useState<string | null>(initialSavedAt);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "draft" | "submit">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // One key per submitted content: kept while the content is unchanged so retries are idempotent.
  const [clientKey, setClientKey] = useState<string | null>(null);

  const allowText = types.includes("text");
  const allowUrl = types.includes("url");
  const allowFiles = types.includes("file");
  const readyIds = assets.filter((a) => a.status === "ready").map((a) => a.id);
  const urlInvalid = url.trim() !== "" && !/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(url.trim());
  const empty = !text.trim() && !url.trim() && readyIds.length === 0;

  function edited() {
    setDirty(true);
    setClientKey(null);
    setNotice(null);
    setError(null);
  }

  function input() {
    return { assignmentId, text: allowText ? text : "", url: allowUrl ? url.trim() : "", assetIds: allowFiles ? readyIds : [] };
  }

  async function saveDraft() {
    setBusy("draft");
    setError(null);
    setNotice(null);
    try {
      const res = await saveSubmissionDraft(input());
      if (!res.ok) setError(res.error);
      else {
        const at = res.data?.savedAt ?? new Date().toISOString();
        setSavedAt(at);
        setDirty(false);
        setNotice(t("assign.detail.draftSaved", { time: formatDateTime(at, tz) }));
      }
    } catch {
      setError(t("assign.err.network"));
    }
    setBusy(null);
  }

  async function submit() {
    if (urlInvalid) {
      setError(t("assign.err.url"));
      return;
    }
    if (empty) {
      setError(t("assign.err.empty"));
      return;
    }
    setBusy("submit");
    setError(null);
    setNotice(null);
    const key = clientKey ?? crypto.randomUUID();
    setClientKey(key);
    try {
      const res = await submitAssignmentWork({ ...input(), clientKey: key });
      if (!res.ok || !res.data) {
        setError(res.ok ? t("assign.err.submitFailed") : res.error);
      } else {
        setReceipt(res.data);
        setSavedAt(res.data.submittedAt);
        setDirty(false);
        setClientKey(null);
      }
    } catch {
      // The submission may or may not have reached the server; retrying with the same key is safe.
      setError(t("assign.err.networkSubmit"));
    }
    setBusy(null);
  }

  return (
    <div className="space-y-5">
      {receipt ? (
        <Alert tone="success" live title={t("assign.detail.receiptTitle")}>
          <p className="font-mono text-sm">{t("assign.detail.receipt", { code: receipt.receiptCode, version: receipt.versionNo, time: formatDateTime(receipt.submittedAt, tz) })}</p>
          {receipt.isLate ? <p className="mt-1">{t("assign.detail.receiptLate")}</p> : null}
          {receipt.duplicate ? <p className="mt-1">{t("assign.detail.receiptDuplicate")}</p> : null}
        </Alert>
      ) : null}

      {allowText ? (
        <div className="space-y-1">
          <label htmlFor="work-text" className="block text-sm font-medium">{t("assign.detail.textLabel")}</label>
          <textarea
            id="work-text"
            value={text}
            disabled={!canEdit || busy !== null}
            maxLength={TEXT_MAX}
            rows={10}
            onChange={(e) => {
              setText(e.target.value);
              edited();
            }}
            aria-describedby="work-text-count"
            className="block min-h-48 w-full rounded-md border border-line bg-white px-3 py-2 text-ink disabled:bg-canvas"
          />
          <p id="work-text-count" className="text-right text-xs text-muted">{t("quiz.attempt.characters", { count: text.length, max: TEXT_MAX })}</p>
        </div>
      ) : null}

      {allowUrl ? (
        <div className="space-y-1">
          <label htmlFor="work-url" className="block text-sm font-medium">{t("assign.detail.urlLabel")}</label>
          <p id="work-url-hint" className="text-xs text-muted">{t("assign.detail.urlHint")}</p>
          <input
            id="work-url"
            type="url"
            inputMode="url"
            value={url}
            disabled={!canEdit || busy !== null}
            maxLength={2000}
            placeholder="https://"
            onChange={(e) => {
              setUrl(e.target.value);
              edited();
            }}
            aria-invalid={urlInvalid}
            aria-describedby={urlInvalid ? "work-url-hint work-url-error" : "work-url-hint"}
            className="block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-ink disabled:bg-canvas aria-[invalid=true]:border-danger"
          />
          {urlInvalid ? <p id="work-url-error" className="text-sm text-danger">{t("assign.err.url")}</p> : null}
        </div>
      ) : null}

      {allowFiles ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">{t("assign.detail.attached")}</p>
            {assets.length === 0 ? (
              <p className="text-sm text-muted">{t("assign.detail.noFiles")}</p>
            ) : (
              <ul className="mt-1 space-y-2">
                {assets.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                      <span className="min-w-0 break-all">
                        {a.status === "ready" ? (
                          <a href={`/api/assets/${a.id}?download=1`} className="text-primary underline underline-offset-2">
                            {a.filename}
                          </a>
                        ) : (
                          a.filename
                        )}{" "}
                        <span className="text-muted">({formatBytes(a.size)})</span>
                      </span>
                    </span>
                    {a.status === "quarantined" ? <span className="text-xs text-warning">{t("assign.detail.heldForReview")}</span> : null}
                    {canEdit ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          setAssets((prev) => prev.filter((x) => x.id !== a.id));
                          edited();
                        }}
                        className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-sm text-danger hover:bg-danger-soft"
                      >
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                        {t("assign.detail.removeFile", { name: a.filename })}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {canEdit ? (
            <FileUploader
              purpose="submission"
              offeringId={offeringId}
              accept={ACCEPT}
              multiple
              label={t("assign.detail.filesLabel")}
              hint={t("assign.detail.filesHint")}
              disabled={busy !== null || assets.length >= 20}
              onUploaded={(asset: UploadedAsset) => {
                setAssets((prev) => (prev.some((x) => x.id === asset.assetId) ? prev : [...prev, { id: asset.assetId, filename: asset.filename, size: asset.size, status: asset.status }]));
                edited();
              }}
            />
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3 border-t border-line pt-4">
        {lateWarning && canSubmit ? <Alert tone="warning">{t("assign.detail.lateWarning")}</Alert> : null}
        {canSubmit ? <p className="text-sm text-muted">{t("assign.detail.submitHint", { version: nextVersion, max: maxSubmissions })}</p> : null}
        {!canSubmit && submitBlockedReason ? <Alert tone="info">{submitBlockedReason}</Alert> : null}
        <div className="flex flex-wrap items-center gap-3">
          {canEdit ? (
            <Button variant="secondary" onClick={() => void saveDraft()} disabled={busy !== null || urlInvalid} aria-busy={busy === "draft"}>
              {busy === "draft" ? t("assign.detail.savingDraft") : t("assign.detail.saveDraft")}
            </Button>
          ) : null}
          <Button onClick={() => void submit()} disabled={!canSubmit || busy !== null} aria-busy={busy === "submit"}>
            {busy === "submit" ? t("assign.detail.submitting") : nextVersion > 1 ? t("assign.detail.resubmit", { version: nextVersion }) : t("assign.detail.submit")}
          </Button>
          <span className="text-sm text-muted" aria-live="polite">
            {dirty ? t("assign.detail.unsaved") : savedAt ? t("assign.detail.lastDraft", { time: formatDateTime(savedAt, tz) }) : ""}
          </span>
        </div>
        <div aria-live="assertive" className="empty:hidden">
          {error ? <Alert tone="error">{error}</Alert> : null}
        </div>
        <div aria-live="polite" className="empty:hidden">
          {notice ? <Alert tone="success">{notice}</Alert> : null}
        </div>
      </div>
    </div>
  );
}
