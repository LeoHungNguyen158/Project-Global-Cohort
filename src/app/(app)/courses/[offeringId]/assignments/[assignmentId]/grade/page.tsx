import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOffering } from "@/lib/data/offering-access";
import { getAssignment, loadGradingQueue, type QueueEntry } from "@/lib/assessment/assignment-data";
import { QUEUE_FILTERS, inQueue, queueCounts, type QueueFilter } from "@/lib/assessment/assignment-status";
import { formatPoints } from "@/lib/domain/grades";
import { formatDateTime } from "@/lib/time";
import { PublicationBadge, RoleNotice } from "@/components/assessment/badges";
import { SectionHeading } from "@/components/assessment/detail-list";
import { PageBody } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, td, th } from "@/components/ui/table";
import { cn } from "@/components/ui/cn";
import { t, type MessageKey } from "@/i18n";

type Params = { offeringId: string; assignmentId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { offeringId, assignmentId } = await params;
  const a = await getAssignment(offeringId, assignmentId);
  return { title: a ? t("assign.grade.title", { title: a.title }) : t("assign.title") };
}

const FILTER_LABEL: Record<QueueFilter, MessageKey> = {
  all: "assign.grade.filter.all",
  to_grade: "assign.grade.filter.toGrade",
  late: "assign.grade.filter.late",
  returned: "assign.grade.filter.returned",
  graded: "assign.grade.filter.graded",
  not_submitted: "assign.grade.filter.notSubmitted",
};

const ENROLLMENT_NOTE: Record<string, MessageKey> = {
  suspended: "assign.grade.enrollment.suspended",
  withdrawn: "assign.grade.enrollment.withdrawn",
  completed: "assign.grade.enrollment.completed",
};

function queueRow(e: QueueEntry) {
  return { status: e.submission?.status ?? null, latestLate: Boolean(e.latest?.is_late) };
}

