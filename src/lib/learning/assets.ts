import { t } from "@/i18n/client/learning";
import { extensionOf } from "@/lib/uploads/mime";

// Lesson files: how each type is presented and which roles it may take. The
// upload_limits table decides which types can be uploaded at all.

export type AssetRole = "primary" | "attachment" | "captions";
export const ASSET_ROLES: AssetRole[] = ["primary", "captions", "attachment"];

export type AssetKind = "video" | "pdf" | "image" | "captions" | "document" | "presentation" | "text" | "other";

export function assetKind(mime: string): AssetKind {
  if (mime === "video/mp4" || mime === "video/webm") return "video";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime === "text/vtt") return "captions";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "document";
  if (mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "presentation";
  if (mime.startsWith("text/")) return "text";
  return "other";
}

/** Human-readable file type, e.g. "PDF document" or "Text file (.py)". */
export function describeFileType(mime: string, filename: string): string {
  const ext = extensionOf(filename);
  switch (assetKind(mime)) {
    case "video":
      return t("learn.file.video", { format: mime === "video/webm" ? "WebM" : "MP4" });
    case "pdf":
      return t("learn.file.pdf");
    case "image":
      return t("learn.file.image", { format: (ext || mime.split("/")[1] || "").toUpperCase() });
    case "captions":
      return t("learn.file.captions");
    case "document":
      return t("learn.file.docx");
    case "presentation":
      return t("learn.file.pptx");
    case "text":
      return ext ? t("learn.file.textExt", { ext }) : t("learn.file.text");
    default:
      return t("learn.file.other");
  }
}

/** Why a file cannot take a role, or null when it can. */
export function roleProblem(role: AssetRole, mime: string): string | null {
  const kind = assetKind(mime);
  if (role === "captions") return kind === "captions" ? null : t("author.files.captionsMustBeVtt");
  if (role === "primary") return kind === "video" || kind === "pdf" || kind === "image" ? null : t("author.files.primaryKinds");
  return null;
}

/** BCP 47 subset accepted by the database for caption tracks: "en", "vi", "pt-BR". */
export function isCaptionLanguage(code: string): boolean {
  return /^[a-z]{2}(-[A-Z]{2})?$/.test(code);
}

/** Display name of a caption language ("English", "Vietnamese"), falling back to the code. */
export function languageLabel(code: string, displayLocale = "en"): string {
  try {
    const name = new Intl.DisplayNames([displayLocale], { type: "language" }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}
