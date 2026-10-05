import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOffering } from "@/lib/data/offering-access";
import { createQuiz } from "@/app/actions/quizzes";
import { RoleNotice } from "@/components/assessment/badges";
import { SectionHeading } from "@/components/assessment/detail-list";
import { QuizSettingsFields } from "@/components/assessment/quiz-settings-fields";
import { PageBody } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { ActionForm } from "@/components/ui/action-form";
import { MarkdownField } from "@/components/ui/markdown-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("quiz.author.newTitle") };

export default async function NewQuizPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const access = await requireOffering(offeringId);
  if (!access.canAuthor) notFound();
  return (
    <PageBody className="space-y-4">
      <div>
        <Link href={`/courses/${offeringId}/quizzes`} className="text-sm text-primary underline-offset-2 hover:underline">
          ← {t("quiz.backToQuizzes")}
        </Link>
        <div className="mt-2">
          <SectionHeading actions={<RoleNotice>{t("quiz.authoringBadge")}</RoleNotice>}>{t("quiz.author.newTitle")}</SectionHeading>
        </div>
        <p className="-mt-2 text-sm text-muted">{t("quiz.author.newIntro")}</p>
      </div>
      <Panel className="px-4 py-5 sm:px-6">
        <ActionForm action={createQuiz}>
          <input type="hidden" name="offering_id" value={offeringId} />
          <div className="space-y-5">
            <QuizSettingsFields gradePoints={100} practice={false} tz={access.user.timezone} />
            <MarkdownField name="instructions" label={t("quiz.author.instructions")} hint={t("quiz.author.instructionsHint")} rows={5} maxLength={20000} />
          </div>
          <div className="mt-5">
            <SubmitButton pendingText={t("quiz.author.creating")}>{t("quiz.author.create")}</SubmitButton>
          </div>
        </ActionForm>
      </Panel>
    </PageBody>
  );
}
