import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOffering, type OfferingAccess } from "@/lib/data/offering-access";
import { createClient } from "@/lib/supabase/server";
import {
  assetInfo,
  getAssignment,
  SUBMISSION_COLUMNS,
  VERSION_COLUMNS,
  type AssetInfo,
  type AssignmentRow,
  type ReleasedGradeRow,
  type SubmissionRow,
  type VersionRow,
} from "@/lib/assessment/assignment-data";
import { learnerAssignmentState, submissionWindow, submitBlock, type SubmitBlock } from "@/lib/assessment/assignment-status";
import { levelForScore, parseRubric, parseRubricScores, type RubricCriterion } from "@/lib/assessment/rubric";
import { formatPoints } from "@/lib/domain/grades";
import { formatDateTime } from "@/lib/time";
import { AssignmentStateBadge, PublicationBadge } from "@/components/assessment/badges";
import { DetailList, SectionHeading } from "@/components/assessment/detail-list";
import { SubmissionEditor } from "@/components/assessment/submission-editor";
import { VersionContents } from "@/components/assessment/version-contents";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { RichText } from "@/components/ui/rich-text";
import { Table, td, th } from "@/components/ui/table";
import { t, type MessageKey } from "@/i18n";

type Params = { offeringId: string; assignmentId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { offeringId, assignmentId } = await params;
  const a = await getAssignment(offeringId, assignmentId);
  return { title: a?.title ?? t("assign.title") };
}

const TYPE_LABEL: Record<string, MessageKey> = { text: "assign.type.text", file: "assign.type.file", url: "assign.type.url" };

