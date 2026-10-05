import { isUuid } from "@/lib/forms";

// Messaging scopes: every conversation belongs to exactly one course offering or one
// cohort. These helpers only shape URLs and labels; the database decides who may
// message whom (can_message_in_scope).

export type ScopeType = "offering" | "cohort";
export type ScopeRef = { type: ScopeType; id: string };

export type MessageScope = ScopeRef & {
  code: string;
  title: string;
  accent: string;
  unread: number;
  threads: number;
};

/** Row shape returned by the my_message_scopes() RPC. */
export type MessageScopeRow = {
  scope_type: string;
  scope_id: string;
  code: string;
  title: string;
  accent_color: string;
  unread: number | null;
  thread_count: number | null;
};

type Params = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Reads `?offering=<uuid>` or `?cohort=<uuid>`. Returns null when neither is present
 * and "invalid" when both are present or the id is malformed.
 */
export function parseScopeParams(params: Params): ScopeRef | null | "invalid" {
  const offering = first(params.offering);
  const cohort = first(params.cohort);
  if (offering === undefined && cohort === undefined) return null;
  if (offering !== undefined && cohort !== undefined) return "invalid";
  const id = (offering ?? cohort ?? "").trim();
  if (!isUuid(id)) return "invalid";
  return { type: offering !== undefined ? "offering" : "cohort", id: id.toLowerCase() };
}

export function sameScope(a: ScopeRef, b: ScopeRef): boolean {
  return a.type === b.type && a.id.toLowerCase() === b.id.toLowerCase();
}

export function scopeKey(s: ScopeRef): string {
  return `${s.type}:${s.id.toLowerCase()}`;
}

function query(s: ScopeRef, extra: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams();
  p.set(s.type, s.id);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p.toString();
}

/** `/messages?offering=<id>` — the course menu and notifications link here. */
export function scopeMessagesHref(s: ScopeRef, extra: Record<string, string | undefined> = {}): string {
  return `/messages?${query(s, extra)}`;
}

export function composeHref(s: ScopeRef, to?: string): string {
  return `/messages/new?${query(s, { to: to && isUuid(to) ? to : undefined })}`;
}

export function toMessageScope(row: MessageScopeRow): MessageScope {
  return {
    type: row.scope_type === "cohort" ? "cohort" : "offering",
    id: row.scope_id,
    code: row.code,
    title: row.title,
    accent: /^#[0-9a-f]{6}$/i.test(row.accent_color) ? row.accent_color : "#475569",
    unread: Number(row.unread ?? 0),
    threads: Number(row.thread_count ?? 0),
  };
}

/**
 * A compact fingerprint of what a message list shows (unread and conversation counts
 * per scope). Live lists compare it with the polling endpoint and refresh on change.
 */
export function scopeSignature(unread: number, scopes: { type: string; id: string; unread: number; threads: number }[]): string {
  const parts = scopes
    .map((s) => `${s.type}:${s.id.toLowerCase()}:${s.unread}:${s.threads}`)
    .sort();
  return `${unread}|${parts.join(",")}`;
}
