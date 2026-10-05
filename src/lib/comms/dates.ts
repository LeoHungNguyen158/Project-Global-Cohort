// Calendar dates without a time (cohort start and end days) must not shift with the
// viewer's time zone, so they are formatted as written.

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-08-26" -> "Aug 26, 2026"; anything else is returned unchanged. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "";
  const m = DAY.exec(value);
  if (!m) return value;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(d);
}
