import { isUuid } from "@/lib/forms";

// Tool/resource directory rules shared by the server actions, pages and unit tests.

export const TOOL_CATEGORIES = ["setup", "policy", "support", "resource"] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export const TOOL_TITLE_MAX = 300;
export const TOOL_DESCRIPTION_MAX = 1000;
export const TOOL_BODY_MAX = 20_000;
export const TOOL_URL_MAX = 2000;
export const TOOL_POSITION_MAX = 9999;

export function isToolCategory(value: unknown): value is ToolCategory {
  return typeof value === "string" && (TOOL_CATEGORIES as readonly string[]).includes(value);
}

/** Where a resource appears: everyone, one cohort, or one course offering. */
export type ToolScope = { kind: "platform" } | { kind: "cohort"; id: string } | { kind: "offering"; id: string };

export function scopeValue(scope: ToolScope): string {
  return scope.kind === "platform" ? "platform" : `${scope.kind}:${scope.id}`;
}

export function parseToolScope(value: unknown): ToolScope | null {
  if (value === "platform") return { kind: "platform" };
  if (typeof value !== "string") return null;
  const m = /^(cohort|offering):(.+)$/.exec(value);
  if (!m || !isUuid(m[2])) return null;
  return { kind: m[1] as "cohort" | "offering", id: m[2].toLowerCase() };
}

export function scopeOfRow(row: { offering_id: string | null; cohort_id: string | null }): ToolScope {
  if (row.offering_id) return { kind: "offering", id: row.offering_id };
  if (row.cohort_id) return { kind: "cohort", id: row.cohort_id };
  return { kind: "platform" };
}

/**
 * Optional resource link: empty means "no link"; otherwise it must be an absolute
 * https URL with a host and no embedded credentials. Returns the normalized URL.
 */
export function checkResourceUrl(raw: unknown): { ok: true; url: string | null } | { ok: false } {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return { ok: true, url: null };
  if (v.length > TOOL_URL_MAX || /\s/.test(v)) return { ok: false };
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { ok: false };
  }
  if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return { ok: false };
  const normalized = u.toString();
  if (normalized.length > TOOL_URL_MAX) return { ok: false };
  return { ok: true, url: normalized };
}

/** Sort order within a category: a whole number 0–9999; empty means 0. */
export function checkPosition(raw: unknown): number | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return 0;
  if (!/^\d{1,4}$/.test(v)) return null;
  const n = Number(v);
  return n >= 0 && n <= TOOL_POSITION_MAX ? n : null;
}

/** Host shown next to an external link so people know where it goes. */
export function linkHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
