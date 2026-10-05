import "server-only";
import { civilOf, timeOfDay } from "@/lib/calendar/dates";
import type { CalendarItem, CalendarItemKind, OfferingRef, CohortRef } from "@/lib/calendar/items";
import { formatDateTime } from "@/lib/time";
import { t, type MessageKey } from "@/i18n";
import type { DisplayItem, EventKind, Tone, WhenLine } from "./types";

const KIND_LABEL: Record<CalendarItemKind, MessageKey> = {
  assignment_due: "cal.kind.assignmentDue",
  quiz_opens: "cal.kind.quizOpens",
  quiz_closes: "cal.kind.quizCloses",
  live_session: "cal.kind.liveSession",
  office_hours: "cal.kind.officeHours",
  event: "cal.kind.event",
};

export function kindLabel(kind: CalendarItemKind): string {
  return t(KIND_LABEL[kind]);
}

/** A time in the viewer's zone, plus the course or event zone reference when it differs. */
function when(label: string, iso: string, tz: string, referenceTz: string, referenceKey: "cal.courseTime" | "cal.eventTime"): WhenLine {
  return {
    label,
    value: formatDateTime(iso, tz),
    reference: referenceTz !== tz ? t(referenceKey, { time: formatDateTime(iso, referenceTz) }) : null,
  };
}

export type DisplayContext = {
  tz: string;
  offerings: Map<string, OfferingRef>;
  cohorts: Map<string, CohortRef>;
  /** Link target to leave out (the page being viewed). */
  currentHref: string;
  canManage: (item: CalendarItem) => boolean;
};

export function toDisplayItem(item: CalendarItem, ctx: DisplayContext): DisplayItem {
  const { tz } = ctx;
  const lines: WhenLine[] = [];
  const notes: string[] = [];
  const badges: { text: string; tone: Tone }[] = [];
  const isEvent = item.type === "live_session" || item.type === "office_hours" || item.type === "event";

  if (item.kind === "assignment_due") {
    if (item.opens) lines.push(when(t("cal.opens"), item.opens, tz, item.referenceTz, "cal.courseTime"));
    lines.push(when(t("cal.due"), item.start, tz, item.referenceTz, "cal.courseTime"));
    if (item.latePolicy === "reject") notes.push(t("cal.lateRejected"));
    else if (item.latePolicy === "accept_flag") {
      if (item.closes && item.closes !== item.due) lines.push(when(t("cal.lateUntil"), item.closes, tz, item.referenceTz, "cal.courseTime"));
      notes.push(t("cal.lateAccepted"));
    }
  } else if (item.kind === "quiz_opens" || item.kind === "quiz_closes") {
    if (item.opens) lines.push(when(t("cal.opens"), item.opens, tz, item.referenceTz, "cal.courseTime"));
    if (item.closes) lines.push(when(t("cal.closes"), item.closes, tz, item.referenceTz, "cal.courseTime"));
    if (item.timeLimitMinutes) lines.push({ label: t("cal.timeLimit"), value: t("cal.minutes", { count: item.timeLimitMinutes }), reference: null });
    if (item.extended && item.originalCloses) notes.push(t("cal.originalClose", { date: formatDateTime(item.originalCloses, tz) }));
  } else {
    lines.push(when(t("cal.starts"), item.start, tz, item.referenceTz, "cal.eventTime"));
    if (item.end) lines.push(when(t("cal.ends"), item.end, tz, item.referenceTz, "cal.eventTime"));
  }

  if (item.cancelled) badges.push({ text: t("cal.cancelled"), tone: "danger" });
  if (item.draft) badges.push({ text: t("cal.draft"), tone: "warning" });
  if (item.submitted) badges.push({ text: t("cal.submitted"), tone: "success" });
  if (item.extended) badges.push({ text: t("cal.extended"), tone: "info" });

  const offering = item.offeringId ? ctx.offerings.get(item.offeringId) ?? null : null;
  const cohort = !item.offeringId && item.cohortId ? ctx.cohorts.get(item.cohortId) ?? null : null;
  const scopeLine = offering
    ? t("cal.scopeCourse", { code: offering.code, title: offering.title })
    : cohort
      ? t("cal.scopeCohort", { name: cohort.name })
      : item.scopeLabel;

  let linkLabel: string;
  if (item.type === "assignment") linkLabel = item.staffView ? t("cal.openGrading") : t("cal.openAssignment");
  else if (item.type === "quiz") linkLabel = t("cal.openQuiz");
  else linkLabel = item.offeringId ? t("cal.openCourseCalendar") : t("cal.openCohortCalendar");
  const link = item.href === ctx.currentHref ? null : { href: item.href, label: linkLabel };

  const manage =
    isEvent && ctx.canManage(item)
      ? {
          eventId: item.sourceId,
          title: item.title,
          kind: item.type as EventKind,
          timezone: item.referenceTz,
          startsAt: item.start,
          endsAt: item.end ?? item.start,
          location: item.location,
          meetingUrl: item.meetingUrl ?? "",
          description: item.description,
          cancelled: item.cancelled,
        }
      : null;

  return {
    key: item.key,
    kind: item.kind,
    kindLabel: kindLabel(item.kind),
    title: item.title,
    day: civilOf(item.start, tz),
    time: timeOfDay(item.start, tz),
    accent: item.accent,
    scopeLabel: item.scopeLabel,
    scopeHeading: offering || !cohort ? t("cal.course") : t("cal.cohort"),
    scopeLine,
    when: lines,
    notes,
    badges,
    cancelled: item.cancelled,
    cancelReason: item.cancelReason,
    location: item.location,
    meetingUrl: item.meetingUrl && /^https:\/\//i.test(item.meetingUrl) ? item.meetingUrl : null,
    description: item.description,
    link,
    icsHref: item.icsHref,
    manage,
  };
}
