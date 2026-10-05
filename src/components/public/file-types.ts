import type { MessageKey } from "@/i18n";

// Readable names for the upload types configured in the upload_limits table.
const LABELS: Record<string, MessageKey> = {
  "application/pdf": "help.fileType.pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "help.fileType.docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "help.fileType.pptx",
  "image/png": "help.fileType.png",
  "image/jpeg": "help.fileType.jpeg",
  "image/webp": "help.fileType.webp",
  "image/gif": "help.fileType.gif",
  "text/plain": "help.fileType.text",
  "text/markdown": "help.fileType.markdown",
  "text/csv": "help.fileType.csv",
  "video/mp4": "help.fileType.mp4",
  "video/webm": "help.fileType.webm",
  "text/vtt": "help.fileType.vtt",
};

/** Dictionary key for a MIME type's readable name, or null for types without one. */
export function fileTypeLabelKey(mime: string): MessageKey | null {
  return LABELS[mime] ?? null;
}

/** Stable display order: documents, images, text, media; unknown types last. */
export function sortByFileType<T extends { mime: string }>(rows: T[]): T[] {
  const order = Object.keys(LABELS);
  const rank = (m: string) => {
    const i = order.indexOf(m);
    return i === -1 ? order.length : i;
  };
  return [...rows].sort((a, b) => rank(a.mime) - rank(b.mime) || a.mime.localeCompare(b.mime));
}
