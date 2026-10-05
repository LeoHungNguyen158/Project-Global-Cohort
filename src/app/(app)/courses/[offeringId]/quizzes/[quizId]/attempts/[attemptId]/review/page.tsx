import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, CircleDot, XCircle } from "lucide-react";
import { requireOffering } from "@/lib/data/offering-access";
import { createClient } from "@/lib/supabase/server";
import { getAttemptReview, getQuiz, type ReviewQuestion } from "@/lib/assessment/quiz-data";
import { pointsLabel, reviewExplanationText } from "@/lib/assessment/quiz-text";
import { percentOf, reviewExplanation } from "@/lib/domain/quiz";
import { formatPoints } from "@/lib/domain/grades";
import { formatDateTime } from "@/lib/time";
import { SectionHeading } from "@/components/assessment/detail-list";
import { PageBody } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { t } from "@/i18n";

type Params = { offeringId: string; quizId: string; attemptId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { offeringId, quizId } = await params;
  const quiz = await getQuiz(offeringId, quizId);
  return { title: quiz ? t("quiz.review.metaTitle", { title: quiz.title }) : t("quiz.title") };
}

/**
 * Answer review for one attempt, served by get_attempt_review: correct answers and
 * explanations only when the quiz's review policy allows it, per-question points only
 * once the attempt's result is released. Otherwise it explains when review opens.
 */
export default async function AttemptReviewPage({ params }: { params: Promise<Params> }) {
  const { offeringId, quizId, attemptId } = await params;
  const access = await requireOffering(offeringId);
  const quiz = await getQuiz(offeringId, quizId);
  if (!quiz) notFound();
  const review = await getAttemptReview(attemptId);
  if (!review || review.quiz_id !== quiz.id) notFound();
  const tz = access.user.timezone;
  const base = `/courses/${offeringId}/quizzes/${quiz.id}`;

  const header = (
    <div>
      <Link href={base} className="text-sm text-primary underline-offset-2 hover:underline">
        ← {t("quiz.backToQuiz")}
      </Link>
      <div className="mt-2">
        <SectionHeading>{t("quiz.review.title", { title: quiz.title, number: review.attempt_no })}</SectionHeading>
      </div>
      {review.submitted_at ? (
        <p className="-mt-2 text-sm text-muted">
          {t("quiz.review.submittedLine", { time: formatDateTime(review.submitted_at, tz) })}
          {review.finalized_reason === "expired" ? ` · ${t("quiz.reason.expired")}` : ""}
        </p>
      ) : null}
    </div>
  );

  if (review.status === "in_progress") {
    return (
      <PageBody className="space-y-6">
        {header}
        <Alert tone="info" title={t("quiz.review.notSubmitted")} />
        <ButtonLink href={`${base}/attempts/${review.id}`}>{t("quiz.overview.resume", { number: review.attempt_no })}</ButtonLink>
      </PageBody>
    );
  }

  if (!review.review_available) {
    // Explain when review opens, using this learner's own (possibly extended) closing time.
    const supabase = await createClient();
    const { data: acc } = await supabase.from("quiz_accommodations").select("extended_closes_at").eq("quiz_id", quiz.id).eq("user_id", access.user.id).maybeSingle();
    const explanation = reviewExplanation(quiz.review_policy, {
      available: false,
      effectiveClosesAt: (acc?.extended_closes_at as string | null | undefined) ?? quiz.closes_at,
      answersReleasedAt: quiz.answers_released_at,
    });
    return (
      <PageBody className="space-y-6">
        {header}
        <Alert tone="info" title={t("quiz.review.notAvailable")}>
          <p>{reviewExplanationText(explanation, tz)}</p>
        </Alert>
        <ButtonLink href={base} variant="secondary">{t("quiz.backToQuiz")}</ButtonLink>
      </PageBody>
    );
  }

  const total = review.scores_visible
    ? review.questions.reduce((acc, q) => ({ earned: acc.earned + Number(q.earned ?? 0), max: acc.max + Number(q.points) }), { earned: 0, max: 0 })
    : null;
  const anyPending = review.questions.some((q) => q.needs_manual);

  return (
    <PageBody className="space-y-6">
      {header}
      {review.status === "voided" ? <Alert tone="warning">{t("quiz.attempt.voidedBody")}</Alert> : null}
      {total && !anyPending ? <p className="text-lg font-semibold">{t("quiz.review.total", { score: formatPoints(total.earned), max: formatPoints(total.max), pct: percentOf(total.earned, total.max) ?? "0.00" })}</p> : null}
      {!review.scores_visible ? <Alert tone="info">{t("quiz.review.scoresHidden")}</Alert> : null}
      <ol className="space-y-4">
        {review.questions.map((q, i) => (
          <li key={q.id}>
            <ReviewCard q={q} index={i} total={review.questions.length} scoresVisible={review.scores_visible} />
          </li>
        ))}
      </ol>
      <ButtonLink href={base} variant="secondary">{t("quiz.backToQuiz")}</ButtonLink>
    </PageBody>
  );
}

function ReviewCard({ q, index, total, scoresVisible }: { q: ReviewQuestion; index: number; total: number; scoresVisible: boolean }) {
  const correct = new Set(q.correct ?? []);
  const response = q.response;
  const chosen = new Set<string>(
    response && "choices" in response ? response.choices : response && "choice" in response ? [response.choice] : [],
  );
  const headingId = `rq-${q.id}`;
  return (
    <section aria-labelledby={headingId} className="rounded-[var(--radius-panel)] border border-line bg-panel px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={headingId} className="text-base font-semibold">{t("quiz.attempt.questionOf", { number: index + 1, total })}</h3>
        <span className="text-sm">
          {q.needs_manual ? (
            <Badge tone="warning">{t("quiz.review.awaitingManual")}</Badge>
          ) : scoresVisible && q.earned !== null ? (
            <span className="font-semibold">{t("quiz.review.earned", { earned: formatPoints(q.earned), points: formatPoints(q.points) })}</span>
          ) : (
            <span className="text-muted">{pointsLabel(q.points)}</span>
          )}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words">{q.prompt}</p>

      {q.type === "short_answer" ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("quiz.review.yourAnswer")}</p>
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
            const label = q.type === "true_false" ? (c.id === "true" ? t("quiz.author.true") : c.id === "false" ? t("quiz.author.false") : c.text) : c.text;
            return (
              <li
                key={c.id}
                className={cn(
                  "flex flex-wrap items-start gap-2 rounded-md border px-3 py-2",
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
                  {picked ? <Badge tone="info">{t("quiz.review.yourChoice")}</Badge> : null}
                  {isCorrect ? <Badge tone="success">{t("quiz.review.correctAnswer")}</Badge> : null}
                </span>
              </li>
            );
          })}
          {chosen.size === 0 ? <li className="text-sm text-muted">{t("quiz.review.noAnswer")}</li> : null}
        </ul>
      )}

      {q.explanation ? (
        <div className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 text-sm">
          <p className="font-semibold">{q.type === "short_answer" ? t("quiz.review.modelAnswer") : t("quiz.review.explanation")}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{q.explanation}</p>
        </div>
      ) : null}
      {scoresVisible && q.feedback ? (
        <div className="mt-3 rounded-md border border-[#c7d6fb] bg-primary-soft px-3 py-2 text-sm">
          <p className="font-semibold">{t("quiz.review.feedback")}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{q.feedback}</p>
        </div>
      ) : null}
    </section>
  );
}
