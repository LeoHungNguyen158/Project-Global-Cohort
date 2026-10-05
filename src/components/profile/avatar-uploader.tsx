"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUploader } from "@/components/uploads/file-uploader";
import { Alert } from "@/components/ui/alert";
import { setAvatar } from "@/app/actions/profile";
import { t } from "@/i18n";

/**
 * Uploads a photo (purpose "avatar": verified private upload) and, once the server has
 * verified the file, makes it the profile photo. Success is shown only after the
 * profile update is confirmed.
 */
export function AvatarUploader() {
  const router = useRouter();
  const [status, setStatus] = useState<{ tone: "info" | "success" | "warning" | "error"; text: string } | null>(null);
  const [, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <FileUploader
        purpose="avatar"
        accept="image/png,image/jpeg,image/webp"
        label={t("profile.photoUpload")}
        hint={t("profile.photoHint")}
        onUploaded={(asset) => {
          if (asset.status !== "ready") {
            setStatus({ tone: "warning", text: t("profile.photoHeld") });
            return;
          }
          setStatus({ tone: "info", text: t("profile.photoSaving") });
          startTransition(async () => {
            const result = await setAvatar(asset.assetId);
            if (result.ok) {
              setStatus({ tone: "success", text: result.message ?? t("profile.photoSaved") });
              router.refresh();
            } else {
              setStatus({ tone: "error", text: result.error });
            }
          });
        }}
      />
      <div aria-live="polite">{status ? <Alert tone={status.tone}>{status.text}</Alert> : null}</div>
    </div>
  );
}
