import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOffering } from "@/lib/data/offering-access";
import { createClient } from "@/lib/supabase/server";
import { getQuiz, type StaffAttemptRow } from "@/lib/assessment/quiz-data";
import { scoreText } from "@/lib/assessment/quiz-text";
import { formatDateTime } from "@/lib/time";
import { clearAccommodation, publishQuizResults, releaseQuizAnswers } from "@/app/actions/quizzes";
import { AccommodationForm } from "@/components/assessment/accommodation-form";
import { AttemptStatusBadge, RoleNotice } from "@/components/assessment/badges";
import { SectionHeading } from "@/components/assessment/detail-list";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, td, th } from "@/components/ui/table";
import { t, type MessageKey } from "@/i18n";

type Params = { offeringId: string; quizId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { offeringId, quizId } = await params;
  const quiz = await getQuiz(offeringId, quizId);
  return { title: quiz ? t("quiz.grade.title", { title: quiz.title }) : t("quiz.title") };
}

const POLICY_NOTE: Record<string, MessageKey> = {
  after_submit: "quiz.grade.policy.afterSubmit",
  after_close: "quiz.grade.policy.afterClose",
  manual: "quiz.grade.policy.manual",
  never: "quiz.grade.policy.never",
};

type StaffAccommodationRow = {
  user_id: string;
  display_name: string | null;
  extra_minutes: number;
  extra_attempts: number;
  extended_closes_at: string | null;
  note: string;
};

type Accommodation = {
  user_id: string;
  extra_minutes: number;
  extra_attempts: number;
  extended_closes_at: string | null;
  note: string;
  profiles: { display_name: string } | null;
};

