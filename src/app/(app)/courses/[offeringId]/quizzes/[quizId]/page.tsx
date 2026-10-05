import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOffering } from "@/lib/data/offering-access";
import { getQuiz, getQuizOverview, type LearnerAttemptSummary, type QuizLearnerDetails, type QuizOverview, type QuizRow } from "@/lib/assessment/quiz-data";
import { questionCountText, reviewExplanationText, scoreText, timeLimitText } from "@/lib/assessment/quiz-text";
import { hasPassed, percentOf, reviewExplanation } from "@/lib/domain/quiz";
import { formatPoints } from "@/lib/domain/grades";
import { formatDateTime } from "@/lib/time";
import { AttemptStatusBadge, ModeBadge, PublicationBadge } from "@/components/assessment/badges";
import { DetailList, SectionHeading } from "@/components/assessment/detail-list";
import { StartAttempt } from "@/components/assessment/start-attempt";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { RichText } from "@/components/ui/rich-text";
import { Table, td, th } from "@/components/ui/table";
import { t } from "@/i18n";

type Params = { offeringId: string; quizId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { offeringId, quizId } = await params;
  const quiz = await getQuiz(offeringId, quizId);
  return { title: quiz?.title ?? t("quiz.title") };
}

export default async function QuizOverviewPage({ params }: { params: Promise<Params> }) {
  const { offeringId, quizId } = await params;
  const access = await requireOffering(offeringId);
  const quiz = await getQuiz(offeringId, quizId);
  if (!quiz) notFound();
  const data = await getQuizOverview(quiz.id);
  if (!data) notFound();
  const { overview, details } = data;
  const tz = access.user.timezone;
  const base = `/courses/${offeringId}/quizzes/${quiz.id}`;

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
                <ModeBadge practice={!details.counts_toward_total} />
                {access.isStaffView ? <PublicationBadge status={quiz.status} /> : null}
              </>
            }
          >
            {quiz.title}
          </SectionHeading>
        </div>
        <p className="-mt-2 text-sm text-muted">{t("quiz.timesIn", { tz })}</p>
      </div>

      {access.isStaffView ? (
        <Alert tone="info" title={t("quiz.staffBadge")}>
          <p>{t("quiz.overview.staffNote")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {access.canAuthor ? (
              <>
                <ButtonLink href={`${base}/edit`} size="sm" variant="secondary">{t("quiz.list.edit")}</ButtonLink>
                <ButtonLink href={`${base}/preview`} size="sm" variant="secondary">{t("quiz.list.preview")}</ButtonLink>
              </>
            ) : null}
            {access.canGrade ? <ButtonLink href={`${base}/grade`} size="sm" variant="secondary">{t("quiz.list.grade")}</ButtonLink> : null}
          </div>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="min-w-0 space-y-6">
          {!access.isStaffView ? <TakePanel quiz={quiz} overview={overview} details={details} access={access} tz={tz} base={base} /> : null}
          <Panel>
            <PanelHeader title={t("quiz.overview.instructions")} level={3} />
            <div className="px-4 py-4 sm:px-6">
              {overview.instructions ? <RichText html={overview.instructions} /> : <p className="text-muted">{t("quiz.overview.noInstructions")}</p>}
            </div>
          </Panel>
          {!access.isStaffView ? <AttemptsPanel overview={overview} details={details} quiz={quiz} tz={tz} base={base} /> : null}
        </div>
        <div className="min-w-0 space-y-6">
          <DetailsPanel quiz={quiz} overview={overview} details={details} tz={tz} learner={!access.isStaffView} />
          {!access.isStaffView ? <ResultPanel quiz={quiz} details={details} tz={tz} /> : null}
        </div>
      </div>
    </PageBody>
  );
}

function DetailsPanel({ quiz, overview, details, tz, learner }: { quiz: QuizRow; overview: QuizOverview; details: QuizLearnerDetails; tz: string; learner: boolean }) {
  const extraAttempts = Math.max(0, overview.attempts_allowed - quiz.attempt_limit);
  const extendedClose = overview.effective_closes_at && overview.effective_closes_at !== overview.closes_at ? overview.effective_closes_at : null;
  const items = [
    { label: t("quiz.overview.questions"), value: questionCountText(details.question_count) },
    { label: t("quiz.overview.totalPoints"), value: formatPoints(details.total_points) },
    { label: t("quiz.overview.passMark"), value: `${formatPoints(quiz.pass_pct)}%` },
    {
      label: t("quiz.overview.attempts"),
      value: learner ? t("quiz.attemptsUsed", { used: overview.attempts_used, allowed: overview.attempts_allowed }) : quiz.attempt_limit === 1 ? t("quiz.list.attemptLimitOne") : t("quiz.list.attemptLimit", { count: quiz.attempt_limit }),
    },
    { label: t("quiz.overview.timeLimit"), value: timeLimitText(quiz.time_limit_minutes, learner ? overview.extra_minutes : 0) },
    { label: t("quiz.overview.opens"), value: quiz.available_from ? formatDateTime(quiz.available_from, tz) : t("quiz.overview.opensNow") },
    { label: t("quiz.overview.closes"), value: quiz.closes_at ? formatDateTime(quiz.closes_at, tz) : t("quiz.overview.noClose") },
  ];
  if (learner && extendedClose) items.push({ label: t("quiz.overview.yourClose"), value: formatDateTime(extendedClose, tz) });
  return (
    <Panel>
      <PanelHeader title={t("quiz.overview.details")} level={3} />
      <div className="space-y-4 px-4 py-4 sm:px-6">
        <DetailList className="sm:grid-cols-2 xl:grid-cols-1" items={items} />
        <div className="space-y-2 border-t border-line pt-3 text-sm">
          <p>
            <span className="font-semibold">{t("quiz.overview.scoring")}: </span>
            {quiz.scoring_rule === "latest" ? t("quiz.overview.scoring.latest") : t("quiz.overview.scoring.highest")}
          </p>
          <p>{details.score_release === "immediate" ? t("quiz.overview.release.immediate") : t("quiz.overview.release.manual")}</p>
          <p>{t("quiz.overview.mcScoring")}</p>
          {!details.counts_toward_total ? <p>{t("quiz.practiceHint")}</p> : null}
        </div>
        {learner && (overview.extra_minutes > 0 || extraAttempts > 0 || extendedClose) ? (
          <div className="border-t border-line pt-3">
            <h4 className="text-sm font-semibold">{t("quiz.overview.accommodation")}</h4>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {overview.extra_minutes > 0 ? <li>{t("quiz.overview.accExtraTime", { minutes: overview.extra_minutes })}</li> : null}
              {extraAttempts > 0 ? <li>{t("quiz.overview.accExtraAttempts", { count: extraAttempts })}</li> : null}
              {extendedClose ? <li>{t("quiz.overview.accExtendedClose", { date: formatDateTime(extendedClose, tz) })}</li> : null}
            </ul>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function TakePanel({
  quiz,
  overview,
  details,
  access,
  tz,
  base,
}: {
  quiz: QuizRow;
  overview: QuizOverview;
  details: QuizLearnerDetails;
  access: Awaited<ReturnType<typeof requireOffering>>;
  tz: string;
  base: string;
}) {
  const inProgress = details.attempts.find((a) => a.status === "in_progress");
  let body: React.ReactNode;
  if (inProgress) {
    body = (
      <div className="space-y-3">
        <p className="text-[1.05rem] font-semibold">
          {inProgress.deadline_at
            ? t("quiz.overview.resumeBody", { number: inProgress.attempt_no, deadline: formatDateTime(inProgress.deadline_at, tz) })
            : t("quiz.overview.resumeNoDeadline", { number: inProgress.attempt_no })}
        </p>
        <p className="text-sm text-muted">{t("quiz.overview.serverTimer")}</p>
        <ButtonLink href={`${base}/attempts/${inProgress.id}`}>{t("quiz.overview.resume", { number: inProgress.attempt_no })}</ButtonLink>
      </div>
    );
  } else if (overview.cannot_start_reason) {
    const reason = access.readOnly ? t("quiz.overview.cannot.readOnly") : cannotStartText(overview, tz);
    body = <Alert tone="info">{reason}</Alert>;
  } else {
    body = (
      <StartAttempt
        quizId={quiz.id}
        attemptNumber={details.attempts.length + 1}
        timeLimitMinutes={quiz.time_limit_minutes}
        extraMinutes={overview.extra_minutes}
        effectiveClosesAt={overview.effective_closes_at}
        truncateAtClose={quiz.truncate_at_close}
        serverNow={overview.server_now}
        tz={tz}
      />
    );
  }
  return (
    <Panel>
      <PanelHeader title={inProgress ? t("quiz.overview.resumeHeading") : t("quiz.overview.startHeading")} level={3} />
      <div className="px-4 py-4 sm:px-6">{body}</div>
    </Panel>
  );
}

function cannotStartText(o: QuizOverview, tz: string): string {
  switch (o.cannot_start_reason) {
    case "not_open":
      return t("quiz.overview.cannot.notOpen", { date: formatDateTime(o.available_from, tz) });
    case "closed":
      return t("quiz.overview.cannot.closed", { date: formatDateTime(o.effective_closes_at, tz) });
    case "no_attempts_left":
      return t("quiz.overview.cannot.noAttemptsLeft", { allowed: o.attempts_allowed });
    case "not_published":
      return t("quiz.overview.cannot.notPublished");
    default:
      return t("quiz.overview.cannot.notLearner");
  }
}

function AttemptsPanel({ overview, details, quiz, tz, base }: { overview: QuizOverview; details: QuizLearnerDetails; quiz: QuizRow; tz: string; base: string }) {
  const anyReview = details.attempts.some((a) => a.review_available);
  const explanation = reviewExplanation(quiz.review_policy, {
    available: anyReview,
    effectiveClosesAt: overview.effective_closes_at,
    answersReleasedAt: details.answers_released_at,
  });
  return (
    <section aria-labelledby="your-attempts" className="space-y-3">
      <h3 id="your-attempts" className="text-lg font-semibold">{t("quiz.overview.yourAttempts")}</h3>
      {details.attempts.length === 0 ? (
        <p className="text-muted">{t("quiz.overview.noAttempts")}</p>
      ) : (
        <Table caption={t("quiz.overview.yourAttempts")} captionHidden>
          <thead>
            <tr>
              <th scope="col" className={th}>{t("quiz.overview.col.attempt")}</th>
              <th scope="col" className={th}>{t("quiz.overview.col.started")}</th>
              <th scope="col" className={th}>{t("quiz.overview.col.submitted")}</th>
              <th scope="col" className={th}>{t("quiz.overview.col.result")}</th>
              <th scope="col" className={th}>{t("quiz.overview.col.review")}</th>
            </tr>
          </thead>
          <tbody>
            {details.attempts.map((a) => (
              <tr key={a.id}>
                <th scope="row" className={`${td} font-medium`}>
                  <span className="block">{t("quiz.overview.attemptNumber", { number: a.attempt_no })}</span>
                  <span className="block text-xs font-normal text-muted">{t("quiz.list.version", { version: a.version_no })}</span>
                </th>
                <td className={td}>{formatDateTime(a.started_at, tz)}</td>
                <td className={td}>
                  {a.submitted_at ? (
                    <>
                      <span className="block">{formatDateTime(a.submitted_at, tz)}</span>
                      {a.finalized_reason === "expired" ? <span className="block text-xs text-muted">{t("quiz.reason.expired")}</span> : null}
                    </>
                  ) : (
                    <span className="text-muted">–</span>
                  )}
                </td>
                <td className={td}>
                  <AttemptResult attempt={a} />
                </td>
                <td className={td}>
                  {a.review_available ? (
                    <Link href={`${base}/attempts/${a.id}/review`} className="text-primary underline underline-offset-2">
                      {t("quiz.overview.reviewLink", { number: a.attempt_no })}
                    </Link>
                  ) : a.status === "in_progress" ? (
                    <Link href={`${base}/attempts/${a.id}`} className="text-primary underline underline-offset-2">
                      {t("quiz.overview.resume", { number: a.attempt_no })}
                    </Link>
                  ) : (
                    <span className="text-muted">{t("quiz.overview.reviewUnavailable")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="text-sm">
        <span className="font-semibold">{t("quiz.overview.review")}: </span>
        {reviewExplanationText(explanation, tz)}
      </p>
    </section>
  );
}

function AttemptResult({ attempt: a }: { attempt: LearnerAttemptSummary }) {
  if (a.status === "in_progress") return <AttemptStatusBadge status="in_progress" />;
  if (a.status === "voided") return <AttemptStatusBadge status="voided" />;
  if (a.status === "submitted") return <Badge tone="warning">{t("quiz.overview.pendingManual", { count: a.pending_manual })}</Badge>;
  if (a.score_visible && a.score !== null && a.max_score !== null) return <span>{scoreText(a.score, a.max_score)}</span>;
  return <span className="text-muted">{t("quiz.overview.scoreHidden")}</span>;
}

function ResultPanel({ quiz, details, tz }: { quiz: QuizRow; details: QuizLearnerDetails; tz: string }) {
  const r = details.released;
  let body: React.ReactNode;
  if (!r) {
    body = <p className="text-muted">{t("quiz.overview.noResult")}</p>;
  } else if (r.status === "missing") {
    body = <p>{t("quiz.overview.resultMissing")}</p>;
  } else if (r.status === "exempt") {
    body = <p>{t("quiz.overview.resultExempt")}</p>;
  } else {
    const pct = percentOf(r.points, r.max_points);
    const passed = hasPassed(pct, quiz.pass_pct);
    body = (
      <div className="space-y-2">
        <p className="text-xl font-semibold">{t("quiz.overview.resultLine", { points: formatPoints(r.points), max: formatPoints(r.max_points), pct: pct ?? "0.00" })}</p>
        {passed !== null ? <Badge tone={passed ? "success" : "warning"}>{passed ? t("quiz.passed") : t("quiz.notPassed")}</Badge> : null}
        <p className="text-sm text-muted">{quiz.scoring_rule === "latest" ? t("quiz.overview.resultBasis.latest") : t("quiz.overview.resultBasis.highest")}</p>
      </div>
    );
  }
  return (
    <Panel>
      <PanelHeader title={t("quiz.overview.yourResult")} level={3} />
      <div className="px-4 py-4 sm:px-6">
        {body}
        {r ? <p className="mt-2 text-xs text-muted">{t("quiz.overview.releasedAt", { date: formatDateTime(r.released_at, tz) })}</p> : null}
      </div>
    </Panel>
  );
}
