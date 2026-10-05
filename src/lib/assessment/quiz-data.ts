import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/forms";
import type { AttemptStatus, QuestionType, QuizResponse, ReviewPolicy, ScoreRelease, ScoringRule } from "@/lib/domain/quiz";

// Typed views of the quiz RPC payloads and table rows used by the assessment pages.
// Every read runs as the signed-in user, so RLS and the RPC checks decide what comes back.

export type QuizRow = {
  id: string;
  offering_id: string;
  title: string;
  status: "draft" | "published" | "archived";
  current_version_id: string | null;
  available_from: string | null;
  closes_at: string | null;
  time_limit_minutes: number | null;
  attempt_limit: number;
  pass_pct: number;
  shuffle_questions: boolean;
  shuffle_choices: boolean;
  review_policy: ReviewPolicy;
  answers_released_at: string | null;
  score_release: ScoreRelease;
  scoring_rule: ScoringRule;
  truncate_at_close: boolean;
  created_at: string;
};

export const QUIZ_COLUMNS =
  "id, offering_id, title, status, current_version_id, available_from, closes_at, time_limit_minutes, attempt_limit, pass_pct, shuffle_questions, shuffle_choices, review_policy, answers_released_at, score_release, scoring_rule, truncate_at_close, created_at";

/** A quiz in this offering that the current user may see (learners: published only), else null. */
export const getQuiz = cache(async (offeringId: string, quizId: string): Promise<QuizRow | null> => {
  if (!isUuid(quizId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("quizzes").select(QUIZ_COLUMNS).eq("id", quizId).eq("offering_id", offeringId).maybeSingle();
  return (data as QuizRow | null) ?? null;
});

export type QuizOverview = {
  quiz_id: string;
  title: string;
  status: string;
  instructions: string | null;
  question_count: number;
  available_from: string | null;
  closes_at: string | null;
  effective_closes_at: string | null;
  time_limit_minutes: number | null;
  extra_minutes: number;
  truncate_at_close: boolean;
  attempts_used: number;
  attempts_allowed: number;
  pass_pct: number;
  review_policy: ReviewPolicy;
  scoring_rule: ScoringRule;
  in_progress_attempt_id: string | null;
  in_progress_deadline: string | null;
  deadline_if_started_now: string | null;
  cannot_start_reason: "not_learner" | "not_published" | "not_open" | "closed" | "no_attempts_left" | null;
  server_now: string;
  released_pct: number | null;
};

export type LearnerAttemptSummary = {
  id: string;
  attempt_no: number;
  status: AttemptStatus;
  started_at: string;
  deadline_at: string | null;
  submitted_at: string | null;
  finalized_reason: "submitted" | "expired" | null;
  version_no: number;
  pending_manual: number;
  review_available: boolean;
  score_visible: boolean;
  score: number | null;
  max_score: number | null;
};

export type QuizLearnerDetails = {
  quiz_id: string;
  version_no: number | null;
  question_count: number;
  total_points: number;
  counts_toward_total: boolean;
  grade_max_points: number | null;
  score_release: ScoreRelease;
  answers_released_at: string | null;
  released: { status: "graded" | "missing" | "exempt"; points: number | null; max_points: number; released_at: string } | null;
  attempts: LearnerAttemptSummary[];
};

export async function getQuizOverview(quizId: string): Promise<{ overview: QuizOverview; details: QuizLearnerDetails } | null> {
  const supabase = await createClient();
  // Details first: it finalizes an overdue attempt so the overview reflects it.
  const details = await supabase.rpc("quiz_learner_details", { p_quiz: quizId });
  if (details.error || !details.data) return null;
  const overview = await supabase.rpc("quiz_overview", { p_quiz: quizId });
  if (overview.error || !overview.data) return null;
  return { overview: overview.data as QuizOverview, details: details.data as QuizLearnerDetails };
}

export type AttemptQuestion = {
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  choices: { id: string; text: string }[];
  response: QuizResponse;
  saved_at: string | null;
};

export type AttemptView = {
  id: string;
  quiz_id: string;
  offering_id: string;
  attempt_no: number;
  status: AttemptStatus;
  started_at: string;
  deadline_at: string | null;
  submitted_at: string | null;
  finalized_reason: "submitted" | "expired" | null;
  server_now: string;
  quiz_title: string;
  instructions: string | null;
  questions: AttemptQuestion[];
};

/** The learner's own attempt (the database refuses anyone else's). Only learner-safe fields are kept. */
export async function getAttempt(attemptId: string): Promise<AttemptView | null> {
  if (!isUuid(attemptId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_attempt", { p_attempt: attemptId });
  if (error || !data) return null;
  const raw = data as AttemptView;
  return {
    ...raw,
    questions: (raw.questions ?? []).map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      points: Number(q.points),
      choices: (q.choices ?? []).map((c) => ({ id: String(c.id), text: String(c.text) })),
      response: (q.response ?? null) as QuizResponse,
      saved_at: q.saved_at ?? null,
    })),
  };
}

export type ReviewQuestion = {
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  choices: { id: string; text: string }[];
  response: QuizResponse;
  correct: string[] | null;
  explanation: string | null;
  earned: number | null;
  needs_manual: boolean | null;
  feedback: string | null;
};

export type AttemptReview = {
  id: string;
  quiz_id: string;
  attempt_no: number;
  status: AttemptStatus;
  submitted_at: string | null;
  finalized_reason: "submitted" | "expired" | null;
  review_available: boolean;
  scores_visible: boolean;
  questions: ReviewQuestion[];
};

export async function getAttemptReview(attemptId: string): Promise<AttemptReview | null> {
  if (!isUuid(attemptId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_attempt_review", { p_attempt: attemptId });
  if (error || !data) return null;
  return data as AttemptReview;
}

export type StaffAttemptRow = {
  attempt_id: string;
  user_id: string;
  display_name: string;
  attempt_no: number;
  status: AttemptStatus;
  started_at: string;
  submitted_at: string | null;
  finalized_reason: string | null;
  score: number | null;
  max_score: number | null;
  pending_manual: number;
};

export type QuizVersionRow = {
  id: string;
  quiz_id: string;
  version_no: number;
  status: "draft" | "published" | "retired";
  instructions: string;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
};

export type AuthoringQuestion = {
  id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  points: number;
  choices: { id: string; text: string }[];
  correct: string[];
  explanation: string;
};
