"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { isHttpsUrl, str, uuid } from "@/lib/forms";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { isValidTimeZone, wallTimeToUtcIso } from "@/lib/time";
import { t, type MessageKey } from "@/i18n";

// Calendar event actions. Inserts and updates go through the calendar_events RLS policy
// (offering staff with the communicate permission, or cohort administrators); the
// database trigger owns the creator, cancellation actor/time and SEQUENCE. These checks
// only produce clear messages.

type Db = Awaited<ReturnType<typeof createClient>>;

const KINDS = ["live_session", "office_hours", "event"] as const;
const MAX_DURATION_MS = 14 * 24 * 3_600_000;

type EventFields = {
  title: string;
  kind: (typeof KINDS)[number];
  timezone: string;
  starts_at: string;
  ends_at: string;
  location: string;
  meeting_url: string | null;
  description: string;
};

function fail(fieldErrors: Record<string, string>): ActionResult {
  return { ok: false, error: Object.values(fieldErrors)[0] ?? t("cal.err.generic"), fieldErrors };
}

/** Reads and validates the event form; times are entered in the chosen IANA zone. */
function readEvent(fd: FormData): { ok: true; value: EventFields } | { ok: false; fieldErrors: Record<string, string> } {
  const fe: Record<string, string> = {};
  const err = (field: string, key: MessageKey) => {
    if (!fe[field]) fe[field] = t(key);
  };
  const title = str(fd, "title", 400);
  if (title.length < 1 || title.length > 300) err("title", "cal.err.title");
  const kind = str(fd, "kind", 32) as EventFields["kind"];
  if (!KINDS.includes(kind)) err("kind", "cal.err.kind");
  const timezone = str(fd, "timezone", 64);
  const tzOk = timezone !== "" && isValidTimeZone(timezone);
  if (!tzOk) err("timezone", "cal.err.timezone");
  const startLocal = str(fd, "starts_at", 32);
  const endLocal = str(fd, "ends_at", 32);
  const starts = tzOk ? wallTimeToUtcIso(startLocal, timezone) : null;
  const ends = tzOk ? wallTimeToUtcIso(endLocal, timezone) : null;
  if (tzOk && !starts) err("starts_at", "cal.err.start");
  if (tzOk && !ends) err("ends_at", "cal.err.end");
  if (starts && ends) {
    const span = new Date(ends).getTime() - new Date(starts).getTime();
    if (span <= 0) err("ends_at", "cal.err.order");
    else if (span > MAX_DURATION_MS) err("ends_at", "cal.err.tooLong");
  }
  const location = str(fd, "location", 400);
  if (location.length > 300) err("location", "cal.err.location");
  const meeting = str(fd, "meeting_url", 2100);
  if (meeting !== "" && (meeting.length > 2000 || !isHttpsUrl(meeting))) err("meeting_url", "cal.err.meeting");
  const rawDescription = fd.get("description");
  const description = typeof rawDescription === "string" ? rawDescription.replace(/\r\n/g, "\n").trim() : "";
  if (description.length > 5000) err("description", "cal.err.description");
  if (Object.keys(fe).length > 0) return { ok: false, fieldErrors: fe };
  return {
    ok: true,
    value: { title, kind, timezone, starts_at: starts!, ends_at: ends!, location, meeting_url: meeting === "" ? null : meeting, description },
  };
}

function revalidateCalendar(offeringId: string | null) {
  revalidatePath("/calendar");
  if (offeringId) revalidatePath(`/courses/${offeringId}/calendar`);
}

async function offeringArchived(db: Db, offeringId: string | null): Promise<boolean> {
  if (!offeringId) return false;
  const { data } = await db.from("course_offerings").select("status").eq("id", offeringId).maybeSingle();
  return data?.status === "archived";
}

async function loadEvent(db: Db, id: string) {
  const { data } = await db.from("calendar_events").select("id, offering_id, cohort_id, title").eq("id", id).maybeSingle();
  return data as { id: string; offering_id: string | null; cohort_id: string | null; title: string } | null;
}

const signInError: ActionResult = { ok: false, error: t("cal.err.signIn") };

