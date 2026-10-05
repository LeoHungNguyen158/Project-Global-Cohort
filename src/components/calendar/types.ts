import type { CalendarView, CivilDate } from "@/lib/calendar/dates";
import type { CalendarItemKind } from "@/lib/calendar/items";

// Serializable calendar data for the client board. Built on the server from rows the
// viewer may read; all times are already formatted in the viewer's time zone.

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export type WhenLine = { label: string; value: string; reference: string | null };

export type EventKind = "live_session" | "office_hours" | "event";

/** Present only when the viewer may change this event. */
export type EventManage = {
  eventId: string;
  title: string;
  kind: EventKind;
  timezone: string;
  startsAt: string;
  endsAt: string;
  location: string;
  meetingUrl: string;
  description: string;
  cancelled: boolean;
};

export type DisplayItem = {
  key: string;
  kind: CalendarItemKind;
  kindLabel: string;
  title: string;
  /** Civil day of the item in the viewer's zone. */
  day: CivilDate;
  /** Time of day in the viewer's zone, e.g. "9:00 AM". */
  time: string;
  accent: string;
  scopeLabel: string;
  scopeHeading: string;
  scopeLine: string;
  when: WhenLine[];
  notes: string[];
  badges: { text: string; tone: Tone }[];
  cancelled: boolean;
  cancelReason: string;
  location: string;
  meetingUrl: string | null;
  description: string;
  link: { href: string; label: string } | null;
  icsHref: string;
  manage: EventManage | null;
};

export type DayCell = {
  date: CivilDate;
  label: string;
  weekdayShort: string;
  weekdayLong: string;
  dom: number;
  /** Inside the displayed month or week (leading/trailing month-grid days are false). */
  inPeriod: boolean;
  isToday: boolean;
};

export type ManageScope = { scopeType: "offering" | "cohort"; scopeId: string; scopeWord: string; defaultTz: string };

export type BoardData = {
  view: CalendarView;
  days: DayCell[];
  weeks: DayCell[][];
  items: DisplayItem[];
  caption: string;
  emptyText: string;
  timezones: string[];
};
