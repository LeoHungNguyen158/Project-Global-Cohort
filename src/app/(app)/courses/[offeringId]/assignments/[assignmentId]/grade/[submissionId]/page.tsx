import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOffering } from "@/lib/data/offering-access";
import { createClient } from "@/lib/supabase/server";
import { assetInfo, getAssignment, loadGradingQueue, VERSION_COLUMNS, type VersionRow } from "@/lib/assessment/assignment-data";
import { parseRubric, parseRubricScores } from "@/lib/assessment/rubric";
import { isUuid } from "@/lib/forms";
import { formatPoints } from "@/lib/domain/grades";
import { formatDateTime } from "@/lib/time";
import { publishSubmissionGrade, returnSubmission } from "@/app/actions/assignments";
import { RoleNotice } from "@/components/assessment/badges";
import { DetailList, SectionHeading } from "@/components/assessment/detail-list";
import { SubmissionGrader } from "@/components/assessment/submission-grader";
import { VersionContents } from "@/components/assessment/version-contents";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, Textarea } from "@/components/ui/field";
import { t } from "@/i18n";

type Params = { offeringId: string; assignmentId: string; submissionId: string };

type StaffSubmission = { id: string; assignment_id: string; user_id: string; status: "submitted" | "returned" | "graded"; submitted_count: number; return_note: string };
type GradeRow = { id: string; status: string; points: number | null; feedback: string; rubric_scores: unknown; dirty: boolean; updated_at: string };

