// Accepted upload types. The database table `upload_limits` is the source of truth
// for which types and sizes each purpose accepts; this map only helps the browser
// pick a declared type when it reports none (or a non-standard one).

const BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  vtt: "text/vtt",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  // Source code is accepted as plain text.
  py: "text/plain",
  js: "text/plain",
  ts: "text/plain",
  json: "text/plain",
  ipynb: "text/plain",
  sql: "text/plain",
  r: "text/plain",
};

export const KNOWN_MIME_TYPES = Array.from(new Set(Object.values(BY_EXTENSION)));

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

/** Declared type for a file: the browser's type when known, else by extension. */
export function guessMime(filename: string, browserType: string): string {
  if (browserType && KNOWN_MIME_TYPES.includes(browserType)) return browserType;
  return BY_EXTENSION[extensionOf(filename)] ?? (browserType || "application/octet-stream");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
