import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { requireOffering } from "@/lib/data/offering-access";
import { createClient } from "@/lib/supabase/server";
import { getQuiz, type AuthoringQuestion, type QuizVersionRow } from "@/lib/assessment/quiz-data";
import { pointsLabel } from "@/lib/assessment/quiz-text";
import { formatPoints } from "@/lib/domain/grades";
import { formatDateTime } from "@/lib/time";
import {
  createDraftVersion,
  deleteQuestion,
  moveQuestion,
  publishQuizVersion,
  saveQuizInstructions,
  updateQuizSettings,
} from "@/app/actions/quizzes";
import { ModeBadge, PublicationBadge, RoleNotice } from "@/components/assessment/badges";
import { SectionHeading } from "@/components/assessment/detail-list";
import { QuestionEditor } from "@/components/assessment/question-editor";
import { QuizSettingsFields } from "@/components/assessment/quiz-settings-fields";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { MarkdownField } from "@/components/ui/markdown-field";
import { RichText } from "@/components/ui/rich-text";
import { SubmitButton } from "@/components/ui/submit-button";
import { Table, td, th } from "@/components/ui/table";
import { t, type MessageKey } from "@/i18n";

type Params = { offeringId: string; quizId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { offeringId, quizId } = await params;
  const quiz = await getQuiz(offeringId, quizId);
  return { title: quiz ? t("quiz.author.editTitle", { title: quiz.title }) : t("quiz.title") };
}

const TYPE_LABEL: Record<string, MessageKey> = {
  single_choice: "quiz.type.singleChoice",
  multiple_select: "quiz.type.multipleSelect",
  true_false: "quiz.type.trueFalse",
  short_answer: "quiz.type.shortAnswer",
};

type VersionWithBy = QuizVersionRow & { profiles: { display_name: string } | null };