async function loadSubmission(assignmentId: string, submissionId: string) {
  if (!isUuid(submissionId)) return null;
  const supabase = await createClient();
  // Staff see submitted work only (RLS hides drafts), so a draft id is simply not found.
  const { data } = await supabase
    .from("submissions")
    .select("id, assignment_id, user_id, status, submitted_count, return_note")
    .eq("id", submissionId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();
  return (data as StaffSubmission | null) ?? null;
}

async function learnerName(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  return (data as { display_name: string } | null)?.display_name ?? t("quiz.grade.unknownLearner");
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { offeringId, assignmentId, submissionId } = await params;
  const a = await getAssignment(offeringId, assignmentId);
  const s = a ? await loadSubmission(a.id, submissionId) : null;
  if (!a || !s) return { title: t("assign.title") };
  return { title: t("assign.grade.submissionTitle", { name: await learnerName(s.user_id), title: a.title }) };
}

export default async function GradeSubmissionPage({ params }: { params: Promise<Params> }) {
  const { offeringId, assignmentId, submissionId } = await params;
  const access = await requireOffering(offeringId);
  if (!access.canGrade) notFound();
  const assignment = await getAssignment(offeringId, assignmentId);
  if (!assignment) notFound();
  const submission = await loadSubmission(assignment.id, submissionId);
  if (!submission) notFound();
  const tz = access.user.timezone;
  const supabase = await createClient();

  const [name, versionRes, itemRes, queue] = await Promise.all([
    learnerName(submission.user_id),
    supabase.from("submission_versions").select(VERSION_COLUMNS).eq("submission_id", submission.id).order("version_no", { ascending: false }),
    supabase.from("grade_items").select("id").eq("assignment_id", assignment.id).maybeSingle(),
    loadGradingQueue(offeringId, assignment.id),
  ]);
  const versions = (versionRes.data ?? []) as VersionRow[];
  const itemId = (itemRes.data as { id: string } | null)?.id ?? null;
  const [gradeRes] = await Promise.all([
    itemId
      ? supabase.from("grades").select("id, status, points, feedback, rubric_scores, dirty, updated_at").eq("grade_item_id", itemId).eq("user_id", submission.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const grade = gradeRes.data as GradeRow | null;
  const { data: releasedRow } = grade
    ? await supabase.from("released_grades").select("released_at, points").eq("grade_id", grade.id).maybeSingle()
    : { data: null };
  const released = releasedRow as { released_at: string; points: number | null } | null;
  const assets = await assetInfo(versions.flatMap((v) => v.asset_ids));
  const rubric = parseRubric(assignment.rubric);
  const latest = versions[0] ?? null;
  const next = queue.find((e) => e.submission?.status === "submitted" && e.submission.id !== submission.id) ?? null;
  const base = `/courses/${offeringId}/assignments/${assignment.id}`;
  const hasCode = versions.some((v) => v.asset_ids.some((id) => /\.(txt|md|markdown|csv|py|js|ts|json|ipynb|sql|r)$/i.test(assets.get(id)?.filename ?? "")));

  return (
    <PageBody className="space-y-4">
      <div>
        <Link href={`${base}/grade`} className="text-sm text-primary underline-offset-2 hover:underline">
          ← {t("assign.grade.backToQueue")}
        </Link>
        <div className="mt-2">
          <SectionHeading actions={<RoleNotice>{t("assign.gradingBadge")}</RoleNotice>}>{t("assign.grade.submissionTitle", { name, title: assignment.title })}</SectionHeading>
        </div>
        <p className="-mt-2 text-sm text-muted">{t("quiz.timesIn", { tz })}</p>
        {next?.submission ? (
          <div className="mt-3">
            <ButtonLink href={`${base}/grade/${next.submission.id}`} size="sm" variant="secondary">
              {t("assign.grade.nextToGrade")}
              <span className="sr-only"> ({next.name ?? t("quiz.grade.unknownLearner")})</span>
            </ButtonLink>
          </div>
        ) : null}
      </div>

      <Panel className="px-4 py-4 sm:px-6">
        <DetailList
          className="lg:grid-cols-4"
          items={[
            { label: t("assign.grade.learnerLabel"), value: name },
            {
              label: t("assign.grade.statusLabel"),
              value: (
                <span className="flex flex-wrap gap-1">
                  {submission.status === "submitted" ? (
                    <Badge tone="warning">{t("assign.grade.status.submitted")}</Badge>
                  ) : submission.status === "returned" ? (
                    <Badge tone="info">{t("assign.grade.status.returned")}</Badge>
                  ) : (
                    <Badge tone="success">{t("assign.grade.status.graded")}</Badge>
                  )}
                  {latest?.is_late ? <Badge tone="warning">{t("assign.detail.lateBadge")}</Badge> : null}
                </span>
              ),
            },
            { label: t("assign.grade.submissionsLabel"), value: t("assign.submissionsUsed", { used: submission.submitted_count, max: assignment.max_submissions }) },
            { label: t("assign.detail.due"), value: assignment.due_at ? formatDateTime(assignment.due_at, tz) : t("assign.noDue") },
          ]}
        />
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="min-w-0 space-y-4">
          {latest ? (
            <Panel>
              <PanelHeader
                title={t("assign.grade.versionHeading", { version: latest.version_no })}
                actions={<Badge tone="info">{t("assign.grade.latest")}</Badge>} level={3} />
              <div className="space-y-3 px-4 py-4 sm:px-6">
                <p className="text-sm text-muted">
                  {t("assign.grade.submittedAt", { date: formatDateTime(latest.submitted_at, tz) })} · {t("assign.grade.receiptLabel")} <span className="font-mono">{latest.receipt_code}</span>
                </p>
                <VersionContents version={latest} assets={assets} text="full" />
                {hasCode ? <p className="text-xs text-muted">{t("assign.grade.codeNote")}</p> : null}
              </div>
            </Panel>
          ) : (
            <Alert tone="info">{t("assign.grade.notSubmittedYet")}</Alert>
          )}
          {versions.length > 1 ? (
            <Panel>
              <PanelHeader title={t("assign.grade.earlierVersions")} level={3} />
              <ul className="divide-y divide-line">
                {versions.slice(1).map((v) => (
                  <li key={v.id} className="px-4 py-3 sm:px-6">
                    <Disclosure
                      summary={
                        <span>
                          {t("assign.grade.versionHeading", { version: v.version_no })} · {formatDateTime(v.submitted_at, tz)}
                          {v.is_late ? ` · ${t("assign.detail.lateBadge")}` : ""}
                        </span>
                      }
                      summaryClassName="font-medium text-primary"
                    >
                      <p className="mb-2 text-xs text-muted">
                        {t("assign.grade.receiptLabel")} <span className="font-mono">{v.receipt_code}</span>
                      </p>
                      <VersionContents version={v} assets={assets} text="full" />
                    </Disclosure>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader title={t("assign.grade.currentGrade")} level={3} />
            <div className="space-y-3 px-4 py-4 text-sm sm:px-6">
              {grade && grade.status === "graded" ? (
                <>
                  <p className="text-lg font-semibold">{t("assign.grade.current", { points: formatPoints(grade.points), max: formatPoints(assignment.points) })}</p>
                  <p className="text-xs text-muted">{t("assign.grade.gradedBy", { date: formatDateTime(grade.updated_at, tz) })}</p>
                </>
              ) : (
                <p className="text-muted">{t("assign.grade.noGradeYet")}</p>
              )}
              {grade ? (
                released && !grade.dirty ? (
                  <p>{t("assign.grade.currentReleased", { date: formatDateTime(released.released_at, tz) })}</p>
                ) : released ? (
                  <p className="text-warning">{t("assign.grade.publishedOutdated")}</p>
                ) : (
                  <p>{t("assign.grade.currentUnreleased")}</p>
                )
              ) : null}
              {grade && grade.dirty && grade.status !== "pending" ? (
                access.canPublishGrades ? (
                  <ConfirmForm
                    action={publishSubmissionGrade}
                    fields={{ grade_id: grade.id, offering_id: offeringId, assignment_id: assignment.id }}
                    trigger={t("assign.grade.publish")}
                    triggerVariant="primary"
                    size="sm"
                    title={t("assign.grade.publishTitle")}
                    description={t("assign.grade.publishBody", { points: formatPoints(grade.points), max: formatPoints(assignment.points) })}
                    confirmLabel={t("assign.grade.publishConfirm")}
                  />
                ) : (
                  <p className="text-muted">{t("assign.grade.publishUnavailable")}</p>
                )
              ) : null}
            </div>
          </Panel>

          {latest ? (
            <Panel>
              <PanelHeader title={t("assign.grade.form", { version: latest.version_no })} level={3} />
              <div className="space-y-3 px-4 py-4 sm:px-6">
                <p className="text-sm text-muted">{t("assign.grade.gradingVersion", { version: latest.version_no })}</p>
                <SubmissionGrader
                  submissionId={submission.id}
                  versionNo={latest.version_no}
                  maxPoints={Number(assignment.points)}
                  rubric={rubric}
                  initialScores={parseRubricScores(grade?.rubric_scores)}
                  initialPoints={grade?.points === null || grade?.points === undefined ? null : Number(grade.points)}
                  initialFeedback={grade?.feedback ?? ""}
                />
              </div>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title={t("assign.grade.return")} level={3} />
            <div className="space-y-3 px-4 py-4 text-sm sm:px-6">
              {submission.status === "returned" ? (
                <Alert tone="info">
                  <p>{t("assign.grade.awaitingResubmission")}</p>
                  {submission.return_note ? <p className="mt-1 whitespace-pre-wrap break-words">{submission.return_note}</p> : null}
                </Alert>
              ) : latest ? (
                <>
                  <p className="text-muted">{t("assign.grade.returnHint")}</p>
                  {submission.submitted_count >= assignment.max_submissions ? (
                    <Alert tone="warning">{t("assign.grade.returnLimit", { used: submission.submitted_count, max: assignment.max_submissions })}</Alert>
                  ) : null}
                  <ConfirmForm
                    action={returnSubmission}
                    fields={{ submission_id: submission.id, version_no: String(latest.version_no) }}
                    trigger={t("assign.grade.return")}
                    size="sm"
                    title={t("assign.grade.returnTitle")}
                    description={t("assign.grade.returnHint")}
                    confirmLabel={t("assign.grade.returnConfirm")}
                  >
                    <Field label={t("assign.grade.returnNote")} htmlFor="return-note">
                      <Textarea id="return-note" name="note" rows={4} maxLength={5000} />
                    </Field>
                  </ConfirmForm>
                </>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>
    </PageBody>
  );
}