export default async function AssignmentGradingPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ filter?: string }> }) {
  const { offeringId, assignmentId } = await params;
  const { filter: rawFilter } = await searchParams;
  const access = await requireOffering(offeringId);
  if (!access.canGrade) notFound();
  const assignment = await getAssignment(offeringId, assignmentId);
  if (!assignment) notFound();
  const tz = access.user.timezone;
  const filter: QueueFilter = QUEUE_FILTERS.includes(rawFilter as QueueFilter) ? (rawFilter as QueueFilter) : "all";

  const entries = await loadGradingQueue(offeringId, assignment.id);
  const counts = queueCounts(entries.map(queueRow));
  const visible = entries.filter((e) => inQueue(filter, queueRow(e)));
  const base = `/courses/${offeringId}/assignments/${assignment.id}`;

  return (
    <PageBody className="space-y-4">
      <div>
        <Link href={`/courses/${offeringId}/assignments`} className="text-sm text-primary underline-offset-2 hover:underline">
          ← {t("assign.backToAssignments")}
        </Link>
        <div className="mt-2">
          <SectionHeading
            actions={
              <>
                <RoleNotice>{t("assign.gradingBadge")}</RoleNotice>
                <PublicationBadge status={assignment.status} />
              </>
            }
          >
            {t("assign.grade.title", { title: assignment.title })}
          </SectionHeading>
        </div>
        <p className="-mt-2 text-sm text-muted">
          {t("assign.grade.intro")} {t("assign.grade.draftsHidden")} {t("quiz.timesIn", { tz })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ButtonLink href={base} size="sm" variant="secondary">{t("assign.author.viewPage")}</ButtonLink>
          {access.canAuthor ? <ButtonLink href={`${base}/edit`} size="sm" variant="secondary">{t("assign.list.edit")}</ButtonLink> : null}
        </div>
      </div>

      <nav aria-label={t("assign.grade.filters")}>
        <ul className="flex flex-wrap gap-2">
          {QUEUE_FILTERS.map((f) => {
            const active = f === filter;
            return (
              <li key={f}>
                <Link
                  href={f === "all" ? base + "/grade" : `${base}/grade?filter=${f}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-10 items-center rounded-full border px-3 text-sm",
                    active ? "border-primary bg-primary text-white" : "border-line bg-panel text-ink hover:bg-canvas",
                  )}
                >
                  {t("assign.grade.filterCount", { label: t(FILTER_LABEL[f]), count: counts[f] })}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {visible.length === 0 ? (
        <EmptyState title={filter === "to_grade" ? t("assign.grade.noneToGrade") : t("assign.grade.empty")} />
      ) : (
        <Table caption={`${t("assign.grade.learners")}: ${t(FILTER_LABEL[filter])} (${visible.length})`}>
          <thead>
            <tr>
              <th scope="col" className={th}>{t("assign.grade.col.learner")}</th>
              <th scope="col" className={th}>{t("assign.grade.col.status")}</th>
              <th scope="col" className={th}>{t("assign.grade.col.version")}</th>
              <th scope="col" className={th}>{t("assign.grade.col.grade")}</th>
              <th scope="col" className={th}>{t("assign.grade.col.action")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => {
              const name = e.name ?? t("quiz.grade.unknownLearner");
              const status = e.submission?.status ?? null;
              const note = e.enrollmentStatus === null ? "assign.grade.enrollment.none" : ENROLLMENT_NOTE[e.enrollmentStatus];
              return (
                <tr key={e.userId}>
                  <th scope="row" className={`${td} min-w-40 font-medium`}>
                    {name}
                    {note ? <span className="mt-0.5 block text-xs font-normal text-muted">{t(note as MessageKey)}</span> : null}
                  </th>
                  <td className={td}>
                    <span className="flex flex-wrap gap-1">
                      {status === "submitted" ? (
                        <Badge tone="warning">{t("assign.grade.status.submitted")}</Badge>
                      ) : status === "returned" ? (
                        <Badge tone="info">{t("assign.grade.status.returned")}</Badge>
                      ) : status === "graded" ? (
                        <Badge tone="success">{t("assign.grade.status.graded")}</Badge>
                      ) : (
                        <Badge>{t("assign.grade.status.notSubmitted")}</Badge>
                      )}
                      {e.latest?.is_late ? <Badge tone="warning">{t("assign.detail.lateBadge")}</Badge> : null}
                    </span>
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    {e.latest ? (
                      <>
                        {t("assign.grade.versionShort", { version: e.latest.version_no })}
                        <span className="block text-xs text-muted">{formatDateTime(e.latest.submitted_at, tz)}</span>
                      </>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    <GradeCell entry={e} max={assignment.points} />
                  </td>
                  <td className={td}>
                    {e.submission ? (
                      <ButtonLink href={`${base}/grade/${e.submission.id}`} size="sm" variant={status === "submitted" ? "primary" : "secondary"}>
                        {status === "submitted" ? t("assign.grade.open") : t("assign.grade.view")}
                        <span className="sr-only"> ({name})</span>
                      </ButtonLink>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </PageBody>
  );
}

function GradeCell({ entry, max }: { entry: QueueEntry; max: number }) {
  const g = entry.grade;
  if (!g) return <span className="text-muted">{t("assign.grade.notGraded")}</span>;
  const value =
    g.status === "graded" ? t("assign.gradeLine", { points: formatPoints(g.points), max: formatPoints(max) }) : g.status === "exempt" ? t("assign.grade.excused") : g.status === "missing" ? t("assign.grade.missingGrade") : t("assign.grade.notGraded");
  const release = !entry.released ? (
    <Badge>{t("assign.grade.notReleased")}</Badge>
  ) : g.dirty ? (
    <Badge tone="warning">{t("assign.grade.changedSinceRelease")}</Badge>
  ) : (
    <Badge tone="success">{t("assign.grade.released")}</Badge>
  );
  return (
    <span className="flex flex-col items-start gap-1">
      <span>{value}</span>
      {release}
    </span>
  );
}
