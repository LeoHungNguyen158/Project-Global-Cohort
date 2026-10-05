import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpen, ClipboardCheck, Flag, Globe2, GraduationCap, Info, KeyRound, Mail, Megaphone, Settings, UserPlus,
  type LucideIcon,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listMyOfferings, offeringPhase, offeringTitle, type OfferingSummary } from "@/lib/data/offerings";
import { formatDate, formatDateTime, formatTime } from "@/lib/time";
import { openNotification, markAllNotificationsRead } from "@/app/actions/activity";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AutoSubmit } from "@/components/ui/auto-submit";
import { buttonClass } from "@/components/ui/button";
import { t } from "@/i18n";

export const metadata: Metadata = { title: "Activity" };

const KINDS = [
  { value: "", label: "Show All" },
  { value: "announcement", label: "Announcements" },
  { value: "grade", label: "Grades" },
  { value: "message", label: "Messages" },
  { value: "content", label: "Course content" },
  { value: "submission", label: "Submissions" },
  { value: "access_request", label: "Access requests" },
  { value: "invitation", label: "Invitations" },
  { value: "system", label: "System" },
] as const;

const ICONS: Record<string, LucideIcon> = {
  announcement: Megaphone,
  grade: GraduationCap,
  message: Mail,
  content: BookOpen,
  submission: ClipboardCheck,
  access_request: KeyRound,
  invitation: UserPlus,
  system: Info,
};

type Notification = {
  id: string;
  kind: string;
  offering_id: string | null;
  cohort_id: string | null;
  title: string;
  body: string;
  target_url: string;
  occurred_at: string;
  read_at: string | null;
};

