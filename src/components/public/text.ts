// Small text helpers shared by the account-area pages (catalog, tools, profile, help).
// Pure functions: safe on the server and in the browser, covered by unit tests.

/**
 * Folds text for forgiving search: case-insensitive and accent-insensitive, so
 * "nguyen" finds "Nguyễn" and "ho chi minh" finds "Hồ Chí Minh". Display text is
 * never folded; only the comparison is.
 */
export function foldForSearch(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when every whitespace-separated term of the query appears in one of the fields. */
export function matchesSearch(query: string, fields: (string | null | undefined)[]): boolean {
  const terms = foldForSearch(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fields.map(foldForSearch).join(" \u0000 ");
  return terms.every((term) => haystack.includes(term));
}

export type TemplatePart = { kind: "text"; value: string } | { kind: "slot"; name: string };

/**
 * Splits an interface string such as "Use {link} to reset it." into text and named
 * slots, so a translated sentence can contain links without splitting the sentence
 * into fragments that translators cannot reorder.
 */
export function splitTemplate(template: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  const re = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
  let last = 0;
  for (let m = re.exec(template); m; m = re.exec(template)) {
    if (m.index > last) parts.push({ kind: "text", value: template.slice(last, m.index) });
    parts.push({ kind: "slot", name: m[1] });
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push({ kind: "text", value: template.slice(last) });
  return parts;
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;

/** A configured support email address, or null when missing or not a plausible address. */
export function normalizeSupportEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length < 6 || v.length > 320 || !EMAIL.test(v)) return null;
  return v;
}

/** A configured support page, or null unless it is an https URL without credentials. */
export function normalizeSupportUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 2000) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Removes control characters (keeping line breaks and tabs when asked) and normalizes to NFC. */
export function cleanText(value: string, { multiline = false }: { multiline?: boolean } = {}): string {
  const normalized = value.normalize("NFC").replace(/\r\n?/g, "\n");
  const stripped = multiline
    ? normalized.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    : normalized.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ");
  return stripped.trim();
}
