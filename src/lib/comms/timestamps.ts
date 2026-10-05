// Database timestamps carry microseconds ("2026-10-05T01:16:45.316865+00:00"), more
// than a JavaScript Date keeps. Comparisons use microseconds so ordering and poll
// cursors stay exact.

const TS = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/** Microseconds since the epoch for a database or ISO timestamp, or null when unparseable. */
export function timestampMicros(value: string): number | null {
  const m = TS.exec(value.trim());
  if (!m) return null;
  let zone = m[4] ?? "Z";
  if (/^[+-]\d{2}$/.test(zone)) zone = `${zone}:00`;
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const ms = Date.parse(`${m[1]}T${m[2]}${zone}`);
  if (Number.isNaN(ms)) return null;
  const fraction = Number((m[3] ?? "").slice(0, 6).padEnd(6, "0"));
  return ms * 1000 + fraction;
}

/** Ascending order; unparseable values sort first. */
export function compareTimestamps(a: string | null | undefined, b: string | null | undefined): number {
  const ta = a ? timestampMicros(a) ?? 0 : 0;
  const tb = b ? timestampMicros(b) ?? 0 : 0;
  return ta - tb;
}
