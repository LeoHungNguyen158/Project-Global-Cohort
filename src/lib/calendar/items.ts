import { civilOf, type CivilDate } from "./dates";

// Calendar items are built from rows the signed-in person may read (RLS decides which
// rows exist). due_at, available_from and closes_at stay separate fields all the way to
// the display: an assignment shows on its due date, a quiz shows when it opens and when
// it closes (the learner's own approved extension, if any, replaces the closing time).

export const CALENDAR_ITEM_TYPES = ["assignment", "quiz", "live_session", "office_hours", "event"] as const;
export type CalendarItemType = (typeof CALENDAR_ITEM_TYPES)[number];

export type CalendarItemKind = "assignment_due" | "quiz_opens" | "quiz_closes" | "live_session" | "office_hours" | "event";

export const ICS_KINDS = ["event", "assignment", "quiz-opens", "quiz-closes"] as const;
export type IcsKind = (typeof ICS_KINDS)[number];

export function isCalendarItemType(v: unknown): v is CalendarItemType {
  return typeof v === "string" && (CALENDAR_ITEM_TYPES as readonly string[]).includes(v);
}

export function isIcsKind(v: unknown): v is IcsKind {
  return typeof v === "string" && (ICS_KINDS as readonly string[]).includes(v);
}

export type AssignmentRow = {
  id: string;
  offering_id: string;
  title: string;
  status: string;
  available_from: string | null;
  due_at: string | null;
  closes_at: string | null;
  late_policy: string;
};

export type QuizRow = {
  id: string;
  offering_id: string;
  title: string;
  status: string;
  available_from: string | null;
  closes_at: string | null;
  time_limit_minutes: number | null;
};

export type AccommodationRow = { quiz_id: string; extended_closes_at: string | null };

export type EventRow = {
  id: string;
  offering_id: string | null;
  cohort_id: string | null;
  kind: "live_session" | "office_hours" | "event";
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  location: string;
  meeting_url: string | null;
  cancelled_at: string | null;
  cancel_reason: string;
  sequence: number;
  updated_at?: string | null;
};

export type OfferingRef = {
  id: string;
  code: string;
  title: string;
  timezone: string;
  accent: string;
  cohortId: string;
  /** The viewer teaches or administers this offering (sees drafts; links to staff pages). */
  isStaff: boolean;
};

export type CohortRef = { id: string; code: string; name: string; timezone: string };

export type CalendarItem = {
  key: string;
  kind: CalendarItemKind;
  type: CalendarItemType;
  sourceId: string;
  title: string;
  /** ISO instant: the deadline, the opening/closing time, or the event start. */
  start: string;
  /** Event end; null for deadlines (a point in time). */
  end: string | null;
  offeringId: string | null;
  cohortId: string | null;
  scopeLabel: string;
  accent: string;
  /** IANA zone of the course or event, for the course-time reference. */
  referenceTz: string;
  href: string;
  icsHref: string;
  location: string;
  meetingUrl: string | null;
  description: string;
  cancelled: boolean;
  cancelReason: string;
  draft: boolean;
  submitted: boolean;
  /** The learner's approved extension replaced the quiz closing time. */
  extended: boolean;
  staffView: boolean;
  opens: string | null;
  due: string | null;
  closes: string | null;
  originalCloses: string | null;
  timeLimitMinutes: number | null;
  latePolicy: string | null;
};

const COHORT_ACCENT = "#475569";

function base(partial: Partial<CalendarItem> & Pick<CalendarItem, "key" | "kind" | "type" | "sourceId" | "title" | "start" | "href" | "icsHref">): CalendarItem {
  return {
    end: null,
    offeringId: null,
    cohortId: null,
    scopeLabel: "",
    accent: COHORT_ACCENT,
    referenceTz: "UTC",
    location: "",
    meetingUrl: null,
    description: "",
    cancelled: false,
    cancelReason: "",
    draft: false,
    submitted: false,
    extended: false,
    staffView: false,
    opens: null,
    due: null,
    closes: null,
    originalCloses: null,
    timeLimitMinutes: null,
    latePolicy: null,
    ...partial,
  };
}

