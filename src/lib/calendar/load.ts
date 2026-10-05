import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserContext } from "@/lib/auth";
import { listMyOfferings, offeringTitle, type OfferingSummary } from "@/lib/data/offerings";
import {
  assignmentItem,
  compareItems,
  eventItem,
  inRange,
  quizItems,
  type AccommodationRow,
  type AssignmentRow,
  type CalendarItem,
  type CalendarItemType,
  type CohortRef,
  type EventRow,
  type OfferingRef,
  type QuizRow,
} from "./items";

// Calendar data, read as the signed-in person: RLS decides which assignments, quizzes and
// events exist for them (learners never see drafts or unavailable work; cohort events
// only for cohorts they belong to). Accommodations and submissions are the person's own.

type Db = SupabaseClient;

export const EVENT_COLUMNS =
  "id, offering_id, cohort_id, kind, title, description, starts_at, ends_at, timezone, location, meeting_url, cancelled_at, cancel_reason, sequence, updated_at";

export function offeringRef(o: OfferingSummary, user: UserContext): OfferingRef {
  const isStaff = user.staff.some((s) => s.offering_id === o.id) || user.isPlatformAdmin || user.coordinatorCohorts.includes(o.cohort_id);
  return { id: o.id, code: o.code, title: offeringTitle(o), timezone: o.timezone, accent: o.accent_color, cohortId: o.cohort_id, isStaff };
}

export type CalendarSources = { offerings: OfferingRef[]; cohorts: CohortRef[] };

/** The person's own courses (taught or taken) and every cohort they belong to. */
export async function loadCalendarSources(db: Db, user: UserContext): Promise<CalendarSources> {
  const [offerings, cohortsRes] = await Promise.all([listMyOfferings(), db.from("cohorts").select("id, code, name, timezone").order("name")]);
  const mine = offerings.filter((o) => user.staff.some((s) => s.offering_id === o.id) || user.enrollments.some((e) => e.offering_id === o.id));
  return {
    offerings: mine.map((o) => offeringRef(o, user)).sort((a, b) => a.code.localeCompare(b.code)),
    cohorts: (cohortsRes.data ?? []) as CohortRef[],
  };
}

const EVENT_TYPES: CalendarItemType[] = ["live_session", "office_hours", "event"];

/**
 * Items whose time (deadline, opening/closing time or event start) falls in
 * [startUtc, endUtc), for the given courses and cohorts, optionally one item type.
 */
export async function loadCalendarItems(
  db: Db,
  userId: string,
  sources: CalendarSources,
  range: { startUtc: string; endUtc: string },
  type: CalendarItemType | null,
): Promise<CalendarItem[]> {
  const offeringIds = sources.offerings.map((o) => o.id);
  const learnerOfferingIds = sources.offerings.filter((o) => !o.isStaff).map((o) => o.id);
  const cohortIds = sources.cohorts.map((c) => c.id);
  const want = (t: CalendarItemType) => type === null || type === t;
  const wantEvents = type === null || EVENT_TYPES.includes(type);

  const none = Promise.resolve({ data: [] as unknown[], error: null });
  const eventQuery = (column: "offering_id" | "cohort_id", ids: string[]) => {
    let q = db.from("calendar_events").select(EVENT_COLUMNS).in(column, ids).gte("starts_at", range.startUtc).lt("starts_at", range.endUtc);
    if (type && EVENT_TYPES.includes(type)) q = q.eq("kind", type);
    return q;
  };
  const [asgRes, quizRes, accRes, subRes, offeringEventsRes, cohortEventsRes] = await Promise.all([
    want("assignment") && offeringIds.length > 0
      ? db
          .from("assignments")
          .select("id, offering_id, title, status, available_from, due_at, closes_at, late_policy")
          .in("offering_id", offeringIds)
          .neq("status", "archived")
          .gte("due_at", range.startUtc)
          .lt("due_at", range.endUtc)
      : none,
    want("quiz") && offeringIds.length > 0
      ? db.from("quizzes").select("id, offering_id, title, status, available_from, closes_at, time_limit_minutes").in("offering_id", offeringIds).neq("status", "archived")
      : none,
    want("quiz") && learnerOfferingIds.length > 0 ? db.from("quiz_accommodations").select("quiz_id, extended_closes_at").eq("user_id", userId) : none,
    want("assignment") && learnerOfferingIds.length > 0
      ? db.from("submissions").select("assignment_id, status").eq("user_id", userId).in("offering_id", learnerOfferingIds)
      : none,
    wantEvents && offeringIds.length > 0 ? eventQuery("offering_id", offeringIds) : none,
    wantEvents && cohortIds.length > 0 ? eventQuery("cohort_id", cohortIds) : none,
  ]);
  for (const r of [asgRes, quizRes, accRes, subRes, offeringEventsRes, cohortEventsRes]) {
    if (r.error) throw new Error(`calendar: ${r.error.message}`);
  }

  const offeringById = new Map(sources.offerings.map((o) => [o.id, o]));
  const cohortById = new Map(sources.cohorts.map((c) => [c.id, c]));
  const accommodations = new Map(((accRes.data ?? []) as AccommodationRow[]).map((a) => [a.quiz_id, a]));
  const submissions = new Map(((subRes.data ?? []) as { assignment_id: string; status: string }[]).map((s) => [s.assignment_id, s.status]));

  const items: CalendarItem[] = [];
  for (const a of (asgRes.data ?? []) as AssignmentRow[]) {
    const o = offeringById.get(a.offering_id);
    if (!o) continue;
    const item = assignmentItem(a, o, o.isStaff ? null : submissions.get(a.id) ?? null);
    if (item) items.push(item);
  }
  for (const q of (quizRes.data ?? []) as QuizRow[]) {
    const o = offeringById.get(q.offering_id);
    if (!o) continue;
    for (const item of quizItems(q, o, o.isStaff ? null : accommodations.get(q.id) ?? null)) {
      if (inRange(item, range.startUtc, range.endUtc)) items.push(item);
    }
  }
  const seen = new Set<string>();
  for (const e of [...((offeringEventsRes.data ?? []) as EventRow[]), ...((cohortEventsRes.data ?? []) as EventRow[])]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const o = e.offering_id ? offeringById.get(e.offering_id) ?? null : null;
    const c = e.cohort_id ? cohortById.get(e.cohort_id) ?? null : null;
    if (!o && !c) continue;
    items.push(eventItem(e, { offering: o, cohort: c }));
  }
  return items.sort(compareItems);
}
