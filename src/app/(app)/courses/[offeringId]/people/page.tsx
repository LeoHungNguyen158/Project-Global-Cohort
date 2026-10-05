import type { Metadata } from "next";
import Link from "next/link";
import { Search, ShieldCheck } from "lucide-react";
import { requireOffering } from "@/lib/data/offering-access";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { assetUrl } from "@/lib/learning/data";
import { compareNames, matchesQuery } from "@/lib/learning/search";
import { PageBody } from "@/components/ui/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { td, th } from "@/components/ui/table";
import { ScrollTable } from "@/components/learning/scroll-table";
import { buttonClass } from "@/components/ui/button";
import { AutoSubmit } from "@/components/ui/auto-submit";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("people.title") };

type Member = { user_id: string; display_name: string; scope_role: "instructor" | "ta" | "learner" };
type ReportRow = {
  user_id: string;
  display_name: string;
  enrollment_status: "active" | "completed" | "suspended" | "withdrawn";
  required_total: number;
  required_completed: number;
  completed_at: string | null;
};

const STATUSES = ["active", "completed", "suspended", "withdrawn"] as const;
const STATUS_LABEL = {
  active: "people.enrollment.active",
  completed: "people.enrollment.completed",
  suspended: "people.enrollment.suspended",
  withdrawn: "people.enrollment.withdrawn",
} as const;
const ROLE_LABEL = { instructor: "learn.role.instructor", ta: "learn.role.ta", learner: "learn.role.learner" } as const;

