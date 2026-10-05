import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, CircleDot, XCircle } from "lucide-react";
import { requireOffering } from "@/lib/data/offering-access";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/forms";
import { getAttemptReview, getQuiz, type ReviewQuestion } from "@/lib/assessment/quiz-data";
import { pointsLabel, scoreText } from "@/lib/assessment/quiz-text";
import { formatPoints } from "@/lib/domain/grades";
import { formatDateTime } from "@/lib/time";
import { gradeAttemptQuestion, voidQuizAttempt } from "@/app/actions/quizzes";
import { AttemptStatusBadge, RoleNotice } from "@/components/assessment/badges";
import { DetailList, SectionHeading } from "@/components/assessment/detail-list";
import { GradeFormToggle } from "@/components/assessment/grade-form-toggle";
import { PageBody } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/components/ui/cn";
import { t } from "@/i18n";

type Params = { offeringId: string; quizId: string; attemptId: string };

export const metadata: Metadata = { title: t("quiz.grade.attemptMetaTitle") };

type AttemptRow = {
  id: string;
  quiz_id: string;
  offering_id: string;
  user_id: string;
  attempt_no: number;
  status: "in_progress" | "submitted" | "graded" | "voided";
  started_at: string;
  deadline_at: string | null;
  submitted_at: string | null;
  finalized_reason: string | null;
  quiz_version_id: string;
  profiles: { display_name: string } | null;
  quiz_versions: { version_no: number } | null;
};

/** Staff view of one attempt: answers with keys, scores, manual grading, overrides and voiding. */
export default async function GradeAttemptPage({ params }: { params: Promise<Params> }) {
  const { offeringId, quizId, attemptId } = await params;
  const access = await requireOffering(offeringId);
  if (!access.canGrade || !isUuid(attemptId)) notFound();
  const quiz = await getQuiz(offeringId, quizId);
  if (!quiz) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from("quiz_attempts")
    .select("id, quiz_id, offering_id, user_id, attempt_no, status, started_at, deadline_at, submitted_at, finalized_reason, quiz_version_id, profiles(display_name), quiz_versions(version_no)")
    .eq("id", attemptId)
    .eq("quiz_id", quiz.id)
    .maybeSingle();
  const attempt = data as unknown as AttemptRow | null;
  if (!attempt) notFound();
  const review = await getAttemptReview(attempt.id);
  if (!review) notFound();
  const tz = access.user.timezone;
  const name = attempt.profiles?.display_name ?? t("quiz.grade.unknownLearner");
  const gradable = attempt.status === "submitted" || attempt.status === "graded";
  const total = review.questions.reduce((acc, q) => ({ earned: acc.earned + Number(q.earned ?? 0), max: acc.max + Number(q.points) }), { earned: 0, max: 0 });
  const pendingCount = review.questions.filter((q) => q.needs_manual).length;
  const base = `/courses/${offeringId}/quizzes/${quiz.id}`;

  return (
    <PageBody className="space-y-6">
      <div>
        <Link href={`${base}/grade`} className="text-sm text-primary underline-offset-2 hover:underline">
          ← {t("quiz.grade.backToAttempts")}
        </Link>
        <div className="mt-2">
          <SectionHeading actions={<RoleNotice>{t("quiz.gradingBadge")}</RoleNotice>}>{t("quiz.grade.attemptTitle", { name, number: attempt.attempt_no })}</SectionHeading>
        </div>
        <p className="-mt-2 text-sm text-muted">{quiz.title}</p>
      </div>

      <Panel className="px-4 py-4 sm:px-6">
        <DetailList
          className="lg:grid-cols-4"
          items={[
            { label: t("quiz.grade.col.status"), value: <AttemptStatusBadge status={attempt.status} /> },
            { label: t("quiz.grade.col.started"), value: formatDateTime(attempt.started_at, tz) },
            {
              label: t("quiz.grade.col.submitted"),
              value: attempt.submitted_at ? (
                <>
                  {formatDateTime(attempt.submitted_at, tz)}
                  {attempt.finalized_reason === "expired" ? <span className="block text-xs text-muted">{t("quiz.reason.expired")}</span> : null}
                </>
              ) : (
                "–"
              ),
            },
            {
              label: t("quiz.grade.col.score"),
              value: gradable ? (
                <>
                  {scoreText(total.earned, total.max)}
                  {pendingCount > 0 ? <span className="block text-xs text-warning">{pendingCount === 1 ? t("quiz.grade.pendingItemsOne") : t("quiz.grade.pendingItems", { count: pendingCount })}</span> : null}
                </>
              ) : (
                "–"
              ),
            },
          ]}
        />
        <p className="mt-3 text-sm text-muted">{t("quiz.grade.version", { version: attempt.quiz_versions?.version_no ?? "?" })}</p>
      </Panel>

      {attempt.status === "voided" ? <Alert tone="warning">{t("quiz.grade.voidedNote")}</Alert> : null}
      {attempt.status === "in_progress" ? <Alert tone="info">{t("quiz.grade.inProgressNote")}</Alert> : null}

      {attempt.status !== "in_progress" ? (
        <ol className="space-y-4">
          {review.questions.map((q, i) => (
            <li key={q.id}>
              <GradeCard q={q} index={i} total={review.questions.length} attemptId={attempt.id} gradable={gradable} />
            </li>
          ))}
        </ol>
      ) : null}

      {attempt.status !== "voided" ? (
        <Panel className="px-4 py-4 sm:px-6">
          <h3 className="font-semibold">{t("quiz.grade.void")}</h3>
          <p className="mt-1 text-sm text-muted">{t("quiz.grade.voidBody")}</p>
          <div className="mt-3">
            <ConfirmForm
              action={voidQuizAttempt}
              fields={{ attempt_id: attempt.id }}
              trigger={t("quiz.grade.void")}
              tone="danger"
              triggerVariant="danger"
              title={t("quiz.grade.voidTitle", { number: attempt.attempt_no })}
              description={t("quiz.grade.voidBody")}
              confirmLabel={t("quiz.grade.voidConfirm")}
            >
              <Field label={t("quiz.grade.voidReason")} htmlFor="void-reason" required>
                <Textarea id="void-reason" name="reason" required minLength={3} maxLength={1000} rows={3} />
              </Field>
            </ConfirmForm>
          </div>
        </Panel>
      ) : null}
    </PageBody>
  );
}