type Upcoming = { key: string; when: string; label: string; detail: string; href: string; kind: "assignment" | "quiz" | "event" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ kind?: string; limit?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("/activity");
  const supabase = await createClient();
  const tz = user.timezone;

  // Scheduled announcements become notifications when their time arrives (server time).
  await supabase.rpc("materialize_my_notifications");

  const kind = KINDS.some((k) => k.value === sp.kind) ? (sp.kind as string) : "";
  const limit = Math.min(Math.max(Number(sp.limit) || 20, 20), 100);

  let stream = supabase
    .from("notifications")
    .select("id, kind, offering_id, cohort_id, title, body, target_url, occurred_at, read_at")
    .order("occurred_at", { ascending: false })
    .limit(limit + 1);
  if (kind) stream = stream.eq("kind", kind);

  const [streamRes, unreadRes, offerings, cohortsRes] = await Promise.all([
    stream,
    supabase.from("notifications").select("offering_id").is("read_at", null).limit(2000),
    listMyOfferings(),
    supabase.from("cohorts").select("id, code, name"),
  ]);
  const items = ((streamRes.data ?? []) as Notification[]).slice(0, limit);
  const hasMore = (streamRes.data ?? []).length > limit;
  const unread = (unreadRes.data ?? []) as { offering_id: string | null }[];
  const unreadByOffering = new Map<string, number>();
  for (const n of unread) if (n.offering_id) unreadByOffering.set(n.offering_id, (unreadByOffering.get(n.offering_id) ?? 0) + 1);
  const offeringById = new Map(offerings.map((o) => [o.id, o]));
  const cohortById = new Map((cohortsRes.data ?? []).map((c) => [c.id as string, c as { id: string; code: string; name: string }]));

  const staffIds = new Set(user.staff.map((s) => s.offering_id));
  const enrolledIds = new Set(user.enrollments.map((e) => e.offering_id));
  const current = offerings.filter((o) => (staffIds.has(o.id) || enrolledIds.has(o.id)) && offeringPhase(o) === "ongoing");

  // Per-course extras: learner progress or the staff grading queue.
  const extras = new Map<string, { progress?: number | null; toGrade?: number }>();
  await Promise.all(
    current.slice(0, 6).map(async (o) => {
      if (staffIds.has(o.id)) {
        const { data } = await supabase.rpc("staff_offering_summary", { p_offering: o.id });
        extras.set(o.id, { toGrade: Number(data?.submissions_to_grade ?? 0) + Number(data?.attempts_to_grade ?? 0) });
      } else {
        const { data } = await supabase.rpc("course_progress", { p_offering: o.id });
        extras.set(o.id, { progress: data?.percent == null ? null : Number(data.percent) });
      }
    }),
  );

  const upcoming = await loadUpcoming(supabase, current, user.id, staffIds);

  return (
    <>
      <header className="flex items-start justify-between gap-4 border-b border-line bg-panel px-4 py-5 sm:px-8">
        <h1 className="text-[1.85rem] leading-tight [font-family:Georgia,'Times_New_Roman',serif]">{t("activity.hello", { name: user.displayName })}</h1>
        <Link href="/profile#notifications" className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-canvas" aria-label={t("activity.settings")}>
          <Settings aria-hidden="true" className="h-6 w-6" />
        </Link>
      </header>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="space-y-6 px-4 py-6 sm:px-8">
          <Panel aria-labelledby="courses-activity" className="p-4 sm:p-6">
            <h2 id="courses-activity" className="mb-4 text-lg font-semibold">{t("activity.coursesActivity")}</h2>
            {current.length === 0 ? (
              <EmptyState title="No current courses">Courses you teach or take appear here while they are running.</EmptyState>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {current.slice(0, 6).map((o) => (
                  <CourseActivityCard key={o.id} offering={o} unread={unreadByOffering.get(o.id) ?? 0} extra={extras.get(o.id)} />
                ))}
              </ul>
            )}
            <Link href="/courses" className={`${buttonClass("subtle")} mt-4`}>{t("activity.viewAllCourses")}</Link>
          </Panel>

          <Panel aria-labelledby="upcoming-heading" className="p-4 sm:p-6">
            <h2 id="upcoming-heading" className="mb-1 text-lg font-semibold">{t("activity.upcoming")}</h2>
            <p className="mb-4 text-sm text-muted">Next 14 days · {t("common.timezoneNote", { tz })}</p>
            {upcoming.length === 0 ? (
              <EmptyState title="Nothing due in the next two weeks." />
            ) : (
              <ul className="divide-y divide-line">
                {upcoming.map((u) => (
                  <li key={u.key} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <Link href={u.href} className="font-medium text-primary hover:underline">{u.label}</Link>
                      <p className="text-sm text-muted">{u.detail}</p>
                    </div>
                    <span className="text-sm">
                      <span className="sr-only">{u.kind === "event" ? "Starts" : u.kind === "quiz" ? "Closes" : "Due"} </span>
                      {formatDateTime(u.when, tz)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <aside aria-labelledby="stream-heading" className="border-t border-line bg-panel px-4 py-6 sm:px-8 lg:border-l lg:border-t-0">
          <h2 id="stream-heading" className="flex items-center gap-2 text-lg font-semibold">
            <Globe2 aria-hidden="true" className="h-6 w-6" /> {t("activity.stream")}
          </h2>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <form method="get" action="/activity" className="flex items-end gap-2">
              <div>
                <label htmlFor="stream-filter" className="block text-xs text-muted">{t("common.filter")}</label>
                <select id="stream-filter" name="kind" defaultValue={kind} className="block min-h-10 w-52 rounded-md border border-line bg-white px-3 py-2">
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>{k.label}</option>
                  ))}
                </select>
              </div>
              <button type="submit" data-apply className={buttonClass("secondary", "sm")}>Apply</button>
              <AutoSubmit />
            </form>
            {unread.length > 0 ? (
              <form action={markAllNotificationsRead}>
                <button type="submit" className={buttonClass("ghost", "sm")}>{t("activity.markAllRead")}</button>
              </form>
            ) : null}
          </div>

          <h3 className="mt-6 flex items-center gap-3 text-2xl font-light text-muted">
            <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full border-2 border-subtle" />
            {t("activity.recent")}
          </h3>
          {items.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t("activity.empty")}</p>
          ) : (
            <ol className="mt-2 border-l-2 border-line pl-0">
              {items.map((n) => (
                <StreamItem key={n.id} n={n} tz={tz} offering={n.offering_id ? offeringById.get(n.offering_id) : undefined} cohort={n.cohort_id ? cohortById.get(n.cohort_id) : undefined} />
              ))}
            </ol>
          )}
          {hasMore ? (
            <Link href={`/activity?${new URLSearchParams({ ...(kind ? { kind } : {}), limit: String(Math.min(limit + 20, 100)) })}`} className={`${buttonClass("secondary", "sm")} mt-4`}>
              Show more
            </Link>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function CourseActivityCard({ offering, unread, extra }: { offering: OfferingSummary; unread: number; extra?: { progress?: number | null; toGrade?: number } }) {
  const title = offeringTitle(offering);
  return (
    <li className="overflow-hidden rounded-md border border-line bg-panel">
      <div aria-hidden="true" className="h-20" style={{ background: `linear-gradient(135deg, ${offering.accent_color} 0%, ${offering.accent_color}bb 50%, #0f172a 100%)` }} />
      <div className="px-4 py-3">
        <p className="text-sm text-muted">{offering.code}</p>
        <p className="truncate font-semibold" title={title}>
          <Link href={`/courses/${offering.id}`} className="hover:underline">{title}</Link>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <span className="inline-flex items-center gap-1">
            <Flag aria-hidden="true" className="h-4 w-4" />
            <span><span className="font-semibold">{unread}</span> {unread === 1 ? t("activity.unreadOne") : t("activity.unreadMany")}</span>
          </span>
          {extra?.toGrade !== undefined ? <span>{extra.toGrade} to grade</span> : null}
          {extra?.progress !== undefined && extra.progress !== null ? <span>{extra.progress}% complete</span> : null}
        </div>
      </div>
    </li>
  );
}

function StreamItem({ n, tz, offering, cohort }: { n: Notification; tz: string; offering?: OfferingSummary; cohort?: { code: string; name: string } }) {
  const Icon = ICONS[n.kind] ?? Info;
  const scope = offering ? `${offering.code} (${offeringTitle(offering)})` : cohort ? cohort.name : null;
  return (
    <li className="relative -ml-px flex gap-3 py-4 pl-4">
      <Icon aria-hidden="true" className="mt-1 h-7 w-7 shrink-0 rounded bg-panel text-ink" />
      <div className="min-w-0 border-l-2 border-[#93c5fd] pl-3">
        <p className="text-sm">
          {formatDate(n.occurred_at, tz)} <span className="text-muted">{formatTime(n.occurred_at, tz)}</span>
          {!n.read_at ? <Badge tone="info" className="ml-2">New</Badge> : null}
        </p>
        {scope ? <p className="text-sm font-semibold">{scope}</p> : null}
        <p className="text-sm">{n.title}</p>
        {n.body ? <p className="text-sm text-muted">{n.body}</p> : null}
        <form action={openNotification} className="mt-2">
          <input type="hidden" name="id" value={n.id} />
          <button type="submit" className={buttonClass("subtle", "sm")}>
            {n.kind === "grade" ? t("activity.viewMyGrade") : t("activity.open")}
            <span className="sr-only">: {n.title}</span>
          </button>
        </form>
      </div>
    </li>
  );
}

async function loadUpcoming(
  supabase: Awaited<ReturnType<typeof createClient>>,
  current: OfferingSummary[],
  userId: string,
  staffIds: Set<string>,
): Promise<Upcoming[]> {
  if (current.length === 0) return [];
  const ids = current.map((o) => o.id);
  const now = new Date();
  const until = new Date(now.getTime() + 14 * 86_400_000).toISOString();
  const byId = new Map(current.map((o) => [o.id, o]));
  const [asg, quizzes, events] = await Promise.all([
    supabase.from("assignments").select("id, offering_id, title, due_at").in("offering_id", ids).eq("status", "published").gte("due_at", now.toISOString()).lte("due_at", until).order("due_at"),
    supabase.from("quizzes").select("id, offering_id, title, closes_at").in("offering_id", ids).eq("status", "published").gte("closes_at", now.toISOString()).lte("closes_at", until).order("closes_at"),
    supabase.from("calendar_events").select("id, offering_id, cohort_id, title, starts_at, kind").gte("starts_at", now.toISOString()).lte("starts_at", until).order("starts_at").limit(20),
  ]);
  const learnerAssignments = (asg.data ?? []).filter((a) => !staffIds.has(a.offering_id));
  const submitted = new Set<string>();
  if (learnerAssignments.length > 0) {
    const { data } = await supabase.from("submissions").select("assignment_id, status").eq("user_id", userId).in("assignment_id", learnerAssignments.map((a) => a.id));
    for (const s of data ?? []) if (s.status !== "draft" && s.status !== "returned") submitted.add(s.assignment_id);
  }
  const out: Upcoming[] = [];
  for (const a of asg.data ?? []) {
    if (submitted.has(a.id)) continue;
    const o = byId.get(a.offering_id);
    out.push({ key: `a-${a.id}`, when: a.due_at, kind: "assignment", label: a.title, detail: `Assignment due · ${o?.code ?? ""}`, href: `/courses/${a.offering_id}/assignments/${a.id}` });
  }
  for (const q of quizzes.data ?? []) {
    const o = byId.get(q.offering_id);
    out.push({ key: `q-${q.id}`, when: q.closes_at, kind: "quiz", label: q.title, detail: `Quiz closes · ${o?.code ?? ""}`, href: `/courses/${q.offering_id}/quizzes/${q.id}` });
  }
  for (const e of events.data ?? []) {
    const o = e.offering_id ? byId.get(e.offering_id) : undefined;
    const kindLabel = e.kind === "live_session" ? "Live session" : e.kind === "office_hours" ? "Office hours" : "Event";
    out.push({
      key: `e-${e.id}`,
      when: e.starts_at,
      kind: "event",
      label: e.title,
      detail: `${kindLabel}${o ? ` · ${o.code}` : ""}`,
      href: e.offering_id ? `/courses/${e.offering_id}/calendar` : "/calendar",
    });
  }
  return out.sort((a, b) => a.when.localeCompare(b.when)).slice(0, 15);
}