export default async function QuizGradingPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ learner?: string }> }) {
  const { offeringId, quizId } = await params;
  const sp = await searchParams;
  const access = await requireOffering(offeringId);
  if (!access.canGrade) notFound();
  const quiz = await getQuiz(offeringId, quizId);
  if (!quiz) notFound();
  const tz = access.user.timezone;
  const canManage = access.isOfferingAdmin || access.staff?.role === "instructor";
  const supabase = await createClient();

  // staff_quiz_attempts finalizes overdue attempts first, so the counts below are current.
  const { data: attemptData } = await supabase.rpc("staff_quiz_attempts", { p_quiz: quiz.id });
  const attempts = (attemptData ?? []) as StaffAttemptRow[];
  const [itemRes, accRes, enrollRes] = await Promise.all([
    supabase.from("grade_items").select("id, max_points").eq("quiz_id", quiz.id).maybeSingle(),
    // Notes are withheld from direct reads (learners can read their own row); staff get them here.
    supabase.rpc("staff_quiz_accommodations", { p_quiz: quiz.id }),
    supabase
      .from("enrollments")
      .select("user_id, status, profiles!enrollments_user_id_fkey(display_name)")
      .eq("offering_id", offeringId)
      .eq("status", "active"),
  ]);
  const item = itemRes.data as { id: string; max_points: number } | null;
  const { count: unpublished } = item
    ? await supabase.from("grades").select("id", { count: "exact", head: true }).eq("grade_item_id", item.id).eq("dirty", true).neq("status", "pending")
    : { count: 0 };
  const accommodations: Accommodation[] = ((accRes.data ?? []) as StaffAccommodationRow[])
    .map(({ display_name, ...rest }) => ({ ...rest, profiles: display_name === null ? null : { display_name } }))
    .sort((a, b) => (a.profiles?.display_name ?? "").localeCompare(b.profiles?.display_name ?? ""));
  const learners = ((enrollRes.data ?? []) as unknown as { user_id: string; profiles: { display_name: string } | null }[])
    .map((e) => ({ user_id: e.user_id, name: e.profiles?.display_name ?? t("quiz.grade.unknownLearner") }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const editing = accommodations.find((a) => a.user_id === sp.learner);

  const pending = attempts.filter((a) => a.status === "submitted").length;
  const inProgress = attempts.filter((a) => a.status === "in_progress").length;
  const base = `/courses/${offeringId}/quizzes/${quiz.id}`;

  return (
    <PageBody className="space-y-6">
      <div>
        <Link href={`/courses/${offeringId}/quizzes`} className="text-sm text-primary underline-offset-2 hover:underline">
          ← {t("quiz.backToQuizzes")}
        </Link>
        <div className="mt-2">
          <SectionHeading actions={<RoleNotice>{t("quiz.gradingBadge")}</RoleNotice>}>{t("quiz.grade.title", { title: quiz.title })}</SectionHeading>
        </div>
        <p className="-mt-2 text-sm text-muted">{t("quiz.grade.summary", { attempts: attempts.length, pending, inProgress })}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ButtonLink href={base} size="sm" variant="secondary">{t("quiz.author.learnerOverview")}</ButtonLink>
          {access.canAuthor ? <ButtonLink href={`${base}/edit`} size="sm" variant="secondary">{t("quiz.list.edit")}</ButtonLink> : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title={t("quiz.grade.results")} level={3} />
          <div className="space-y-3 px-4 py-4 text-sm sm:px-6">
            <p>{quiz.score_release === "immediate" ? t("quiz.grade.resultsImmediate") : t("quiz.grade.resultsManual")}</p>
            <p className="font-medium">{(unpublished ?? 0) > 0 ? t("quiz.grade.unpublishedCount", { count: unpublished ?? 0 }) : t("quiz.grade.allPublished")}</p>
            {(unpublished ?? 0) > 0 ? (
              access.canPublishGrades ? (
                <ConfirmForm
                  action={publishQuizResults}
                  fields={{ quiz_id: quiz.id }}
                  trigger={t("quiz.grade.publish", { count: unpublished ?? 0 })}
                  triggerVariant="primary"
                  title={t("quiz.grade.publishTitle", { count: unpublished ?? 0 })}
                  description={t("quiz.grade.publishBody")}
                  confirmLabel={t("quiz.grade.publishConfirm")}
                />
              ) : (
                <p className="text-muted">{t("quiz.grade.publishUnavailable")}</p>
              )
            ) : null}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={t("quiz.grade.answers")} level={3} />
          <div className="space-y-3 px-4 py-4 text-sm sm:px-6">
            {quiz.answers_released_at ? (
              <p>{t("quiz.grade.answersReleased", { date: formatDateTime(quiz.answers_released_at, tz) })}</p>
            ) : quiz.review_policy !== "manual" ? (
              <p>{t("quiz.grade.releaseNotManual")}</p>
            ) : access.canAuthor ? (
              <ConfirmForm
                action={releaseQuizAnswers}
                fields={{ quiz_id: quiz.id }}
                trigger={t("quiz.grade.release")}
                title={t("quiz.grade.releaseTitle")}
                description={t("quiz.grade.releaseBody")}
                confirmLabel={t("quiz.grade.releaseConfirm")}
              />
            ) : (
              <p className="text-muted">{t("quiz.grade.releaseUnavailable")}</p>
            )}
            <p className="text-muted">{t(POLICY_NOTE[quiz.review_policy])}</p>
          </div>
        </Panel>
      </div>

      <section aria-labelledby="attempts-heading" className="space-y-3">
        <h3 id="attempts-heading" className="text-lg font-semibold">{t("quiz.grade.attempts")}</h3>
        {attempts.length === 0 ? (
          <EmptyState title={t("quiz.grade.noAttempts")} />
        ) : (
          <Table caption={t("quiz.grade.attempts")} captionHidden>
            <thead>
              <tr>
                <th scope="col" className={th}>{t("quiz.grade.col.learner")}</th>
                <th scope="col" className={th}>{t("quiz.grade.col.attempt")}</th>
                <th scope="col" className={th}>{t("quiz.grade.col.started")}</th>
                <th scope="col" className={th}>{t("quiz.grade.col.submitted")}</th>
                <th scope="col" className={th}>{t("quiz.grade.col.status")}</th>
                <th scope="col" className={th}>{t("quiz.grade.col.score")}</th>
                <th scope="col" className={th}>{t("quiz.grade.col.pending")}</th>
                <th scope="col" className={th}>{t("quiz.grade.col.action")}</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.attempt_id}>
                  <th scope="row" className={`${td} font-medium`}>{a.display_name}</th>
                  <td className={td}>{a.attempt_no}</td>
                  <td className={`${td} whitespace-nowrap`}>{formatDateTime(a.started_at, tz)}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {a.submitted_at ? formatDateTime(a.submitted_at, tz) : "–"}
                    {a.finalized_reason === "expired" ? <span className="block text-xs text-muted">{t("quiz.reason.expired")}</span> : null}
                  </td>
                  <td className={td}>
                    <AttemptStatusBadge status={a.status} />
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{a.status === "in_progress" ? "–" : scoreText(a.score, a.max_score) ?? "–"}</td>
                  <td className={td}>{a.pending_manual > 0 ? <Badge tone="warning">{a.pending_manual}</Badge> : "0"}</td>
                  <td className={td}>
                    <Link href={`${base}/grade/${a.attempt_id}`} className="font-medium text-primary underline underline-offset-2">
                      {a.pending_manual > 0 ? t("quiz.grade.gradeLink") : t("quiz.grade.viewLink")}
                      <span className="sr-only">
                        {" "}
                        {t("quiz.grade.attemptTitle", { name: a.display_name, number: a.attempt_no })}
                      </span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="acc-heading" className="space-y-3">
        <h3 id="acc-heading" className="text-lg font-semibold">{t("quiz.grade.accommodations")}</h3>
        <p className="text-sm text-muted">{t("quiz.grade.accIntro")}</p>
        {!canManage ? <Alert tone="info">{t("quiz.grade.accReadOnly")}</Alert> : null}
        {accommodations.length === 0 ? (
          <p className="text-sm">{t("quiz.grade.accNone")}</p>
        ) : (
          <Table caption={t("quiz.grade.accommodations")} captionHidden>
            <thead>
              <tr>
                <th scope="col" className={th}>{t("quiz.grade.acc.col.learner")}</th>
                <th scope="col" className={th}>{t("quiz.grade.acc.col.extraTime")}</th>
                <th scope="col" className={th}>{t("quiz.grade.acc.col.extraAttempts")}</th>
                <th scope="col" className={th}>{t("quiz.grade.acc.col.close")}</th>
                <th scope="col" className={th}>{t("quiz.grade.acc.col.note")}</th>
                {canManage ? <th scope="col" className={th}>{t("quiz.grade.col.action")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {accommodations.map((a) => {
                const name = a.profiles?.display_name ?? t("quiz.grade.unknownLearner");
                return (
                  <tr key={a.user_id}>
                    <th scope="row" className={`${td} font-medium`}>{name}</th>
                    <td className={td}>{a.extra_minutes > 0 ? t("quiz.minutes", { minutes: a.extra_minutes }) : t("quiz.grade.acc.none")}</td>
                    <td className={td}>{a.extra_attempts > 0 ? a.extra_attempts : t("quiz.grade.acc.none")}</td>
                    <td className={`${td} whitespace-nowrap`}>{a.extended_closes_at ? formatDateTime(a.extended_closes_at, tz) : t("quiz.grade.acc.none")}</td>
                    <td className={td}>{a.note || "–"}</td>
                    {canManage ? (
                      <td className={td}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`?learner=${a.user_id}#acc-form`} className="inline-flex min-h-10 items-center font-medium text-primary underline underline-offset-2">
                            {t("common.edit")}
                            <span className="sr-only"> {name}</span>
                          </Link>
                          <ConfirmForm
                            action={clearAccommodation}
                            fields={{ quiz_id: quiz.id, user_id: a.user_id }}
                            trigger={
                              <>
                                {t("quiz.grade.acc.remove")}
                                <span className="sr-only"> {name}</span>
                              </>
                            }
                            size="sm"
                            tone="danger"
                            title={t("quiz.grade.acc.removeTitle", { name })}
                            description={t("quiz.grade.acc.removeBody")}
                            confirmLabel={t("quiz.grade.acc.remove")}
                          />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {canManage ? (
          <Panel id="acc-form">
            <PanelHeader
              title={editing ? t("quiz.grade.acc.editFor", { name: editing.profiles?.display_name ?? "" }) : t("quiz.grade.acc.edit")}
              level={3}
              actions={editing ? <Link href="?#acc-form" className="text-sm text-primary underline underline-offset-2">{t("quiz.grade.acc.newInstead")}</Link> : undefined}
            />
            <div className="px-4 py-4 sm:px-6">
              <AccommodationForm
                key={editing?.user_id ?? "new"}
                quizId={quiz.id}
                learners={learners}
                current={editing ? { user_id: editing.user_id, extra_minutes: editing.extra_minutes, extra_attempts: editing.extra_attempts, extended_closes_at: editing.extended_closes_at, note: editing.note } : undefined}
                tz={tz}
                hasCloseDate={Boolean(quiz.closes_at)}
                idPrefix="acc"
              />
            </div>
          </Panel>
        ) : null}
      </section>
    </PageBody>
  );
}