function GradeCard({ q, index, total, attemptId, gradable }: { q: ReviewQuestion; index: number; total: number; attemptId: string; gradable: boolean }) {
  const correct = new Set(q.correct ?? []);
  const response = q.response;
  const chosen = new Set<string>(response && "choices" in response ? response.choices : response && "choice" in response ? [response.choice] : []);
  const headingId = `gq-${q.id}`;
  const form = (
    <ActionForm action={gradeAttemptQuestion} className="space-y-3">
      <input type="hidden" name="attempt_id" value={attemptId} />
      <input type="hidden" name="question_id" value={q.id} />
      <input type="hidden" name="max_points" value={String(q.points)} />
      <Field label={t("quiz.grade.pointsLabel", { max: formatPoints(q.points) })} htmlFor={`pts-${q.id}`} required>
        <Input
          id={`pts-${q.id}`}
          name="points"
          type="number"
          inputMode="decimal"
          min={0}
          max={Number(q.points)}
          step={0.01}
          required
          defaultValue={q.needs_manual ? "" : q.earned ?? ""}
          className="max-w-40"
        />
      </Field>
      <Field label={t("quiz.grade.feedbackLabel")} htmlFor={`fb-${q.id}`}>
        <Textarea id={`fb-${q.id}`} name="feedback" maxLength={10000} rows={3} defaultValue={q.feedback ?? ""} />
      </Field>
      <SubmitButton pendingText={t("common.saving")}>
        {t("quiz.grade.saveGrade")}
        <span className="sr-only"> {t("quiz.attempt.questionShort", { number: index + 1 })}</span>
      </SubmitButton>
    </ActionForm>
  );
  return (
    <section aria-labelledby={headingId} className="rounded-[var(--radius-panel)] border border-line bg-panel px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={headingId} className="text-base font-semibold">{t("quiz.attempt.questionOf", { number: index + 1, total })}</h3>
        {q.needs_manual ? (
          <Badge tone="warning">{t("quiz.grade.needsGrading")}</Badge>
        ) : q.earned !== null ? (
          <span className="text-sm font-semibold">{t("quiz.review.earned", { earned: formatPoints(q.earned), points: formatPoints(q.points) })}</span>
        ) : (
          <span className="text-sm text-muted">{pointsLabel(q.points)}</span>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words">{q.prompt}</p>
      {q.type === "short_answer" ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("quiz.grade.learnerAnswer")}</p>
          {response && "text" in response && response.text.trim() ? (
            <p className="mt-1 whitespace-pre-wrap break-words rounded-md border border-line bg-canvas px-3 py-2">{response.text}</p>
          ) : (
            <p className="mt-1 text-muted">{t("quiz.review.noAnswer")}</p>
          )}
        </div>
      ) : (
        <ul className="mt-3 space-y-2" aria-label={t("quiz.review.choicesLabel")}>
          {q.choices.map((c) => {
            const isCorrect = correct.has(c.id);
            const picked = chosen.has(c.id);
            const label = q.type === "true_false" ? (c.id === "true" ? t("quiz.author.true") : t("quiz.author.false")) : c.text;
            return (
              <li
                key={c.id}
                className={cn(
                  "flex flex-wrap items-start gap-2 rounded-md border px-3 py-2 text-sm",
                  isCorrect ? "border-[#bbf7d0] bg-success-soft" : picked ? "border-[#fecaca] bg-danger-soft" : "border-line bg-white",
                )}
              >
                {isCorrect ? (
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                ) : picked ? (
                  <XCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                ) : (
                  <CircleDot aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />
                )}
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{label}</span>
                <span className="flex flex-wrap gap-1">
                  {picked ? <Badge tone="info">{t("quiz.grade.learnerChoice")}</Badge> : null}
                  {isCorrect ? <Badge tone="success">{t("quiz.review.correctAnswer")}</Badge> : null}
                </span>
              </li>
            );
          })}
          {chosen.size === 0 ? <li className="text-sm text-muted">{t("quiz.review.noAnswer")}</li> : null}
        </ul>
      )}
      {q.explanation ? (
        <p className="mt-3 text-sm">
          <span className="font-semibold">{q.type === "short_answer" ? t("quiz.author.field.modelAnswer") : t("quiz.author.explanationLabel")}: </span>
          <span className="whitespace-pre-wrap break-words">{q.explanation}</span>
        </p>
      ) : null}
      {q.feedback && !q.needs_manual ? (
        <p className="mt-2 text-sm">
          <span className="font-semibold">{t("quiz.grade.feedbackLabel")}: </span>
          <span className="whitespace-pre-wrap break-words">{q.feedback}</span>
        </p>
      ) : null}
      {gradable ? (
        <div className="mt-4 border-t border-line pt-3">
          <GradeFormToggle
            needsManual={q.needs_manual ?? false}
            label={q.type === "short_answer" ? t("quiz.grade.changeGrade") : t("quiz.grade.override")}
            hint={t("quiz.grade.overrideHint")}
          >
            {form}
          </GradeFormToggle>
        </div>
      ) : null}
    </section>
  );
}
