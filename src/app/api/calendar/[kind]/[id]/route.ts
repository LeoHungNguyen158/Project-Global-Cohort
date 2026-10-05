import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { isUuid } from "@/lib/forms";
import { formatDateTime } from "@/lib/time";
import { getOffering, offeringTitle } from "@/lib/data/offerings";
import { buildIcs, icsFileName, type IcsEvent } from "@/lib/calendar/ics";
import { isIcsKind } from "@/lib/calendar/items";
import { EVENT_COLUMNS } from "@/lib/calendar/load";
import { t } from "@/i18n";

const noStore = { "Cache-Control": "private, no-store" };

/** SEQUENCE for deadlines: minutes since the epoch of the last change, so re-downloads replace older copies. */
function sequenceFrom(updatedAt: string | null | undefined): number {
  const ms = updatedAt ? Date.parse(updatedAt) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 60_000) : 0;
}

/**
 * One-item .ics download for an event, an assignment deadline or a quiz opening/closing.
 * There is no feed and no token: the signed-in person's session is checked here (route
 * handlers are not covered by the page middleware) and the item is read as that person,
 * so RLS decides access. Anything they may not read is a 404.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await ctx.params;
  const notFound = () => new NextResponse("Not found", { status: 404, headers: noStore });
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Sign in required", { status: 401, headers: noStore });
  if (!isIcsKind(kind) || !isUuid(id)) return notFound();

  const db = await createClient();
  const base = serverEnv().appBaseUrl;
  const tz = user.timezone;
  const courseLine = async (offeringId: string) => {
    const o = await getOffering(offeringId);
    return o ? t("cal.scopeCourse", { code: o.code, title: offeringTitle(o) }) : "";
  };
  const isStaff = (offeringId: string) => user.staff.some((s) => s.offering_id === offeringId) || user.isPlatformAdmin;

  let event: IcsEvent;
  if (kind === "event") {
    const { data } = await db.from("calendar_events").select(EVENT_COLUMNS).eq("id", id).maybeSingle();
    if (!data) return notFound();
    const e = data as {
      id: string;
      offering_id: string | null;
      cohort_id: string | null;
      title: string;
      description: string;
      starts_at: string;
      ends_at: string;
      location: string;
      meeting_url: string | null;
      cancelled_at: string | null;
      cancel_reason: string;
      sequence: number;
      updated_at: string | null;
    };
    let scope = "";
    if (e.offering_id) scope = await courseLine(e.offering_id);
    else if (e.cohort_id) {
      const { data: cohort } = await db.from("cohorts").select("name").eq("id", e.cohort_id).maybeSingle();
      scope = cohort ? t("cal.scopeCohort", { name: cohort.name as string }) : "";
    }
    const parts = [
      e.cancelled_at ? `${t("cal.cancelledNote")}${e.cancel_reason ? ` ${t("cal.cancelReason", { reason: e.cancel_reason })}` : ""}` : "",
      scope,
      e.description,
      e.meeting_url && /^https:\/\//i.test(e.meeting_url) ? `${t("cal.joinMeeting")} (${t("cal.externalLink")}): ${e.meeting_url}` : "",
    ].filter(Boolean);
    event = {
      uid: `event-${e.id}@crew-scaler-lms`,
      start: e.starts_at,
      end: e.ends_at,
      summary: e.cancelled_at ? `${t("cal.cancelled")}: ${e.title}` : e.title,
      description: parts.join("\n\n"),
      location: e.location,
      url: e.offering_id ? `${base}/courses/${e.offering_id}/calendar` : `${base}/calendar?scope=cohort:${e.cohort_id}`,
      status: e.cancelled_at ? "CANCELLED" : "CONFIRMED",
      sequence: e.sequence,
      lastModified: e.updated_at,
    };
  } else if (kind === "assignment") {
    const { data: a } = await db
      .from("assignments")
      .select("id, offering_id, title, status, due_at, closes_at, late_policy, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (!a || !a.due_at || a.status === "archived") return notFound();
    const parts = [await courseLine(a.offering_id as string)];
    if (a.late_policy === "reject") parts.push(t("cal.lateRejected"));
    else if (a.closes_at && a.closes_at !== a.due_at) parts.push(`${t("cal.lateUntil")}: ${formatDateTime(a.closes_at as string, tz)}`);
    event = {
      uid: `assignment-${a.id}@crew-scaler-lms`,
      start: a.due_at as string,
      summary: `${t("cal.kind.assignmentDue")}: ${a.title}`,
      description: parts.filter(Boolean).join("\n\n"),
      url: isStaff(a.offering_id as string) ? `${base}/courses/${a.offering_id}/assignments/${a.id}/grade` : `${base}/courses/${a.offering_id}/assignments/${a.id}`,
      sequence: sequenceFrom(a.updated_at as string),
      lastModified: a.updated_at as string,
    };
  } else {
    const { data: q } = await db
      .from("quizzes")
      .select("id, offering_id, title, status, available_from, closes_at, time_limit_minutes, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (!q || q.status === "archived") return notFound();
    let start: string | null;
    let extended = false;
    if (kind === "quiz-opens") start = q.available_from as string | null;
    else {
      const { data: acc } = await db.from("quiz_accommodations").select("extended_closes_at").eq("quiz_id", q.id).eq("user_id", user.id).maybeSingle();
      const ext = (acc?.extended_closes_at as string | null | undefined) ?? null;
      start = ext ?? (q.closes_at as string | null);
      extended = Boolean(ext && ext !== q.closes_at);
    }
    if (!start) return notFound();
    const parts = [await courseLine(q.offering_id as string)];
    if (extended) parts.push(t("cal.extended"));
    if (q.time_limit_minutes) parts.push(`${t("cal.timeLimit")}: ${t("cal.minutes", { count: q.time_limit_minutes as number })}`);
    event = {
      uid: `${kind}-${q.id}@crew-scaler-lms`,
      start,
      summary: `${kind === "quiz-opens" ? t("cal.kind.quizOpens") : t("cal.kind.quizCloses")}: ${q.title}`,
      description: parts.filter(Boolean).join("\n\n"),
      url: `${base}/courses/${q.offering_id}/quizzes/${q.id}`,
      sequence: sequenceFrom(q.updated_at as string),
      lastModified: q.updated_at as string,
    };
  }

  return new NextResponse(buildIcs(event), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${icsFileName(event.summary)}"`,
      "X-Content-Type-Options": "nosniff",
      ...noStore,
    },
  });
}
