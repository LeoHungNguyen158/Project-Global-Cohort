import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { wallTimeToUtcIso } from "@/lib/time";

// Calendar dates are civil dates ("YYYY-MM-DD") in the viewer's time zone. Arithmetic on
// them is pure calendar math (no zone involved); converting a civil day to a UTC range
// happens only at the edges, with the viewer's IANA zone, so DST changes never shift days.

export type CivilDate = string;

export const CALENDAR_VIEWS = ["month", "week", "list"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** Weeks start on Monday (ISO 8601), the common convention for a global cohort. */
export const WEEK_STARTS_ON = 1;

const CIVIL_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function parseCivil(s: string | null | undefined): { y: number; m: number; d: number } | null {
  const match = CIVIL_RE.exec(s ?? "");
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1970 || y > 2200 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function isCivilDate(s: unknown): s is CivilDate {
  return typeof s === "string" && parseCivil(s) !== null;
}

export function isCalendarView(v: unknown): v is CalendarView {
  return typeof v === "string" && (CALENDAR_VIEWS as readonly string[]).includes(v);
}

function utcMs(c: CivilDate): number {
  const p = parseCivil(c);
  if (!p) throw new Error(`Invalid civil date: ${c}`);
  return Date.UTC(p.y, p.m - 1, p.d);
}

function fromUtcMs(ms: number): CivilDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(c: CivilDate, n: number): CivilDate {
  return fromUtcMs(utcMs(c) + n * 86_400_000);
}

/** Adds months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(c: CivilDate, n: number): CivilDate {
  const p = parseCivil(c)!;
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const d = Math.min(p.d, daysInMonth(y, m));
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(c: CivilDate): number {
  return new Date(utcMs(c)).getUTCDay();
}

export function startOfWeek(c: CivilDate, weekStartsOn = WEEK_STARTS_ON): CivilDate {
  return addDays(c, -((weekday(c) - weekStartsOn + 7) % 7));
}

export function startOfMonth(c: CivilDate): CivilDate {
  return `${c.slice(0, 7)}-01`;
}

export function endOfMonth(c: CivilDate): CivilDate {
  const p = parseCivil(c)!;
  return `${c.slice(0, 7)}-${String(daysInMonth(p.y, p.m)).padStart(2, "0")}`;
}

export function daysBetween(from: CivilDate, toExclusive: CivilDate): CivilDate[] {
  const out: CivilDate[] = [];
  for (let d = from; d < toExclusive; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Full weeks covering the anchor's month (4 to 6 rows of 7 days). */
export function monthGrid(anchor: CivilDate, weekStartsOn = WEEK_STARTS_ON): CivilDate[][] {
  const first = startOfMonth(anchor);
  const last = endOfMonth(anchor);
  const weeks: CivilDate[][] = [];
  for (let start = startOfWeek(first, weekStartsOn); start <= last; start = addDays(start, 7)) {
    weeks.push(daysBetween(start, addDays(start, 7)));
  }
  return weeks;
}

export function weekOf(anchor: CivilDate, weekStartsOn = WEEK_STARTS_ON): CivilDate[] {
  const start = startOfWeek(anchor, weekStartsOn);
  return daysBetween(start, addDays(start, 7));
}

/** The civil date of an instant as seen in a zone. */
export function civilOf(instant: string | Date, tz: string): CivilDate {
  const ms = typeof instant === "string" ? new Date(instant).getTime() : instant.getTime();
  return format(new TZDate(ms, tz), "yyyy-MM-dd");
}

export function todayIn(tz: string, now: Date = new Date()): CivilDate {
  return civilOf(now, tz);
}

/** UTC instant of local midnight starting the civil day in the zone. */
export function dayStartUtc(c: CivilDate, tz: string): string {
  const iso = wallTimeToUtcIso(`${c}T00:00`, tz);
  if (!iso) throw new Error(`Invalid civil date: ${c}`);
  return iso;
}

export type ViewRange = {
  view: CalendarView;
  anchor: CivilDate;
  /** Every day rendered (month view includes leading/trailing days of nearby months). */
  days: CivilDate[];
  /** Days whose items are listed (month and list: the month itself; week: the week). */
  from: CivilDate;
  toExclusive: CivilDate;
  prev: CivilDate;
  next: CivilDate;
  /** UTC query range covering every rendered day in the viewer's zone. */
  startUtc: string;
  endUtc: string;
};

export function viewRange(view: CalendarView, anchor: CivilDate, tz: string, weekStartsOn = WEEK_STARTS_ON): ViewRange {
  let days: CivilDate[];
  let from: CivilDate;
  let toExclusive: CivilDate;
  let prev: CivilDate;
  let next: CivilDate;
  if (view === "week") {
    days = weekOf(anchor, weekStartsOn);
    from = days[0];
    toExclusive = addDays(days[6], 1);
    prev = addDays(anchor, -7);
    next = addDays(anchor, 7);
  } else {
    from = startOfMonth(anchor);
    toExclusive = addDays(endOfMonth(anchor), 1);
    days = view === "month" ? monthGrid(anchor, weekStartsOn).flat() : daysBetween(from, toExclusive);
    prev = addMonths(anchor, -1);
    next = addMonths(anchor, 1);
  }
  return {
    view,
    anchor,
    days,
    from,
    toExclusive,
    prev,
    next,
    startUtc: dayStartUtc(days[0], tz),
    endUtc: dayStartUtc(addDays(days[days.length - 1], 1), tz),
  };
}

// Labels for civil dates. They are formatted at UTC midnight so the zone never shifts the day.
const longDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });
const monthYear = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
const shortMonthDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const weekdayLong = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" });
const weekdayShort = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });

export function dayLabel(c: CivilDate): string {
  return longDay.format(new Date(utcMs(c)));
}

export function monthLabel(c: CivilDate): string {
  return monthYear.format(new Date(utcMs(c)));
}

export function shortDayLabel(c: CivilDate): string {
  return shortMonthDay.format(new Date(utcMs(c)));
}

export function weekdayLabels(c: CivilDate): { long: string; short: string } {
  const d = new Date(utcMs(c));
  return { long: weekdayLong.format(d), short: weekdayShort.format(d) };
}

export function dayOfMonth(c: CivilDate): number {
  return parseCivil(c)!.d;
}

/** Time of day of an instant in a zone, without the zone label (e.g. "9:00 AM"). */
export function timeOfDay(instant: string | Date, tz: string): string {
  const ms = typeof instant === "string" ? new Date(instant).getTime() : instant.getTime();
  return format(new TZDate(ms, tz), "h:mm a");
}
