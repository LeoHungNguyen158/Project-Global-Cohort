import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/** Supported display timezones (IANA). Any valid IANA zone is accepted; these are offered in pickers. */
export const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Ho_Chi_Minh",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function toDate(value: string | Date): Date {
  return typeof value === "string" ? new Date(value) : value;
}

/** Short zone label such as "EDT" or "GMT+7" for a moment in a zone. */
export function zoneAbbreviation(value: string | Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(toDate(value));
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
}

/** e.g. "Oct 5, 2026, 9:00 AM EDT". Stored values are UTC; display is in the viewer's zone. */
export function formatDateTime(value: string | Date | null | undefined, tz: string): string {
  if (!value) return "";
  const d = new TZDate(toDate(value).getTime(), tz);
  return `${format(d, "MMM d, yyyy, h:mm a")} ${zoneAbbreviation(value, tz)}`;
}

export function formatDate(value: string | Date | null | undefined, tz: string): string {
  if (!value) return "";
  return format(new TZDate(toDate(value).getTime(), tz), "MMM d, yyyy");
}

export function formatTime(value: string | Date, tz: string): string {
  return `${format(new TZDate(toDate(value).getTime(), tz), "h:mm a")} ${zoneAbbreviation(value, tz)}`;
}

/** Show the viewer's time, plus the course-time reference when the zones differ. */
export function formatWithCourseTime(value: string | Date | null | undefined, viewerTz: string, courseTz: string): string {
  if (!value) return "";
  const mine = formatDateTime(value, viewerTz);
  if (viewerTz === courseTz) return mine;
  return `${mine} (course time: ${formatDateTime(value, courseTz)})`;
}

/**
 * Convert a wall-clock "YYYY-MM-DDTHH:mm" entered in a given zone into a UTC ISO string.
 * DST gaps resolve forward per TZDate semantics.
 */
export function wallTimeToUtcIso(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const zoned = new TZDate(y, mo - 1, d, h, mi, 0, tz);
  return new Date(zoned.getTime()).toISOString();
}

/** Inverse of wallTimeToUtcIso, for prefilling datetime-local inputs. */
export function utcToWallTime(value: string | null | undefined, tz: string): string {
  if (!value) return "";
  return format(new TZDate(new Date(value).getTime(), tz), "yyyy-MM-dd'T'HH:mm");
}

export function relativeDays(value: string | Date, now = new Date()): number {
  return Math.round((toDate(value).getTime() - now.getTime()) / 86_400_000);
}
