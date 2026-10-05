import type { Metadata } from "next";
import Link from "next/link";
import { requireOffering } from "@/lib/data/offering-access";
import { createClient } from "@/lib/supabase/server";
import { ASSIGNMENT_COLUMNS, type AssignmentRow } from "@/lib/assessment/assignment-data";
import { learnerAssignmentState, type SubmissionStatus } from "@/lib/assessment/assignment-status";
import { formatPoints } from "@/lib/domain/grades";
import { formatDateTime } from "@/lib/time";
import { AssignmentStateBadge, PublicationBadge, RoleNotice } from "@/components/assessment/badges";
import { DetailList, SectionHeading } from "@/components/assessment/detail-list";
import { PageBody } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("assign.title") };

function byDue(a: AssignmentRow, b: AssignmentRow) {
  const ad = a.due_at ? new Date(a.due_at).getTime() : Infinity;
  const bd = b.due_at ? new Date(b.due_at).getTime() : Infinity;
  return ad - bd || a.title.localeCompare(b.title);
}

export default async function AssignmentsPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const access = await requireOffering(offeringId);
  return access.isStaffView ? <StaffList offeringId={offeringId} /> : <LearnerList offeringId={offeringId} />;
}

function dueText(a: AssignmentRow, tz: string) {
  return a.due_at ? t("assign.due", { date: formatDateTime(a.due_at, tz) }) : t("assign.noDue");
}