export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { offeringId } = await params;
  const sp = await searchParams;
  const access = await requireOffering(offeringId);
  const { user } = access;
  const staffView = access.isStaffView;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? (sp.status as (typeof STATUSES)[number]) : "";
  const supabase = await createClient();

  // Names and roles only (the RPC never returns emails); avatars come from the profiles
  // the viewer shares a course with.
  const [membersRes, reportRes] = await Promise.all([
    supabase.rpc("list_scope_members", { p_offering: offeringId, p_cohort: null }),
    staffView ? supabase.rpc("completion_report", { p_offering: offeringId }) : Promise.resolve({ data: null, error: null }),
  ]);
  const members = ((membersRes.data ?? []) as Member[]).slice().sort((a, b) => compareNames(a.display_name, b.display_name));
  const ids = members.map((m) => m.user_id);
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id, avatar_asset_id").in("id", ids) : { data: [] };
  const avatars = new Map(((profiles ?? []) as { id: string; avatar_asset_id: string | null }[]).map((p) => [p.id, p.avatar_asset_id]));

  const shown = members.filter((m) => matchesQuery(m.display_name, q));
  const staff = shown.filter((m) => m.scope_role !== "learner");
  const learners = shown.filter((m) => m.scope_role === "learner");
  const report = ((reportRes.data ?? []) as ReportRow[])
    .filter((r) => matchesQuery(r.display_name, q) && (!status || r.enrollment_status === status))
    .sort((a, b) => compareNames(a.display_name, b.display_name));

  const memberList = (list: Member[]) => (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {list.map((m) => (
        <li key={m.user_id} className="flex min-w-0 items-center gap-3 rounded-md border border-line bg-panel px-3 py-2">
          <Avatar name={m.display_name} src={avatars.get(m.user_id) ? assetUrl(avatars.get(m.user_id)!) : null} />
          <div className="min-w-0">
            <p className="break-words font-medium">
              {m.display_name} {m.user_id === user.id ? <span className="font-normal text-muted">{t("people.you")}</span> : null}
            </p>
            <p className="text-sm text-muted">{t(ROLE_LABEL[m.scope_role] ?? "learn.role.learner")}</p>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <PageBody>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">{t("people.title")}</h2>
          <p className="text-sm text-muted" aria-live="polite">
            {shown.length === 1 ? t("people.countOne") : t("people.count", { count: shown.length })}
          </p>
        </div>
        <p className="flex items-start gap-2 text-sm text-muted">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /> {t("people.privacy")}
        </p>

        <form method="get" role="search" className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-[1_1_16rem]">
            <label htmlFor="people-q" className="block text-sm font-medium">{t("people.searchLabel")}</label>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input id="people-q" name="q" type="search" defaultValue={q} className="block min-h-10 w-full rounded-md border border-line bg-white py-2 pl-9 pr-3" />
            </div>
          </div>
          {staffView ? (
            <div className="min-w-[10rem] flex-[0_1_12rem]">
              <label htmlFor="people-status" className="block text-sm font-medium">{t("people.statusFilter")}</label>
              <select id="people-status" name="status" defaultValue={status} className="block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2">
                <option value="">{t("people.allStatuses")}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{t(STATUS_LABEL[s])}</option>
                ))}
              </select>
            </div>
          ) : null}
          <button type="submit" data-apply className={buttonClass("secondary")}>{t("people.search")}</button>
          {q || status ? (
            <Link href={`/courses/${offeringId}/people`} className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline underline-offset-2">
              {t("people.clear")}
            </Link>
          ) : null}
          {staffView ? <AutoSubmit /> : null}
        </form>

        {membersRes.error ? <Alert tone="error">{t("people.loadError")}</Alert> : null}

        <section aria-labelledby="people-staff" className="space-y-3">
          <h3 id="people-staff" className="text-lg font-semibold">{t("people.staff")}</h3>
          {staff.length > 0 ? memberList(staff) : <p className="text-sm text-muted">{q ? t("people.noMatch") : t("people.noStaff")}</p>}
        </section>

        <section aria-labelledby="people-learners" className="space-y-3">
          <h3 id="people-learners" className="text-lg font-semibold">{t("people.learners")}</h3>
          {learners.length > 0 ? memberList(learners) : <EmptyState title={q ? t("people.noMatch") : t("people.noLearners")} />}
        </section>

        {staffView ? (
          <section aria-labelledby="people-progress" className="space-y-3">
            <h3 id="people-progress" className="text-lg font-semibold">{t("people.progressTitle")}</h3>
            {!access.canAuthor ? <p className="text-sm text-muted">{t("people.overrideNeedsAuthor")}</p> : null}
            {reportRes.error ? <Alert tone="error">{t("people.loadError")}</Alert> : null}
            {report.length === 0 ? (
              <EmptyState title={q || status ? t("people.noMatch") : t("people.noLearners")} />
            ) : (
              <ScrollTable caption={t("people.progressCaption")}>
                <thead>
                  <tr>
                    <th scope="col" className={th}>{t("people.col.learner")}</th>
                    <th scope="col" className={th}>{t("people.col.status")}</th>
                    <th scope="col" className={th}>{t("people.col.progress")}</th>
                    <th scope="col" className={th}>{t("people.col.completed")}</th>
                    <th scope="col" className={th}>{t("people.col.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.map((r) => {
                    const pct = r.required_total > 0 ? Math.round((r.required_completed / r.required_total) * 100) : null;
                    return (
                      <tr key={r.user_id}>
                        <th scope="row" className={`${td} font-medium`}>
                          <span className="flex items-center gap-2">
                            <Avatar name={r.display_name} src={avatars.get(r.user_id) ? assetUrl(avatars.get(r.user_id)!) : null} size={28} />
                            <span className="break-words">{r.display_name}</span>
                          </span>
                        </th>
                        <td className={td}>
                          <Badge tone={r.enrollment_status === "active" ? "info" : r.enrollment_status === "completed" ? "success" : "warning"}>
                            {t(STATUS_LABEL[r.enrollment_status] ?? "people.enrollment.active")}
                          </Badge>
                        </td>
                        <td className={`${td} min-w-[11rem]`}>
                          {pct === null ? (
                            <span className="text-muted">{t("people.noRequired")}</span>
                          ) : (
                            <>
                              <span className="text-sm">{t("people.progressValue", { done: r.required_completed, total: r.required_total, percent: pct })}</span>
                              <span aria-hidden="true" className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-[#e5e7eb]">
                                <span className={`block h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                              </span>
                            </>
                          )}
                        </td>
                        <td className={`${td} whitespace-nowrap text-sm`}>
                          {r.completed_at ? formatDate(r.completed_at, user.timezone) : <span className="text-muted">{t("people.notCompleted")}</span>}
                        </td>
                        <td className={td}>
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={`/courses/${offeringId}/people/${r.user_id}`}
                              className={buttonClass("secondary", "sm")}
                              aria-label={t("people.viewProgressNamed", { name: r.display_name })}
                            >
                              {t("people.viewProgress")}
                            </Link>
                            {access.canAuthor ? (
                              <Link
                                href={`/courses/${offeringId}/people/${r.user_id}#grant-override`}
                                className={buttonClass("ghost", "sm")}
                                aria-label={t("people.overrideNamed", { name: r.display_name })}
                              >
                                {t("people.override")}
                              </Link>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </ScrollTable>
            )}
          </section>
        ) : null}
      </div>
    </PageBody>
  );
}