export default async function EditQuizPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ created?: string }> }) {
  const { offeringId, quizId } = await params;
  const sp = await searchParams;
  const access = await requireOffering(offeringId);
  if (!access.canAuthor) notFound();
  const quiz = await getQuiz(offeringId, quizId);
  if (!quiz) notFound();
  const tz = access.user.timezone;
  const supabase = await createClient();

  const [versionRes, itemRes, submittedRes] = await Promise.all([
    supabase
      .from("quiz_versions")
      .select("id, quiz_id, version_no, status, instructions, published_at, published_by, created_at, profiles!quiz_versions_published_by_fkey(display_name)")
      .eq("quiz_id", quiz.id)
      .order("version_no", { ascending: false }),
    supabase.from("grade_items").select("max_points, counts_toward_total").eq("quiz_id", quiz.id).maybeSingle(),
    supabase.from("quiz_attempts").select("id", { count: "exact", head: true }).eq("quiz_id", quiz.id).neq("status", "in_progress"),
  ]);
  const versions = (versionRes.data ?? []) as unknown as VersionWithBy[];
  const draft = versions.find((v) => v.status === "draft") ?? null;
  const live = versions.find((v) => v.id === quiz.current_version_id) ?? null;
  const editing = draft ?? live;
  const ids = versions.map((v) => v.id);
  const [authoringRes, countRes, attemptRes] = await Promise.all([
    editing ? supabase.rpc("get_quiz_authoring", { p_version: editing.id }) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("questions").select("quiz_version_id").in("quiz_version_id", ids) : Promise.resolve({ data: [] }),
    supabase.from("quiz_attempts").select("quiz_version_id").eq("quiz_id", quiz.id),
  ]);
  const questions = ((authoringRes.data ?? []) as AuthoringQuestion[]).map((q) => ({ ...q, points: Number(q.points) }));
  const questionCount = new Map<string, number>();
  for (const r of (countRes.data ?? []) as { quiz_version_id: string }[]) questionCount.set(r.quiz_version_id, (questionCount.get(r.quiz_version_id) ?? 0) + 1);
  const attemptCount = new Map<string, number>();
  for (const r of (attemptRes.data ?? []) as { quiz_version_id: string }[]) attemptCount.set(r.quiz_version_id, (attemptCount.get(r.quiz_version_id) ?? 0) + 1);
  const totalPoints = questions.reduce((s, q) => s + q.points, 0);
  const item = itemRes.data as { max_points: number; counts_toward_total: boolean } | null;
  const scoringLocked = (submittedRes.count ?? 0) > 0;
  const base = `/courses/${offeringId}/quizzes/${quiz.id}`;
  const editable = Boolean(draft);
  const nextVersion = (versions[0]?.version_no ?? 0) + 1;

  return (
    <PageBody className="space-y-6">
      <div>
        <Link href={`/courses/${offeringId}/quizzes`} className="text-sm text-primary underline-offset-2 hover:underline">
          ← {t("quiz.backToQuizzes")}
        </Link>
        <div className="mt-2">
          <SectionHeading
            actions={
              <>
                <RoleNotice>{t("quiz.authoringBadge")}</RoleNotice>
                <ModeBadge practice={item ? !item.counts_toward_total : false} />
                <PublicationBadge status={quiz.status} />
              </>
            }
          >
            {t("quiz.author.editTitle", { title: quiz.title })}
          </SectionHeading>
        </div>
        <div className="flex flex-wrap gap-2">
          {draft ? <ButtonLink href={`${base}/preview?version=${draft.id}`} size="sm" variant="secondary">{t("quiz.author.previewDraft")}</ButtonLink> : null}
          {live ? <ButtonLink href={`${base}/preview?version=${live.id}`} size="sm" variant="secondary">{t("quiz.author.previewLive")}</ButtonLink> : null}
          <ButtonLink href={base} size="sm" variant="secondary">{t("quiz.author.learnerOverview")}</ButtonLink>
          {access.canGrade ? <ButtonLink href={`${base}/grade`} size="sm" variant="secondary">{t("quiz.list.grade")}</ButtonLink> : null}
        </div>
      </div>

      {sp.created ? <Alert tone="success" live>{t("quiz.author.createdNotice")}</Alert> : null}

      {/* Version and publishing */}
      <Panel>
        <PanelHeader title={t("quiz.author.versionHeading")} level={3} />
        <div className="space-y-4 px-4 py-4 sm:px-6">
          {live ? (
            <p>{t("quiz.author.liveVersion", { version: live.version_no, date: formatDateTime(live.published_at, tz) })}</p>
          ) : (
            <p>{t("quiz.author.notPublished")}</p>
          )}
          {draft ? (
            <div className="space-y-3">
              <p>{t("quiz.author.draftSummary", { version: draft.version_no, count: questions.length, points: formatPoints(totalPoints) })}</p>
              {questions.length === 0 ? <p className="text-sm text-muted">{t("quiz.author.publishNeedsQuestions")}</p> : null}
              <ConfirmForm
                action={publishQuizVersion}
                fields={{ version_id: draft.id }}
                trigger={t("quiz.author.publish", { version: draft.version_no })}
                triggerVariant="primary"
                title={t("quiz.author.publishTitle", { version: draft.version_no })}
                description={t("quiz.author.publishBody", { version: draft.version_no })}
                confirmLabel={t("quiz.author.publishConfirm")}
                disabled={questions.length === 0}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm">{t("quiz.author.noDraft")}</p>
              <ActionForm action={createDraftVersion}>
                <input type="hidden" name="quiz_id" value={quiz.id} />
                <p className="mb-2 text-xs text-muted">{t("quiz.author.createDraftHint", { version: live?.version_no ?? 1 })}</p>
                <SubmitButton variant="secondary" pendingText={t("common.saving")}>{t("quiz.author.createDraft", { version: nextVersion })}</SubmitButton>
              </ActionForm>
            </div>
          )}
        </div>
      </Panel>

      {/* Settings */}
      <Panel>
        <PanelHeader title={t("quiz.author.settings")} level={3} />
        <div className="px-4 py-4 sm:px-6">
          <ActionForm action={updateQuizSettings}>
            <input type="hidden" name="quiz_id" value={quiz.id} />
            <QuizSettingsFields
              quiz={quiz}
              gradePoints={Number(item?.max_points ?? 100)}
              practice={item ? !item.counts_toward_total : false}
              tz={tz}
              scoringLocked={scoringLocked}
            />
            <div className="mt-5">
              <SubmitButton pendingText={t("common.saving")}>{t("quiz.author.saveSettings")}</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </Panel>

      {/* Instructions */}
      <Panel>
        <PanelHeader title={t("quiz.author.instructions")} level={3} />
        <div className="px-4 py-4 sm:px-6">
          {draft ? (
            <ActionForm action={saveQuizInstructions}>
              <input type="hidden" name="version_id" value={draft.id} />
              <MarkdownField name="instructions" label={t("quiz.author.instructions")} html={draft.instructions} hint={t("quiz.author.instructionsHint")} rows={6} maxLength={20000} />
              <div className="mt-3">
                <SubmitButton pendingText={t("common.saving")}>{t("quiz.author.saveInstructions")}</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted">{t("quiz.author.instructionsPublished")}</p>
              {live?.instructions ? <RichText html={live.instructions} /> : <p className="text-muted">{t("quiz.overview.noInstructions")}</p>}
            </div>
          )}
        </div>
      </Panel>

      {/* Questions */}
      <section aria-labelledby="questions-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="questions-heading" className="text-lg font-semibold">
            {t("quiz.author.questions")}
            {editing ? <span className="ml-2 text-sm font-normal text-muted">{t("quiz.list.version", { version: editing.version_no })}</span> : null}
          </h3>
          {questions.length > 0 ? <p className="text-sm text-muted">{t("quiz.author.totalQuestionPoints", { points: formatPoints(totalPoints) })}</p> : null}
        </div>
        {!editable && live ? <Alert tone="info">{t("quiz.author.questionsReadOnly")}</Alert> : null}
        {questions.length === 0 ? (
          <EmptyState title={t("quiz.author.noQuestions")} />
        ) : (
          <ol className="space-y-4">
            {questions.map((q, i) => (
              <li key={q.id}>
                <QuestionCard
                  q={q}
                  index={i}
                  count={questions.length}
                  versionId={editing!.id}
                  editable={editable}
                />
              </li>
            ))}
          </ol>
        )}
        {draft ? (
          <Panel>
            <PanelHeader title={t("quiz.author.addQuestion")} level={3} />
            <div className="px-4 py-4 sm:px-6">
              <QuestionEditor versionId={draft.id} />
            </div>
          </Panel>
        ) : null}
      </section>

      {/* Version history */}
      <section aria-labelledby="history-heading" className="space-y-3">
        <h3 id="history-heading" className="text-lg font-semibold">{t("quiz.author.history")}</h3>
        <Table caption={t("quiz.author.history")} captionHidden>
          <thead>
            <tr>
              <th scope="col" className={th}>{t("quiz.author.col.version")}</th>
              <th scope="col" className={th}>{t("quiz.author.col.status")}</th>
              <th scope="col" className={th}>{t("quiz.author.col.published")}</th>
              <th scope="col" className={th}>{t("quiz.author.col.publishedBy")}</th>
              <th scope="col" className={th}>{t("quiz.author.col.questions")}</th>
              <th scope="col" className={th}>{t("quiz.author.col.attempts")}</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <th scope="row" className={`${td} font-medium`}>
                  <Link href={`${base}/preview?version=${v.id}`} className="text-primary underline underline-offset-2">
                    {t("quiz.list.version", { version: v.version_no })}
                  </Link>
                </th>
                <td className={td}>
                  <Badge tone={v.status === "published" ? "success" : v.status === "draft" ? "warning" : "neutral"}>
                    {v.status === "published" ? t("quiz.author.versionStatus.published") : v.status === "draft" ? t("quiz.author.versionStatus.draft") : t("quiz.author.versionStatus.retired")}
                  </Badge>
                </td>
                <td className={td}>{v.published_at ? formatDateTime(v.published_at, tz) : "–"}</td>
                <td className={td}>{v.profiles?.display_name ?? "–"}</td>
                <td className={td}>{questionCount.get(v.id) ?? 0}</td>
                <td className={td}>{attemptCount.get(v.id) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="text-sm text-muted">{t("quiz.author.historyNote")}</p>
      </section>
    </PageBody>
  );
}

function QuestionCard({ q, index, count, versionId, editable }: { q: AuthoringQuestion; index: number; count: number; versionId: string; editable: boolean }) {
  const number = index + 1;
  const correct = new Set(q.correct);
  return (
    <Panel className="px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="font-semibold">{t("quiz.author.questionHeading", { number })}</h4>
        <div className="flex flex-wrap gap-2">
          <Badge>{t(TYPE_LABEL[q.type] ?? "quiz.type.singleChoice")}</Badge>
          <Badge tone="info">{pointsLabel(q.points)}</Badge>
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words">{q.prompt}</p>
      {q.type !== "short_answer" ? (
        <ul className="mt-3 space-y-1.5" aria-label={t("quiz.author.field.choices")}>
          {q.choices.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start gap-2 rounded-md border border-line px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                {q.type === "true_false" ? (c.id === "true" ? t("quiz.author.true") : t("quiz.author.false")) : c.text}
              </span>
              {correct.has(c.id) ? <Badge tone="success">{t("quiz.author.correctBadge")}</Badge> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 text-sm">
        <span className="font-semibold">{q.type === "short_answer" ? t("quiz.author.field.modelAnswer") : t("quiz.author.explanationLabel")}: </span>
        {q.explanation ? <span className="whitespace-pre-wrap break-words">{q.explanation}</span> : <span className="text-muted">{t("quiz.author.noExplanation")}</span>}
      </div>
      {editable ? (
        <div className="mt-4 space-y-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-start gap-2">
            <ActionForm action={moveQuestion} className="flex flex-wrap gap-2">
              <input type="hidden" name="version_id" value={versionId} />
              <input type="hidden" name="question_id" value={q.id} />
              <button type="submit" name="direction" value="up" disabled={index === 0} className={buttonClass("secondary", "sm")}>
                <ArrowUp aria-hidden="true" className="h-4 w-4" /> {t("quiz.author.moveUp")}
                <span className="sr-only"> {t("quiz.author.questionHeading", { number })}</span>
              </button>
              <button type="submit" name="direction" value="down" disabled={index === count - 1} className={buttonClass("secondary", "sm")}>
                <ArrowDown aria-hidden="true" className="h-4 w-4" /> {t("quiz.author.moveDown")}
                <span className="sr-only"> {t("quiz.author.questionHeading", { number })}</span>
              </button>
            </ActionForm>
            <ConfirmForm
              action={deleteQuestion}
              fields={{ question_id: q.id, version_id: versionId }}
              trigger={
                <>
                  {t("quiz.author.deleteQuestion")}
                  <span className="sr-only"> {t("quiz.author.questionHeading", { number })}</span>
                </>
              }
              size="sm"
              tone="danger"
              title={t("quiz.author.deleteTitle", { number })}
              description={t("quiz.author.deleteBody")}
              confirmLabel={t("quiz.author.deleteQuestion")}
            />
          </div>
          <Disclosure summary={t("quiz.author.editQuestion", { number })} summaryClassName="min-h-10 font-medium text-primary">
            <div className="rounded-md border border-line bg-canvas/60 p-3 sm:p-4">
              <QuestionEditor
                versionId={versionId}
                number={number}
                question={{ id: q.id, type: q.type, prompt: q.prompt, points: Number(q.points), choices: q.choices, correct: q.correct, explanation: q.explanation }}
              />
            </div>
          </Disclosure>
        </div>
      ) : null}
    </Panel>
  );
}