export function assignmentItem(a: AssignmentRow, o: OfferingRef, submissionStatus: string | null): CalendarItem | null {
  if (!a.due_at) return null;
  return base({
    key: `assignment:${a.id}`,
    kind: "assignment_due",
    type: "assignment",
    sourceId: a.id,
    title: a.title,
    start: a.due_at,
    offeringId: o.id,
    cohortId: o.cohortId,
    scopeLabel: o.code,
    accent: o.accent,
    referenceTz: o.timezone,
    href: o.isStaff ? `/courses/${o.id}/assignments/${a.id}/grade` : `/courses/${o.id}/assignments/${a.id}`,
    icsHref: `/api/calendar/assignment/${a.id}`,
    draft: a.status === "draft",
    submitted: submissionStatus === "submitted" || submissionStatus === "graded",
    staffView: o.isStaff,
    opens: a.available_from,
    due: a.due_at,
    closes: a.closes_at,
    latePolicy: a.late_policy,
  });
}

export function quizItems(q: QuizRow, o: OfferingRef, accommodation: AccommodationRow | null): CalendarItem[] {
  const extendedClose = accommodation?.extended_closes_at ?? null;
  const closes = extendedClose ?? q.closes_at;
  const extended = Boolean(extendedClose) && extendedClose !== q.closes_at;
  const shared = {
    type: "quiz" as const,
    sourceId: q.id,
    title: q.title,
    offeringId: o.id,
    cohortId: o.cohortId,
    scopeLabel: o.code,
    accent: o.accent,
    referenceTz: o.timezone,
    href: `/courses/${o.id}/quizzes/${q.id}`,
    draft: q.status === "draft",
    staffView: o.isStaff,
    opens: q.available_from,
    closes,
    originalCloses: extended ? q.closes_at : null,
    extended,
    timeLimitMinutes: q.time_limit_minutes,
  };
  const out: CalendarItem[] = [];
  if (q.available_from) {
    out.push(base({ ...shared, key: `quiz-opens:${q.id}`, kind: "quiz_opens", start: q.available_from, icsHref: `/api/calendar/quiz-opens/${q.id}` }));
  }
  if (closes) {
    out.push(base({ ...shared, key: `quiz-closes:${q.id}`, kind: "quiz_closes", start: closes, icsHref: `/api/calendar/quiz-closes/${q.id}` }));
  }
  return out;
}

export function eventItem(e: EventRow, scope: { offering?: OfferingRef | null; cohort?: CohortRef | null }): CalendarItem {
  const o = scope.offering ?? null;
  const c = scope.cohort ?? null;
  return base({
    key: `event:${e.id}`,
    kind: e.kind,
    type: e.kind,
    sourceId: e.id,
    title: e.title,
    start: e.starts_at,
    end: e.ends_at,
    offeringId: e.offering_id,
    cohortId: e.cohort_id ?? o?.cohortId ?? null,
    scopeLabel: o ? o.code : c ? c.name : "",
    accent: o ? o.accent : COHORT_ACCENT,
    referenceTz: e.timezone,
    href: e.offering_id ? `/courses/${e.offering_id}/calendar` : `/calendar?scope=cohort:${e.cohort_id}`,
    icsHref: `/api/calendar/event/${e.id}`,
    location: e.location,
    meetingUrl: e.meeting_url,
    description: e.description,
    cancelled: Boolean(e.cancelled_at),
    cancelReason: e.cancel_reason ?? "",
    staffView: Boolean(o?.isStaff),
  });
}

export function inRange(item: CalendarItem, startUtc: string, endUtc: string): boolean {
  const t = new Date(item.start).getTime();
  return t >= new Date(startUtc).getTime() && t < new Date(endUtc).getTime();
}

export function compareItems(a: CalendarItem, b: CalendarItem): number {
  return new Date(a.start).getTime() - new Date(b.start).getTime() || a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
}

/** Groups items by the civil day of their start in the viewer's zone, in time order. */
export function groupByDay(items: CalendarItem[], tz: string): Map<CivilDate, CalendarItem[]> {
  const map = new Map<CivilDate, CalendarItem[]>();
  for (const item of [...items].sort(compareItems)) {
    const day = civilOf(item.start, tz);
    const list = map.get(day);
    if (list) list.push(item);
    else map.set(day, [item]);
  }
  return map;
}