export default async function AssignmentPage({ params }: { params: Promise<Params> }) {
  const { offeringId, assignmentId } = await params;
  const access = await requireOffering(offeringId);
  const assignment = await getAssignment(offeringId, assignmentId);
  if (!assignment) notFound();
  const tz = access.user.timezone;
  const rubric = parseRubric(assignment.rubric);
  const base = `/courses/${offeringId}/assignments/${assignment.id}`;

  const header = (
    <div>
      <Link href={`/courses/${offeringId}/assignments`} className="text-sm text-primary underline-offset-2 hover:underline">
        ← {t("assign.backToAssignments")}
      </Link>
      <div className="mt-2">
        <SectionHeading actions={access.isStaffView ? <PublicationBadge status={assignment.status} /> : null}>{assignment.title}</SectionHeading>
      </div>
      <p className="-mt-2 text-sm text-muted">{t("quiz.timesIn", { tz })}</p>
    </div>
  );

  if (access.isStaffView) {
    return (
      <PageBody className="space-y-6">
        {header}
        <Alert tone="info" title={t("assign.staffBadge")}>
          <p>{t("assign.detail.staffNote")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {access.canAuthor ? <ButtonLink href={`${base}/edit`} size="sm" variant="secondary">{t("assign.list.edit")}</ButtonLink> : null}
            {access.canGrade ? <ButtonLink href={`${base}/grade`} size="sm" variant="secondary">{t("assign.list.grade")}</ButtonLink> : null}
          </div>
        </Alert>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="min-w-0 space-y-6">
            <Instructions assignment={assignment} />
            <RubricTable rubric={rubric} />
          </div>
          <div className="min-w-0">
            <DetailsPanel assignment={assignment} tz={tz} submittedCount={null} />
          </div>
        </div>
      </PageBody>
    );
  }

  return <LearnerView access={access} assignment={assignment} rubric={rubric} header={header} />;
}

async function LearnerView({ access, assignment, rubric, header }: { access: OfferingAccess; assignment: AssignmentRow; rubric: RubricCriterion[]; header: React.ReactNode }) {
  const tz = access.user.timezone;
  const supabase = await createClient();
  const [subRes, itemRes] = await Promise.all([
    supabase.from("submissions").select(SUBMISSION_COLUMNS).eq("assignment_id", assignment.id).eq("user_id", access.user.id).maybeSingle(),
    supabase.from("grade_items").select("id").eq("assignment_id", assignment.id).maybeSingle(),
  ]);
  const submission = subRes.data as SubmissionRow | null;
  const itemId = (itemRes.data as { id: string } | null)?.id ?? null;
  const [versionRes, relRes] = await Promise.all([
    submission ? supabase.from("submission_versions").select(VERSION_COLUMNS).eq("submission_id", submission.id).order("version_no", { ascending: false }) : Promise.resolve({ data: [] }),
    itemId ? supabase.from("released_grades").select("grade_item_id, status, points, max_points, feedback, rubric_scores, released_at").eq("grade_item_id", itemId).eq("user_id", access.user.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const versions = (versionRes.data ?? []) as VersionRow[];
  const released = relRes.data as ReleasedGradeRow | null;
  const assets = await assetInfo([...(submission?.draft_asset_ids ?? []), ...versions.flatMap((v) => v.asset_ids)]);

  const now = new Date();
  const window = submissionWindow(now, assignment);
  const state = learnerAssignmentState({ submission, latestVersionLate: versions[0]?.is_late ?? null, hasReleasedGrade: Boolean(released) });
  const canEdit = access.isActiveLearner && !access.readOnly && assignment.status === "published";
  const block = submitBlock({
    isActiveLearner: access.isActiveLearner && assignment.status === "published",
    readOnly: access.readOnly,
    window,
    submittedCount: submission?.submitted_count ?? 0,
    maxSubmissions: assignment.max_submissions,
    status: submission?.status ?? null,
  });

  return (
    <PageBody className="space-y-6">
      {header}
      <div className="flex flex-wrap items-center gap-2">
        <AssignmentStateBadge state={state} />
        {versions[0]?.is_late ? <Badge tone="warning">{t("assign.detail.lateBadge")}</Badge> : null}
      </div>

      {submission?.status === "returned" ? (
        <Alert tone="warning" title={t("assign.detail.returned")}>
          <p>{t("assign.detail.returnedBody")}</p>
          {submission.return_note ? (
            <p className="mt-2">
              <span className="font-semibold">{t("assign.detail.returnNote")}: </span>
              <span className="whitespace-pre-wrap">{submission.return_note}</span>
            </p>
          ) : null}
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0 space-y-6">
          <Instructions assignment={assignment} />
          <RubricTable rubric={rubric} />
          <Panel>
            <PanelHeader title={t("assign.detail.yourWork")} level={3} />
            <div className="px-4 py-4 sm:px-6">
              <SubmissionEditor
                assignmentId={assignment.id}
                offeringId={assignment.offering_id}
                types={assignment.submission_types}
                initialText={submission?.draft_text ?? ""}
                initialUrl={submission?.draft_url ?? ""}
                initialAssets={(submission?.draft_asset_ids ?? []).map((id) => toEditorAsset(id, assets.get(id)))}
                initialSavedAt={submission?.draft_saved_at ?? null}
                canEdit={canEdit}
                canSubmit={canEdit && block === null}
                submitBlockedReason={block ? blockText(block, assignment, tz) : null}
                nextVersion={(submission?.submitted_count ?? 0) + 1}
                maxSubmissions={assignment.max_submissions}
                lateWarning={window === "late_allowed"}
                tz={tz}
              />
            </div>
          </Panel>
          <section aria-labelledby="history-heading" className="space-y-3">
            <h3 id="history-heading" className="text-lg font-semibold">{t("assign.detail.history")}</h3>
            {versions.length === 0 ? (
              <p className="text-muted">{t("assign.detail.noHistory")}</p>
            ) : (
              <Table caption={t("assign.detail.history")} captionHidden>
                <thead>
                  <tr>
                    <th scope="col" className={th}>{t("assign.detail.col.version")}</th>
                    <th scope="col" className={th}>{t("assign.detail.col.submitted")}</th>
                    <th scope="col" className={th}>{t("assign.detail.col.receipt")}</th>
                    <th scope="col" className={th}>{t("assign.detail.col.contents")}</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id}>
                      <th scope="row" className={`${td} font-medium`}>{v.version_no}</th>
                      <td className={`${td} whitespace-nowrap`}>
                        {formatDateTime(v.submitted_at, tz)}
                        <span className="mt-1 block">
                          {v.is_late ? <Badge tone="warning">{t("assign.detail.lateBadge")}</Badge> : <Badge tone="success">{t("assign.detail.onTime")}</Badge>}
                        </span>
                      </td>
                      <td className={`${td} font-mono text-xs`}>{v.receipt_code}</td>
                      <td className={`${td} min-w-56`}>
                        <VersionContents version={v} assets={assets} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>
        </div>
        <div className="min-w-0 space-y-6">
          <DetailsPanel assignment={assignment} tz={tz} submittedCount={submission?.submitted_count ?? 0} />
          <GradePanel released={released} submission={submission} rubric={rubric} tz={tz} />
        </div>
      </div>
    </PageBody>
  );
}

function toEditorAsset(id: string, info: AssetInfo | undefined) {
  return { id, filename: info?.filename ?? t("assign.detail.unknownFile"), size: Number(info?.size_bytes ?? 0), status: info?.status ?? "deleted" };
}

function blockText(block: NonNullable<SubmitBlock>, a: AssignmentRow, tz: string): string {
  switch (block) {
    case "read_only":
      return t("assign.detail.cannot.readOnly");
    case "not_learner":
      return t("assign.detail.cannot.notLearner");
    case "not_open":
      return t("assign.detail.cannot.notOpen", { date: formatDateTime(a.available_from, tz) });
    case "closed":
      return t("assign.detail.cannot.closed", { date: formatDateTime(a.closes_at, tz) });
    case "late_rejected":
      return t("assign.detail.cannot.lateRejected", { date: formatDateTime(a.due_at, tz) });
    case "limit_reached":
      return t("assign.detail.cannot.limitReached", { max: a.max_submissions });
    case "graded":
      return t("assign.detail.cannot.graded");
  }
}

function Instructions({ assignment }: { assignment: AssignmentRow }) {
  return (
    <Panel>
      <PanelHeader title={t("assign.detail.instructions")} level={3} />
      <div className="px-4 py-4 sm:px-6">
        {assignment.instructions_html ? <RichText html={assignment.instructions_html} /> : <p className="text-muted">{t("assign.detail.noInstructions")}</p>}
      </div>
    </Panel>
  );
}

function RubricTable({ rubric }: { rubric: RubricCriterion[] }) {
  if (rubric.length === 0) return null;
  return (
    <section aria-labelledby="rubric-heading" className="space-y-3">
      <h3 id="rubric-heading" className="text-lg font-semibold">{t("assign.detail.rubric")}</h3>
      <Table caption={t("assign.detail.rubric")} captionHidden>
        <thead>
          <tr>
            <th scope="col" className={th}>{t("assign.detail.rubricCriterion")}</th>
            <th scope="col" className={th}>{t("assign.detail.rubricPoints")}</th>
            <th scope="col" className={th}>{t("assign.detail.rubricLevels")}</th>
          </tr>
        </thead>
        <tbody>
          {rubric.map((c) => (
            <tr key={c.id}>
              <th scope="row" className={`${td} font-medium`}>
                {c.criterion}
                {c.description ? <span className="mt-1 block whitespace-pre-wrap text-xs font-normal text-muted">{c.description}</span> : null}
              </th>
              <td className={td}>{formatPoints(c.points)}</td>
              <td className={td}>
                {c.levels.length === 0 ? (
                  <span className="text-muted">–</span>
                ) : (
                  <ul className="space-y-1">
                    {c.levels.map((l) => (
                      <li key={l.id}>
                        <span className="font-medium">{l.label}</span>: {formatPoints(l.points)}
                        {l.description ? <span className="block text-xs text-muted">{l.description}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

function DetailsPanel({ assignment: a, tz, submittedCount }: { assignment: AssignmentRow; tz: string; submittedCount: number | null }) {
  const items = [
    { label: t("assign.detail.points"), value: formatPoints(a.points) },
    { label: t("assign.detail.available"), value: a.available_from ? formatDateTime(a.available_from, tz) : t("quiz.overview.opensNow") },
    { label: t("assign.detail.due"), value: a.due_at ? formatDateTime(a.due_at, tz) : t("assign.noDue") },
    { label: t("assign.detail.closes"), value: a.closes_at ? formatDateTime(a.closes_at, tz) : t("quiz.overview.noClose") },
    { label: t("assign.detail.latePolicy"), value: a.late_policy === "reject" ? t("assign.late.reject") : t("assign.late.acceptFlag") },
    {
      label: t("assign.detail.submissions"),
      value: submittedCount === null ? t("assign.list.maxSubmissions", { max: a.max_submissions }) : t("assign.submissionsUsed", { used: submittedCount, max: a.max_submissions }),
    },
    { label: t("assign.detail.accepted"), value: a.submission_types.map((ty) => t(TYPE_LABEL[ty] ?? "assign.type.text")).join(", ") },
  ];
  return (
    <Panel>
      <PanelHeader title={t("assign.detail.details")} level={3} />
      <div className="px-4 py-4 sm:px-6">
        <DetailList className="sm:grid-cols-2 xl:grid-cols-1" items={items} />
      </div>
    </Panel>
  );
}

function GradePanel({ released, submission, rubric, tz }: { released: ReleasedGradeRow | null; submission: SubmissionRow | null; rubric: RubricCriterion[]; tz: string }) {
  let body: React.ReactNode;
  if (released) {
    const scores = parseRubricScores(released.rubric_scores);
    body = (
      <div className="space-y-3">
        {released.status === "graded" ? (
          <p className="text-xl font-semibold">{t("assign.gradeLine", { points: formatPoints(released.points), max: formatPoints(released.max_points) })}</p>
        ) : released.status === "missing" ? (
          <p>{t("assign.detail.missing")}</p>
        ) : (
          <p>{t("assign.detail.exempt")}</p>
        )}
        <p className="text-xs text-muted">{t("assign.detail.releasedAt", { date: formatDateTime(released.released_at, tz) })}</p>
        <div>
          <p className="text-sm font-semibold">{t("assign.detail.feedback")}</p>
          {released.feedback ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{released.feedback}</p> : <p className="text-sm text-muted">{t("assign.detail.noFeedback")}</p>}
        </div>
        {rubric.length > 0 && Object.keys(scores).length > 0 ? (
          <div>
            <p className="text-sm font-semibold">{t("assign.detail.rubricScores")}</p>
            <ul className="mt-1 space-y-1 text-sm">
              {rubric.map((c) => {
                const level = levelForScore(c, scores[c.id]);
                return (
                  <li key={c.id} className="flex flex-wrap justify-between gap-2">
                    <span>{c.criterion}</span>
                    <span className="font-medium">
                      {scores[c.id] !== undefined ? `${formatPoints(scores[c.id])} / ${formatPoints(c.points)}` : "–"}
                      {level ? <span className="ml-1 font-normal text-muted">({level.label})</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    );
  } else if (submission?.status === "graded") {
    body = <p className="text-sm">{t("assign.detail.gradedUnreleased")}</p>;
  } else {
    body = <p className="text-sm text-muted">{t("assign.detail.noGradeYet")}</p>;
  }
  return (
    <Panel>
      <PanelHeader title={t("assign.detail.yourGrade")} level={3} />
      <div className="px-4 py-4 sm:px-6">{body}</div>
    </Panel>
  );
}