async function LearnerList({ offeringId }: { offeringId: string }) {
  const { user } = await requireOffering(offeringId);
  const tz = user.timezone;
  const supabase = await createClient();
  const [asgRes, subRes, itemRes, relRes] = await Promise.all([
    supabase.from("assignments").select(ASSIGNMENT_COLUMNS).eq("offering_id", offeringId),
    supabase.from("submissions").select("id, assignment_id, status, submitted_count").eq("offering_id", offeringId).eq("user_id", user.id),
    supabase.from("grade_items").select("id, assignment_id").eq("offering_id", offeringId).eq("kind", "assignment"),
    supabase.from("released_grades").select("grade_item_id, status, points, max_points").eq("offering_id", offeringId).eq("user_id", user.id),
  ]);
  const assignments = ((asgRes.data ?? []) as AssignmentRow[]).sort(byDue);
  const subs = (subRes.data ?? []) as { id: string; assignment_id: string; status: SubmissionStatus; submitted_count: number }[];
  const subIds = subs.map((s) => s.id);
  const { data: lateRows } = subIds.length
    ? await supabase.from("submission_versions").select("submission_id, version_no, is_late").in("submission_id", subIds)
    : { data: [] };
  const latestLate = new Map<string, { v: number; late: boolean }>();
  for (const r of (lateRows ?? []) as { submission_id: string; version_no: number; is_late: boolean }[]) {
    const cur = latestLate.get(r.submission_id);
    if (!cur || r.version_no > cur.v) latestLate.set(r.submission_id, { v: r.version_no, late: r.is_late });
  }
  const itemByAssignment = new Map(((itemRes.data ?? []) as { id: string; assignment_id: string }[]).map((g) => [g.assignment_id, g.id]));
  const released = new Map(((relRes.data ?? []) as { grade_item_id: string; status: string; points: number | null; max_points: number }[]).map((r) => [r.grade_item_id, r]));

  return (
    <PageBody>
      <SectionHeading>{t("assign.title")}</SectionHeading>
      <p className="mb-4 text-sm text-muted">{t("quiz.timesIn", { tz })}</p>
      {assignments.length === 0 ? (
        <EmptyState title={t("assign.list.empty")} />
      ) : (
        <ul className="space-y-4">
          {assignments.map((a) => {
            const sub = subs.find((s) => s.assignment_id === a.id) ?? null;
            const item = itemByAssignment.get(a.id);
            const rel = item ? released.get(item) : undefined;
            const state = learnerAssignmentState({
              submission: sub,
              latestVersionLate: sub ? (latestLate.get(sub.id)?.late ?? null) : null,
              hasReleasedGrade: Boolean(rel),
            });
            const href = `/courses/${offeringId}/assignments/${a.id}`;
            const grade =
              rel?.status === "graded"
                ? t("assign.gradeLine", { points: formatPoints(rel.points), max: formatPoints(rel.max_points) })
                : rel?.status === "missing"
                  ? t("quiz.list.missing")
                  : rel?.status === "exempt"
                    ? t("quiz.list.exempt")
                    : t("quiz.list.noResult");
            return (
              <li key={a.id}>
                <Panel className="px-4 py-4 sm:px-6">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <h3 className="min-w-0 break-words text-lg font-semibold">
                      <Link href={href} className="text-primary underline-offset-2 hover:underline">{a.title}</Link>
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {a.status === "archived" ? <Badge>{t("assign.state.archived")}</Badge> : null}
                      <AssignmentStateBadge state={state} />
                    </div>
                  </div>
                  <DetailList
                    className="lg:grid-cols-4"
                    items={[
                      { label: t("assign.detail.due"), value: dueText(a, tz) },
                      { label: t("assign.detail.points"), value: formatPoints(a.points) },
                      { label: t("assign.detail.submissions"), value: t("assign.submissionsUsed", { used: sub?.submitted_count ?? 0, max: a.max_submissions }) },
                      { label: t("assign.detail.yourGrade"), value: grade },
                    ]}
                  />
                  <div className="mt-4">
                    <ButtonLink href={href} size="sm" variant={state === "returned" || state === "not_started" || state === "draft" ? "primary" : "secondary"}>
                      {t("assign.list.open")}
                      <span className="sr-only"> ({a.title})</span>
                    </ButtonLink>
                  </div>
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
    </PageBody>
  );
}

async function StaffList({ offeringId }: { offeringId: string }) {
  const access = await requireOffering(offeringId);
  const tz = access.user.timezone;
  const supabase = await createClient();
  const [asgRes, subRes] = await Promise.all([
    supabase.from("assignments").select(ASSIGNMENT_COLUMNS).eq("offering_id", offeringId),
    access.canGrade ? supabase.from("submissions").select("assignment_id, status").eq("offering_id", offeringId).eq("status", "submitted") : Promise.resolve({ data: [] }),
  ]);
  const assignments = ((asgRes.data ?? []) as AssignmentRow[]).sort(byDue);
  const toGrade = (subRes.data ?? []) as { assignment_id: string }[];

  return (
    <PageBody>
      <SectionHeading
        actions={
          <>
            <RoleNotice>{t("assign.staffBadge")}</RoleNotice>
            {access.canAuthor ? <ButtonLink href={`/courses/${offeringId}/assignments/new`} size="sm">{t("assign.list.new")}</ButtonLink> : null}
          </>
        }
      >
        {t("assign.title")}
      </SectionHeading>
      <p className="mb-4 text-sm text-muted">{t("quiz.timesIn", { tz })}</p>
      {assignments.length === 0 ? (
        <EmptyState title={t("assign.list.emptyStaff")} />
      ) : (
        <ul className="space-y-4">
          {assignments.map((a) => {
            const count = toGrade.filter((s) => s.assignment_id === a.id).length;
            const base = `/courses/${offeringId}/assignments/${a.id}`;
            return (
              <li key={a.id}>
                <Panel className="px-4 py-4 sm:px-6">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <h3 className="min-w-0 break-words text-lg font-semibold">
                      <Link href={base} className="text-primary underline-offset-2 hover:underline">{a.title}</Link>
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      <PublicationBadge status={a.status} />
                      {access.canGrade && count > 0 ? <Badge tone="warning">{t("assign.list.toGrade", { count })}</Badge> : null}
                    </div>
                  </div>
                  <DetailList
                    className="lg:grid-cols-4"
                    items={[
                      { label: t("assign.detail.due"), value: dueText(a, tz) },
                      { label: t("assign.detail.closes"), value: a.closes_at ? formatDateTime(a.closes_at, tz) : t("quiz.overview.noClose") },
                      { label: t("assign.detail.points"), value: formatPoints(a.points) },
                      { label: t("assign.detail.submissions"), value: t("assign.list.maxSubmissions", { max: a.max_submissions }) },
                    ]}
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    {access.canAuthor ? (
                      <ButtonLink href={`${base}/edit`} size="sm" variant="secondary">
                        {t("assign.list.edit")}<span className="sr-only"> ({a.title})</span>
                      </ButtonLink>
                    ) : null}
                    {access.canGrade ? (
                      <ButtonLink href={`${base}/grade`} size="sm" variant={count > 0 ? "primary" : "secondary"}>
                        {t("assign.list.grade")}<span className="sr-only"> ({a.title})</span>
                      </ButtonLink>
                    ) : null}
                  </div>
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
    </PageBody>
  );
}
