"use client";
import { useActionState, useId, useState } from "react";
import { Paperclip } from "lucide-react";
import { attachFiles } from "@/app/actions/authoring";
import type { ActionResult } from "@/lib/errors";
import type { AssetRole } from "@/lib/learning/assets";
import { FileUploader } from "@/components/uploads/file-uploader";
import { Field, Input, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { submitWithoutReset } from "@/components/ui/submit-without-reset";
import { t } from "@/i18n/client/learning";

const ACCEPT: Record<AssetRole, string> = {
  primary: "video/mp4,video/webm,.mp4,.m4v,.webm,application/pdf,.pdf,image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif",
  captions: "text/vtt,.vtt",
  attachment: ".pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.py,.js,.ts,.json,.ipynb,.sql,.r,.vtt,.mp4,.webm",
};

/**
 * Upload files straight to private storage, then attach them to the lesson in a role.
 * Only files the server verified are attached; after a successful attach the uploader
 * starts empty again.
 */
export function AttachFilesForm({ offeringId, lessonId, courseVersionId }: { offeringId: string; lessonId: string; courseVersionId: string }) {
  const roleId = useId();
  const langId = useId();
  const [role, setRole] = useState<AssetRole>("attachment");
  const [round, setRound] = useState(0);
  const [state, formAction] = useActionState(async (prev: ActionResult<{ id?: string }> | null, formData: FormData) => {
    try {
      const result = await attachFiles(prev, formData);
      if (result.ok) setRound((r) => r + 1);
      return result;
    } catch {
      return { ok: false as const, error: t("author.err.generic") };
    }
  }, null);

  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="space-y-4">
      <input type="hidden" name="offeringId" value={offeringId} />
      <input type="hidden" name="lessonId" value={lessonId} />
      <p className="text-sm text-muted">{t("author.files.addHelp")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("author.files.roleLabel")} htmlFor={roleId}>
          <Select id={roleId} name="role" value={role} onChange={(e) => setRole(e.target.value as AssetRole)}>
            <option value="attachment">{t("author.files.role.attachment")}</option>
            <option value="primary">{t("author.files.role.primary")}</option>
            <option value="captions">{t("author.files.role.captions")}</option>
          </Select>
        </Field>
        {role === "captions" ? (
          <Field label={t("author.files.language")} htmlFor={langId} hint={t("author.files.languageHint")} required>
            <Input id={langId} name="language" required pattern="[a-z]{2}(-[A-Z]{2})?" maxLength={5} aria-describedby={`${langId}-hint`} autoComplete="off" />
          </Field>
        ) : null}
      </div>
      <FileUploader
        key={round}
        purpose="lesson"
        courseVersionId={courseVersionId}
        name="assetIds"
        multiple
        accept={ACCEPT[role]}
        label={t("author.files.upload")}
      />
      <SubmitButton variant="secondary" pendingText={t("author.files.attaching")}>
        <Paperclip aria-hidden="true" className="h-4 w-4" /> {t("author.files.attach")}
      </SubmitButton>
      <div aria-live="polite" className="empty:hidden">
        {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
        {state && state.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}
      </div>
    </form>
  );
}
