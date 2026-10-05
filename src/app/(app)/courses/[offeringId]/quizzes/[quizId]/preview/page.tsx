import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOffering } from "@/lib/data/offering-access";
import { createClient } from "@/lib/supabase/server";
import { getQuiz, type AuthoringQuestion } from "@/lib/assessment/quiz-data";
import { isUuid } from "@/lib/forms";
import { timeLimitText } from "@/lib/assessment/quiz-text";
import { AttemptRunner, type RunnerQuestion } from "@/components/assessment/attempt-runner";
import { RoleNotice } from "@/components/assessment/badges";
import { SectionHeading } from "@/components/assessment/detail-list";
import { PageBody } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { RichText } from "@/components/ui/rich-text";
import { t } from "@/i18n";

type Params = { offeringId: string; quizId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { offeringId, quizId } = await params;
  const quiz = await getQuiz(offeringId, quizId);
  return { title: quiz ? t("quiz.preview.title", { title: quiz.title }) : t("quiz.title") };
}

/**
 * Staff preview of a quiz version exactly as learners see it, through the same attempt
 * component in preview mode: nothing is saved and no attempt is created. Answer keys are
 * not passed to the page even though the author may read them.
 */
export default async function QuizPreviewPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ version?: string }> }) {
  const { offeringId, quizId } = await params;
  const sp = await searchParams;
  const access = await requireOffering(offeringId);
  if (!access.canAuthor) notFound();
  const quiz = await getQuiz(offeringId, quizId);
  if (!quiz) notFound();
  const supabase = await createClient();
  const { data: versions } = await supabase.from("quiz_versions").select("id, version_no, status, instructions").eq("quiz_id", quiz.id);
  const list = (versions ?? []) as { id: string; version_no: number; status: string; instructions: string }[];
  const version =
    (isUuid(sp.version) ? list.find((v) => v.id === sp.version) : undefined) ??
    list.find((v) => v.status === "draft") ??
    list.find((v) => v.id === quiz.current_version_id);
  if (!version) notFound();
  const { data } = await supabase.rpc("get_quiz_authoring", { p_version: version.id });
  const questions: RunnerQuestion[] = ((data ?? []) as AuthoringQuestion[]).map((q) => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    points: Number(q.points),
    choices: (q.choices ?? []).map((c) => ({ id: String(c.id), text: String(c.text) })),
    response: null,
    saved_at: null,
  }));
  const base = `/courses/${offeringId}/quizzes/${quiz.id}`;

  return (
    <PageBody className="space-y-4">
      <div>
        <Link href={`${base}/edit`} className="text-sm text-primary underline-offset-2 hover:underline">
          ← {t("quiz.preview.backToEdit")}
        </Link>
        <div className="mt-2">
          <SectionHeading actions={<RoleNotice>{t("quiz.authoringBadge")}</RoleNotice>}>{t("quiz.preview.title", { title: quiz.title })}</SectionHeading>
        </div>
      </div>
      <Alert tone="info" title={t("quiz.preview.banner", { version: version.version_no })}>
        <p>{t("quiz.preview.details", { limit: timeLimitText(quiz.time_limit_minutes), count: questions.length })}</p>
        {quiz.shuffle_questions || quiz.shuffle_choices ? <p className="mt-1">{t("quiz.preview.shuffleNote")}</p> : null}
      </Alert>
      {version.instructions ? (
        <Disclosure summary={t("quiz.attempt.instructionsToggle")} summaryClassName="min-h-10 font-medium text-primary">
          <div className="rounded-md border border-line bg-panel px-4 py-3">
            <RichText html={version.instructions} />
          </div>
        </Disclosure>
      ) : null}
      {questions.length === 0 ? (
        <EmptyState title={t("quiz.preview.noQuestions")} />
      ) : (
        <AttemptRunner
          mode="preview"
          attemptId="preview"
          attemptNo={1}
          questions={questions}
          initialDeadline={null}
          serverNow={quiz.created_at}
          tz={access.user.timezone}
          overviewHref={`${base}/edit`}
          backLabel={t("quiz.preview.backToEdit")}
        />
      )}
    </PageBody>
  );
}
