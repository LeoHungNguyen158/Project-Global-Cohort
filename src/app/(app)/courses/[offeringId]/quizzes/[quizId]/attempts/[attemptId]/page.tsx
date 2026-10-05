import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOffering } from "@/lib/data/offering-access";
import { createClient } from "@/lib/supabase/server";
import { getAttempt, getQuiz, type QuizLearnerDetails } from "@/lib/assessment/quiz-data";
import { formatDateTime } from "@/lib/time";
import { AttemptRunner, type RunnerQuestion } from "@/components/assessment/attempt-runner";
import { SectionHeading } from "@/components/assessment/detail-list";
import { PageBody } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { RichText } from "@/components/ui/rich-text";
import { t } from "@/i18n";

type Params = { offeringId: string; quizId: string; attemptId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { offeringId, quizId } = await params;
  const quiz = await getQuiz(offeringId, quizId);
  return { title: quiz?.title ?? t("quiz.title") };
}

/**
 * A learner's own attempt. Questions come from the attempt's version snapshot in the
 * attempt's order; the payload carries only question text, choices and the learner's
 * saved answers (never keys, explanations or scoring data).
 */
export default async function AttemptPage({ params }: { params: Promise<Params> }) {
  const { offeringId, quizId, attemptId } = await params;
  const access = await requireOffering(offeringId);
  const quiz = await getQuiz(offeringId, quizId);
  if (!quiz) notFound();
  const attempt = await getAttempt(attemptId);
  if (!attempt || attempt.quiz_id !== quiz.id || attempt.offering_id !== offeringId) notFound();
  const tz = access.user.timezone;
  const base = `/courses/${offeringId}/quizzes/${quiz.id}`;

  const heading = (
    <div>
      <Link href={base} className="text-sm text-primary underline-offset-2 hover:underline">
        ← {t("quiz.backToQuiz")}
      </Link>
      <div className="mt-2">
        <SectionHeading>{t("quiz.attempt.heading", { title: quiz.title, number: attempt.attempt_no })}</SectionHeading>
      </div>
    </div>
  );

  if (attempt.status !== "in_progress") {
    const supabase = await createClient();
    const { data } = await supabase.rpc("quiz_learner_details", { p_quiz: quiz.id });
    const summary = (data as QuizLearnerDetails | null)?.attempts.find((a) => a.id === attempt.id);
    const time = attempt.submitted_at ? formatDateTime(attempt.submitted_at, tz) : "";
    return (
      <PageBody className="space-y-6">
        {heading}
        <Alert tone={attempt.status === "voided" ? "warning" : "success"} title={t("quiz.attempt.endedTitle")}>
          <p>
            {attempt.status === "voided"
              ? t("quiz.attempt.voidedBody")
              : attempt.finalized_reason === "expired"
                ? t("quiz.attempt.expiredBody", { time })
                : t("quiz.attempt.submittedBody", { time })}
          </p>
        </Alert>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={base}>{t("quiz.backToQuiz")}</ButtonLink>
          {summary?.review_available ? (
            <ButtonLink href={`${base}/attempts/${attempt.id}/review`} variant="secondary">
              {t("quiz.attempt.reviewLink")}
            </ButtonLink>
          ) : null}
        </div>
      </PageBody>
    );
  }

  const questions: RunnerQuestion[] = attempt.questions.map((q) => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    points: q.points,
    choices: q.choices,
    response: q.response,
    saved_at: q.saved_at,
  }));

  return (
    <PageBody className="space-y-4">
      {heading}
      {attempt.instructions ? (
        <Disclosure summary={t("quiz.attempt.instructionsToggle")} summaryClassName="min-h-10 font-medium text-primary">
          <div className="rounded-md border border-line bg-panel px-4 py-3">
            <RichText html={attempt.instructions} />
          </div>
        </Disclosure>
      ) : null}
      <AttemptRunner
        mode="attempt"
        attemptId={attempt.id}
        attemptNo={attempt.attempt_no}
        questions={questions}
        initialDeadline={attempt.deadline_at}
        serverNow={attempt.server_now}
        tz={tz}
        overviewHref={base}
      />
    </PageBody>
  );
}
