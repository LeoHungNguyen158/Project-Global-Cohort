// Success notices for actions whose page changes shape afterwards (the button that ran
// them disappears: a published draft, a removed lesson, a revoked override). The action
// redirects back with ?notice=<code>, and the page shows the message only when its own
// data agrees (for example "published" only on a published version).

export const NOTICES = [
  "published",
  "released",
  "adopted",
  "moduleRemoved",
  "lessonRemoved",
  "fileRemoved",
  "ruleRemoved",
  "overrideRevoked",
] as const;

export type Notice = (typeof NOTICES)[number];

export function parseNotice(value: string | string[] | undefined | null): Notice | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && (NOTICES as readonly string[]).includes(v) ? (v as Notice) : null;
}

/** `path` with the notice added to its query string. */
export function withNotice(path: string, notice: Notice): string {
  const [base, hash = ""] = path.split("#", 2);
  const joined = `${base}${base.includes("?") ? "&" : "?"}notice=${notice}`;
  return hash ? `${joined}#${hash}` : joined;
}