/** Add an event to a course offering or a cohort. */
export async function createEvent(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  if (!(await getCurrentUser())) return signInError;
  const scopeType = str(fd, "scope_type", 16);
  const scopeId = uuid(fd, "scope_id");
  if ((scopeType !== "offering" && scopeType !== "cohort") || !scopeId) return { ok: false, error: t("cal.err.scope") };
  const parsed = readEvent(fd);
  if (!parsed.ok) return fail(parsed.fieldErrors);
  const db = await createClient();
  const offeringId = scopeType === "offering" ? scopeId : null;
  if (await offeringArchived(db, offeringId)) return { ok: false, error: t("cal.manageUnavailableArchived") };
  const { error } = await db
    .from("calendar_events")
    .insert({ ...parsed.value, offering_id: offeringId, cohort_id: scopeType === "cohort" ? scopeId : null })
    .select("id")
    .single();
  if (error) {
    const rls = error.code === "42501" || /row-level security/i.test(error.message ?? "");
    return { ok: false, error: rls ? t("cal.err.scope") : friendlyError(error, t("cal.err.generic")) };
  }
  revalidateCalendar(offeringId);
  return { ok: true, message: t("cal.created", { title: parsed.value.title }) };
}

/** Change an event's details. Every change raises the event's SEQUENCE (database trigger). */
export async function updateEvent(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  if (!(await getCurrentUser())) return signInError;
  const id = uuid(fd, "event_id");
  if (!id) return { ok: false, error: t("cal.err.notFound") };
  const parsed = readEvent(fd);
  if (!parsed.ok) return fail(parsed.fieldErrors);
  const db = await createClient();
  const event = await loadEvent(db, id);
  if (!event) return { ok: false, error: t("cal.err.notFound") };
  if (await offeringArchived(db, event.offering_id)) return { ok: false, error: t("cal.manageUnavailableArchived") };
  const { data, error } = await db.from("calendar_events").update(parsed.value).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error, t("cal.err.generic")) };
  if (!data || data.length === 0) return { ok: false, error: t("cal.err.notFound") };
  revalidateCalendar(event.offering_id);
  return { ok: true, message: t("cal.updated") };
}

async function setCancelled(fd: FormData, cancel: boolean): Promise<ActionResult> {
  if (!(await getCurrentUser())) return signInError;
  const id = uuid(fd, "event_id");
  if (!id) return { ok: false, error: t("cal.err.notFound") };
  const reason = cancel ? str(fd, "reason", 600) : "";
  if (reason.length > 500) return { ok: false, error: t("cal.err.reason"), fieldErrors: { reason: t("cal.err.reason") } };
  const db = await createClient();
  const event = await loadEvent(db, id);
  if (!event) return { ok: false, error: t("cal.err.notFound") };
  if (await offeringArchived(db, event.offering_id)) return { ok: false, error: t("cal.manageUnavailableArchived") };
  // The trigger replaces the time with now() and records who cancelled.
  const patch = cancel ? { cancelled_at: new Date().toISOString(), cancel_reason: reason } : { cancelled_at: null };
  const { data, error } = await db.from("calendar_events").update(patch).eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error, t("cal.err.generic")) };
  if (!data || data.length === 0) return { ok: false, error: t("cal.err.notFound") };
  revalidateCalendar(event.offering_id);
  return { ok: true, message: cancel ? t("cal.cancelledDone") : t("cal.restored") };
}

/** Mark an event cancelled; it stays listed as cancelled so learners notice. */
export async function cancelEvent(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return setCancelled(fd, true);
}

export async function restoreEvent(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return setCancelled(fd, false);
}

/** Permanently delete an event created by mistake (audited by the database trigger). */
export async function deleteEvent(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  if (!(await getCurrentUser())) return signInError;
  const id = uuid(fd, "event_id");
  if (!id) return { ok: false, error: t("cal.err.notFound") };
  const db = await createClient();
  const event = await loadEvent(db, id);
  if (!event) return { ok: false, error: t("cal.err.notFound") };
  if (await offeringArchived(db, event.offering_id)) return { ok: false, error: t("cal.manageUnavailableArchived") };
  const { data, error } = await db.from("calendar_events").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyError(error, t("cal.err.generic")) };
  if (!data || data.length === 0) return { ok: false, error: t("cal.err.notFound") };
  revalidateCalendar(event.offering_id);
  return { ok: true, message: t("cal.deleted") };
}
