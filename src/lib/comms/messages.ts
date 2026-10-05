// Thread message helpers shared by the thread page, the reply form and the polling
// endpoint. Timestamps are the database's own strings (microsecond precision); they
// are compared numerically so a poll cursor never skips or repeats a message.
import { timestampMicros } from "./timestamps";

export { timestampMicros };

export type MessageAttachment = { id: string; filename: string; size: number; mime: string };

export type ThreadMessage = {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  attachments: MessageAttachment[];
};

/** Polling interval while a conversation is open and visible. */
export const THREAD_POLL_MS = 10_000;
/** Polling interval for conversation lists. */
export const LIST_POLL_MS = 30_000;
export const MAX_POLL_MS = 120_000;

/** A poll cursor must be a timestamp; anything else is rejected before it reaches a query. */
export function isValidCursor(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length <= 64 && timestampMicros(value) !== null;
}

function compare(a: ThreadMessage, b: ThreadMessage): number {
  const ta = timestampMicros(a.createdAt) ?? 0;
  const tb = timestampMicros(b.createdAt) ?? 0;
  return ta - tb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Merges newly fetched messages into the list: no duplicates, oldest first. */
export function mergeMessages(current: ThreadMessage[], incoming: ThreadMessage[]): ThreadMessage[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values()).sort(compare);
}

/** The newest message's timestamp, used as the `after` cursor for the next poll. */
export function latestCursor(messages: ThreadMessage[]): string | null {
  let best: ThreadMessage | null = null;
  for (const m of messages) if (!best || compare(m, best) > 0) best = m;
  return best?.createdAt ?? null;
}

/** Messages from other people newer than the viewer's last read time. */
export function countUnread(messages: Pick<ThreadMessage, "senderId" | "createdAt">[], viewerId: string, lastReadAt: string | null): number {
  const since = lastReadAt ? timestampMicros(lastReadAt) : null;
  return messages.filter((m) => m.senderId !== viewerId && (since === null || (timestampMicros(m.createdAt) ?? 0) > since)).length;
}

/** Exponential backoff after failed polls, capped. */
export function pollDelay(failures: number, base = THREAD_POLL_MS, max = MAX_POLL_MS): number {
  if (failures <= 0) return base;
  return Math.min(base * 2 ** Math.min(failures, 10), max);
}

/** "Jonas Weber, Mai Trần and 3 more" style summary (names only). */
export function summarizeNames(names: string[], total: number, max = 3): { shown: string[]; more: number } {
  const shown = names.slice(0, max);
  return { shown, more: Math.max(total - shown.length, 0) };
}

/** Client keys make create/send idempotent when a person retries after a network failure. */
export function isClientKey(value: string): boolean {
  return /^[A-Za-z0-9-]{8,64}$/.test(value);
}

/**
 * A fresh idempotency key for one message. It is created in the browser when a send
 * is first attempted, reused for retries of that attempt, and replaced after success.
 */
export function newClientKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** How far each poll reaches back before the newest message already shown. */
export const POLL_OVERLAP_MS = 5_000;

/**
 * The `after` value for the next poll: slightly before the newest message held, so a
 * message whose transaction committed a moment late is still picked up. Messages that
 * come back twice are merged away by id.
 */
export function pollAfter(cursor: string | null, overlapMs = POLL_OVERLAP_MS): string | null {
  if (!cursor) return null;
  const micros = timestampMicros(cursor);
  if (micros === null) return null;
  return new Date(Math.floor(micros / 1000) - overlapMs).toISOString();
}
