import type { Metadata } from "next";
import Link from "next/link";
import { requireOffering } from "@/lib/data/offering-access";
import { createClient } from "@/lib/supabase/server";
import { QUIZ_COLUMNS, type QuizRow } from "@/lib/assessment/quiz-data";
import { scoreText, timeLimitText, windowText } from "@/lib/assessment/quiz-text";
import { learnerQuizState, type AttemptStatus } from "@/lib/domain/quiz";
import { LearnerQuizStateBadge, ModeBadge, PublicationBadge, RoleNotice } from "@/components/assessment/badges";
import { DetailList, SectionHeading } from "@/components/assessment/detail-list";
import { PageBody } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("quiz.title") };

type GradeItem = { id: string; quiz_id: string; counts_toward_total: boolean };

function byDeadline(a: QuizRow, b: QuizRow) {
  const ac = a.closes_at ? new Date(a.closes_at).getTime() : Infinity;
  const bc = b.closes_at ? new Date(b.closes_at).getTime() : Infinity;
  return ac - bc || a.title.localeCompare(b.title);
}

export default async function QuizzesPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const access = await requireOffering(offeringId);
  return access.isStaffView ? <StaffList offeringId={offeringId} /> : <LearnerList offeringId={offeringId} />;
}

async function LearnerList({ offeringId }: { offeringId: string }) {
  const { user } = await requireOffering(offeringId);
  const tz = user.timezone;
  const supabase = await createClient();
  // Lazy expiry: overdue attempts are finalized by the server before anything is shown.
  await supabase.rpc("finalize_expired_attempts");
  const [quizRes, attemptRes, accRes, itemRes, releasedRes] = await Promise.all([
    supabase.from("quizzes").select(QUIZ_COLUMNS).eq("offering_id", offeringId).eq("status", "published"),
    supabase.from("quiz_attempts").select("quiz_id, attempt_no, status").eq("offering_id", offeringId).eq("user_id", user.id),
    supabase.from("quiz_accommodations").select("quiz_id, extra_minutes, extra_attempts, extended_closes_at").eq("user_id", user.id),
    supabase.from("grade_items").select("id, quiz_id, counts_toward_total").eq("offering_id", offeringId).eq("kind", "quiz"),
    supabase.from("released_grades").select("grade_item_id, status, points, max_points").eq("offering_id", offeringId).eq("user_id", user.id),
  ]);
  const quizzes = ((quizRes.data ?? []) as QuizRow[]).sort(byDeadline);
  const attempts = (attemptRes.data ?? []) as { quiz_id: string; attempt_no: number; status: AttemptStatus }[];
  const accById = new Map(((accRes.data ?? []) as { quiz_id: string; extra_minutes: number; extra_attempts: number; extended_closes_at: string | null }[]).map((a) => [a.quiz_id, a]));
  const itemByQuiz = new Map(((itemRes.data ?? []) as GradeItem[]).map((g) => [g.quiz_id, g]));
  const releasedByItem = new Map(
    ((releasedRes.data ?? []) as { grade_item_id: string; status: string; points: number | null; max_points: number }[]).map((r) => [r.grade_item_id, r]),
  );
  const now = new Date();

  return (
    <PageBody>
      <SectionHeading>{t("quiz.title")}</SectionHeading>
      <p className="mb-4 text-sm text-muted">{t("quiz.timesIn", { tz })}</p>
      {quizzes.length === 0 ? (
        <EmptyState title={t("quiz.list.empty")} />
      ) : (
        <ul className="space-y-4">
          {quizzes.map((q) => {
            const mine = attempts.filter((a) => a.quiz_id === q.id);
            const acc = accById.get(q.id);
            const item = itemByQuiz.get(q.id);
            const released = item ? releasedByItem.get(item.id) : undefined;
            const state = learnerQuizState(mine.map((a) => ({ status: a.status, attemptNo: a.attempt_no })), Boolean(released));
            const used = mine.filter((a) => a.status !== "voided").length;
            const allowed = q.attempt_limit + (acc?.extra_attempts ?? 0);
            const close = acc?.extended_closes_at ?? q.closes_at;
            const href = `/courses/${offeringId}/quizzes/${q.id}`;
            const result =
              released?.status === "graded"
                ? scoreText(released.points, released.max_points)
                : released?.status === "missing"
                  ? t("quiz.list.missing")
                  : released?.status === "exempt"
                    ? t("quiz.list.exempt")
                    : t("quiz.list.noResult");
            return (
              <li key={q.id}>
                <Panel className="px-4 py-4 sm:px-6">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <h3 className="min-w-0 break-words text-lg font-semibold">
                      <Link href={href} className="text-primary underline-offset-2 hover:underline">{q.title}</Link>
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      <ModeBadge practice={item ? !item.counts_toward_total : false} />
                      <LearnerQuizStateBadge state={state} />
                    </div>
                  </div>
                  <DetailList
                    className="lg:grid-cols-4"
                    items={[
                      { label: t("quiz.list.availability"), value: windowText(now, q.available_from, close, tz) },
                      { label: t("quiz.list.timeLimit"), value: timeLimitText(q.time_limit_minutes, acc?.extra_minutes ?? 0) },
                      { label: t("quiz.list.attempts"), value: t("quiz.attemptsUsed", { used, allowed }) },
                      { label: t("quiz.list.result"), value: result },
                    ]}
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    {state === "in_progress" ? (
                      <ButtonLink href={href} size="sm">{t("quiz.list.resume")}</ButtonLink>
                    ) : (
                      <ButtonLink href={href} size="sm" variant="secondary">
                        {t("quiz.list.open")}
                        <span className="sr-only"> ({q.title})</span>
                      </ButtonLink>
                    )}
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
  await supabase.rpc("finalize_expired_attempts", { p_offering: offeringId });
  const quizRes = await supabase.from("quizzes").select(QUIZ_COLUMNS).eq("offering_id", offeringId);
  const quizzes = ((quizRes.data ?? []) as QuizRow[]).sort(byDeadline);
  const ids = quizzes.map((q) => q.id);
  const [versionRes, attemptRes, itemRes] = await Promise.all([
    ids.length ? supabase.from("quiz_versions").select("id, quiz_id, version_no, status").in("quiz_id", ids) : Promise.resolve({ data: [] }),
    supabase.from("quiz_attempts").select("quiz_id, status").eq("offering_id", offeringId).in("status", ["in_progress", "submitted"]),
    supabase.from("grade_items").select("id, quiz_id, counts_toward_total").eq("offering_id", offeringId).eq("kind", "quiz"),
  ]);
  const versions = (versionRes.data ?? []) as { id: string; quiz_id: string; version_no: number; status: string }[];
  const open = (attemptRes.data ?? []) as { quiz_id: string; status: string }[];
  const itemByQuiz = new Map(((itemRes.data ?? []) as GradeItem[]).map((g) => [g.quiz_id, g]));
  const now = new Date();

  return (
    <PageBody>
      <SectionHeading
        actions={
          <>
            <RoleNotice>{t("quiz.staffBadge")}</RoleNotice>
            {access.canAuthor ? <ButtonLink href={`/courses/${offeringId}/quizzes/new`} size="sm">{t("quiz.list.new")}</ButtonLink> : null}
          </>
        }
      >
        {t("quiz.title")}
      </SectionHeading>
      <p className="mb-4 text-sm text-muted">{t("quiz.timesIn", { tz })}</p>
      {quizzes.length === 0 ? (
        <EmptyState title={t("quiz.list.emptyStaff")} />
      ) : (
        <ul className="space-y-4">
          {quizzes.map((q) => {
            const live = versions.find((v) => v.id === q.current_version_id);
            const draft = versions.find((v) => v.quiz_id === q.id && v.status === "draft");
            const pending = open.filter((a) => a.quiz_id === q.id && a.status === "submitted").length;
            const inProgress = open.filter((a) => a.quiz_id === q.id && a.status === "in_progress").length;
            const item = itemByQuiz.get(q.id);
            const base = `/courses/${offeringId}/quizzes/${q.id}`;
            return (
              <li key={q.id}>
                <Panel className="px-4 py-4 sm:px-6">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <h3 className="min-w-0 break-words text-lg font-semibold">
                      <Link href={base} className="text-primary underline-offset-2 hover:underline">{q.title}</Link>
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      <ModeBadge practice={item ? !item.counts_toward_total : false} />
                      <PublicationBadge status={q.status} />
                      {live ? <Badge>{t("quiz.list.version", { version: live.version_no })}</Badge> : null}
                      {draft && live ? <Badge tone="warning">{t("quiz.list.draftChanges")}</Badge> : null}
                    </div>
                  </div>
                  <DetailList
                    className="lg:grid-cols-4"
                    items={[
                      { label: t("quiz.list.availability"), value: q.status === "published" ? windowText(now, q.available_from, q.closes_at, tz) : t("quiz.list.notPublished") },
                      { label: t("quiz.list.timeLimit"), value: timeLimitText(q.time_limit_minutes) },
                      { label: t("quiz.list.attempts"), value: q.attempt_limit === 1 ? t("quiz.list.attemptLimitOne") : t("quiz.list.attemptLimit", { count: q.attempt_limit }) },
                      {
                        label: t("quiz.list.status"),
                        value: (
                          <span className="flex flex-wrap gap-x-3">
                            <span>{t("quiz.list.pendingManual", { count: pending })}</span>
                            <span>{t("quiz.list.inProgressCount", { count: inProgress })}</span>
                          </span>
                        ),
                      },
                    ]}
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    {access.canAuthor ? (
                      <>
                        <ButtonLink href={`${base}/edit`} size="sm" variant="secondary">
                          {t("quiz.list.edit")}<span className="sr-only"> ({q.title})</span>
                        </ButtonLink>
                        <ButtonLink href={`${base}/preview`} size="sm" variant="secondary">
                          {t("quiz.list.preview")}<span className="sr-only"> ({q.title})</span>
                        </ButtonLink>
                      </>
                    ) : null}
                    {access.canGrade ? (
                      <ButtonLink href={`${base}/grade`} size="sm" variant={pending > 0 ? "primary" : "secondary"}>
                        {t("quiz.list.grade")}<span className="sr-only"> ({q.title})</span>
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

