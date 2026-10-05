// Platform settings and upload limits: the file types the server can verify and the
// validation the settings form applies before the database checks again.
import type { MessageKey } from "@/i18n";

export const UPLOAD_PURPOSES = ["lesson", "submission", "message", "avatar"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/** Types with a server-side signature check (src/lib/uploads/signature.ts); others cannot be allowed. */
export const VERIFIABLE_TYPES = [
  { mime: "application/pdf", key: "pdf" },
  { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", key: "docx" },
  { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", key: "pptx" },
  { mime: "image/png", key: "png" },
  { mime: "image/jpeg", key: "jpeg" },
  { mime: "image/webp", key: "webp" },
  { mime: "image/gif", key: "gif" },
  { mime: "text/plain", key: "txt" },
  { mime: "text/markdown", key: "md" },
  { mime: "text/csv", key: "csv" },
  { mime: "text/vtt", key: "vtt" },
  { mime: "video/mp4", key: "mp4" },
  { mime: "video/webm", key: "webm" },
] as const;

const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function isUploadPurpose(value: string): value is UploadPurpose {
  return (UPLOAD_PURPOSES as readonly string[]).includes(value);
}

/** Whether a type may be allowed for a purpose at all (profile photos take still images only). */
export function typeAllowedFor(purpose: UploadPurpose, mime: string): boolean {
  if (!VERIFIABLE_TYPES.some((v) => v.mime === mime)) return false;
  return purpose !== "avatar" || AVATAR_TYPES.has(mime);
}

export function mimeLabelKey(mime: string): MessageKey | null {
  const found = VERIFIABLE_TYPES.find((v) => v.mime === mime);
  return found ? (`admin.settings.type.${found.key}` as MessageKey) : null;
}

export type SettingsInput = { programName: string; supportEmail: string; supportUrl: string };

/** Field error keys (dictionary suffixes under admin.settings.error); empty when valid. */
export function validateSettings(input: SettingsInput): Record<string, "programName" | "supportEmail" | "supportUrl"> {
  const errors: Record<string, "programName" | "supportEmail" | "supportUrl"> = {};
  if (input.programName.length > 120) errors.program_name = "programName";
  if (input.supportEmail && (input.supportEmail.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.supportEmail))) errors.support_email = "supportEmail";
  if (input.supportUrl) {
    let ok = input.supportUrl.length <= 500 && /^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?(\/\S*)?$/.test(input.supportUrl);
    if (ok) {
      try {
        const u = new URL(input.supportUrl);
        ok = u.protocol === "https:" && !u.username && !u.password;
      } catch {
        ok = false;
      }
    }
    if (!ok) errors.support_url = "supportUrl";
  }
  return errors;
}
