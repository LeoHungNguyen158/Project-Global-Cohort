"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { bool, dateTime, isUuid, num, str, uuid } from "@/lib/forms";
import { markdownToSafeHtml } from "@/lib/markdown";
import { normalizeResponse, QUESTION_TYPES, type QuestionType, type QuizResponse } from "@/lib/domain/quiz";
import { shortId } from "@/lib/assessment/rubric";
import { t } from "@/i18n";

// Every action re-validates its input and relies on the database (RLS and the RPC
// functions) for authorization; ids from the form only say which record to act on.

type Supabase = Awaited<ReturnType<typeof createClient>>;

function quizBase(offeringId: string, quizId?: string) {
  return quizId ? `/courses/${offeringId}/quizzes/${quizId}` : `/courses/${offeringId}/quizzes`;
}

function revalidateQuiz(offeringId: string, quizId: string) {
  revalidatePath(quizBase(offeringId));
  revalidatePath(quizBase(offeringId, quizId), "layout");
}

async function loadQuiz(supabase: Supabase, quizId: string) {
  const { data } = await supabase.from("quizzes").select("id, offering_id, title, status, closes_at").eq("id", quizId).maybeSingle();
  return data as { id: string; offering_id: string; title: string; status: string; closes_at: string | null } | null;
}

async function quizForVersion(supabase: Supabase, versionId: string) {
  const { data } = await supabase
    .from("quiz_versions")
    .select("id, quiz_id, status, version_no, quizzes!quiz_versions_quiz_id_fkey(offering_id)")
    .eq("id", versionId)
    .maybeSingle();
  if (!data) return null;
  const quizzes = data.quizzes as unknown as { offering_id: string } | null;
  return { id: data.id as string, quizId: data.quiz_id as string, status: data.status as string, versionNo: data.version_no as number, offeringId: quizzes?.offering_id ?? "" };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const REVIEW = ["never", "after_submit", "after_close", "manual"] as const;
const RELEASE = ["immediate", "manual"] as const;
const SCORING = ["highest", "latest"] as const;

type Settings = {
  title: string;
  practice: boolean;
  gradePoints: number;
  pass_pct: number;
  available_from: string | null;
  closes_at: string | null;
  time_limit_minutes: number | null;
  attempt_limit: number;
  truncate_at_close: boolean;
  shuffle_questions: boolean;
  shuffle_choices: boolean;
  review_policy: (typeof REVIEW)[number];
  score_release: (typeof RELEASE)[number];
  scoring_rule: (typeof SCORING)[number];
};

function readSettings(fd: FormData): { ok: true; value: Settings } | { ok: false; error: string; field: string } {
  const title = str(fd, "title", 400);
  if (!title || title.length > 300) return { ok: false, error: t("quiz.err.title"), field: "title" };
  const gradePoints = num(fd, "grade_points");
  if (gradePoints === null || gradePoints < 0.01 || gradePoints > 10000) return { ok: false, error: t("quiz.err.gradePoints"), field: "grade_points" };
  const passPct = num(fd, "pass_pct");
  if (passPct === null || passPct < 0 || passPct > 100) return { ok: false, error: t("quiz.err.passPct"), field: "pass_pct" };
  const opens = dateTime(fd, "available_from");
  const closes = dateTime(fd, "closes_at");
  if (opens === "invalid" || closes === "invalid" || (opens && closes && new Date(closes) <= new Date(opens))) {
    return { ok: false, error: t("quiz.err.dates"), field: "closes_at" };
  }
  const limitRaw = str(fd, "time_limit_minutes", 16);
  let timeLimit: number | null = null;
  if (limitRaw) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1 || n > 1440) return { ok: false, error: t("quiz.err.timeLimit"), field: "time_limit_minutes" };
    timeLimit = n;
  }
  const attempts = Number(str(fd, "attempt_limit", 8));
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 100) return { ok: false, error: t("quiz.err.attemptLimit"), field: "attempt_limit" };
  const review = str(fd, "review_policy", 20) as Settings["review_policy"];
  const release = str(fd, "score_release", 20) as Settings["score_release"];
  const scoring = str(fd, "scoring_rule", 20) as Settings["scoring_rule"];
  return {
    ok: true,
    value: {
      title,
      practice: str(fd, "mode", 20) === "practice",
      gradePoints: Math.round(gradePoints * 100) / 100,
      pass_pct: Math.round(passPct * 100) / 100,
      available_from: opens,
      closes_at: closes,
      time_limit_minutes: timeLimit,
      attempt_limit: attempts,
      truncate_at_close: bool(fd, "truncate_at_close"),
      shuffle_questions: bool(fd, "shuffle_questions"),
      shuffle_choices: bool(fd, "shuffle_choices"),
      review_policy: REVIEW.includes(review) ? review : "after_close",
      score_release: RELEASE.includes(release) ? release : "manual",
      scoring_rule: SCORING.includes(scoring) ? scoring : "highest",
    },
  };
}

function settingsColumns(s: Settings) {
  return {
    title: s.title,
    pass_pct: s.pass_pct,
    available_from: s.available_from,
    closes_at: s.closes_at,
    time_limit_minutes: s.time_limit_minutes,
    attempt_limit: s.attempt_limit,
    truncate_at_close: s.truncate_at_close,
    shuffle_questions: s.shuffle_questions,
    shuffle_choices: s.shuffle_choices,
    review_policy: s.review_policy,
    score_release: s.score_release,
  };
}

export async function createQuiz(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const offeringId = uuid(fd, "offering_id");
  if (!offeringId) return { ok: false, error: t("quiz.err.unknown") };
  const parsed = readSettings(fd);
  if (!parsed.ok) return { ok: false, error: parsed.error, fieldErrors: { [parsed.field]: parsed.error } };
  const s = parsed.value;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: t("quiz.err.signedOut") };
  const { data: quiz, error } = await supabase
    .from("quizzes")
    .insert({ offering_id: offeringId, ...settingsColumns(s), scoring_rule: s.scoring_rule, created_by: auth.user.id })
    .select("id")
    .single();
  if (error || !quiz) return { ok: false, error: friendlyError(error, t("quiz.err.saveFailed")) };
  const quizId = quiz.id as string;
  const { data: version } = await supabase.from("quiz_versions").select("id").eq("quiz_id", quizId).eq("status", "draft").maybeSingle();
  const instructions = markdownToSafeHtml(str(fd, "instructions", 20_000));
  if (version && instructions) {
    const { error: e2 } = await supabase.rpc("update_quiz_instructions", { p_version: version.id, p_instructions: instructions });
    if (e2) return { ok: false, error: friendlyError(e2, t("quiz.err.saveFailed")) };
  }
  if (s.practice || s.gradePoints !== 100) {
    const { error: e3 } = await supabase.rpc("set_quiz_grade_settings", { p_quiz: quizId, p_max_points: s.gradePoints, p_counts_toward_total: !s.practice });
    if (e3) return { ok: false, error: friendlyError(e3, t("quiz.err.saveFailed")) };
  }
  revalidatePath(quizBase(offeringId));
  redirect(`${quizBase(offeringId, quizId)}/edit?created=1`);
}

export async function updateQuizSettings(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const quizId = uuid(fd, "quiz_id");
  if (!quizId) return { ok: false, error: t("quiz.err.unknown") };
  const parsed = readSettings(fd);
  if (!parsed.ok) return { ok: false, error: parsed.error, fieldErrors: { [parsed.field]: parsed.error } };
  const s = parsed.value;
  const supabase = await createClient();
  const quiz = await loadQuiz(supabase, quizId);
  if (!quiz) return { ok: false, error: t("quiz.err.unknown") };
  const cols: Record<string, unknown> = settingsColumns(s);
  // The scoring rule is fixed by the database once attempts are submitted; only send a change.
  const { data: current } = await supabase.from("quizzes").select("scoring_rule").eq("id", quizId).single();
  if (current && current.scoring_rule !== s.scoring_rule) cols.scoring_rule = s.scoring_rule;
  const { data: updated, error } = await supabase.from("quizzes").update(cols).eq("id", quizId).select("id");
  if (error) return { ok: false, error: friendlyError(error, t("quiz.err.saveFailed")) };
  if (!updated || updated.length === 0) return { ok: false, error: t("quiz.err.noPermission") };
  const { error: e2 } = await supabase.rpc("set_quiz_grade_settings", { p_quiz: quizId, p_max_points: s.gradePoints, p_counts_toward_total: !s.practice });
  if (e2) return { ok: false, error: friendlyError(e2, t("quiz.err.saveFailed")) };
  revalidateQuiz(quiz.offering_id, quizId);
  return { ok: true, message: t("quiz.author.settingsSaved") };
}

export async function saveQuizInstructions(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const versionId = uuid(fd, "version_id");
  if (!versionId) return { ok: false, error: t("quiz.err.unknown") };
  const raw = str(fd, "instructions", 20_000);
  const supabase = await createClient();
  const v = await quizForVersion(supabase, versionId);
  if (!v) return { ok: false, error: t("quiz.err.unknown") };
  if (v.status !== "draft") return { ok: false, error: t("quiz.err.notDraft") };
  const { error } = await supabase.rpc("update_quiz_instructions", { p_version: versionId, p_instructions: markdownToSafeHtml(raw) });
  if (error) return { ok: false, error: friendlyError(error, t("quiz.err.saveFailed")) };
  revalidateQuiz(v.offeringId, v.quizId);
  return { ok: true, message: t("quiz.author.instructionsSaved") };
}

// ---------------------------------------------------------------------------
// Questions (draft versions only; the database rejects edits to published versions)
// ---------------------------------------------------------------------------
const CHOICE_ID = /^[a-z0-9_-]{1,40}$/;

export async function saveQuestion(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const versionId = uuid(fd, "version_id");
  const questionId = uuid(fd, "question_id");
  if (!versionId) return { ok: false, error: t("quiz.err.unknown") };
  const type = str(fd, "type", 30) as QuestionType;
  if (!QUESTION_TYPES.includes(type)) return { ok: false, error: t("quiz.err.type") };
  const prompt = str(fd, "prompt", 10_001);
  if (!prompt || prompt.length > 10_000) return { ok: false, error: t("quiz.err.prompt"), fieldErrors: { prompt: t("quiz.err.prompt") } };
  const points = num(fd, "points");
  if (points === null || points <= 0 || points > 1000) return { ok: false, error: t("quiz.err.points"), fieldErrors: { points: t("quiz.err.points") } };
  const explanation = str(fd, "explanation", 5000);

  let choices: { id: string; text: string }[] = [];
  let correct: string[] = [];
  if (type === "single_choice" || type === "multiple_select") {
    const keys = fd.getAll("choice_key").map(String);
    const texts = fd.getAll("choice_text").map((v) => String(v).trim().slice(0, 2000));
    if (keys.length !== texts.length || keys.length < 2 || keys.length > 20 || texts.some((x) => !x)) {
      return { ok: false, error: t("quiz.err.choices") };
    }
    // Existing choices keep their ids; new rows get a fresh random id.
    const idFor = new Map<string, string>();
    const used = new Set<string>();
    for (const k of keys) {
      let id = k.startsWith("new-") ? "" : k;
      if (!id || !CHOICE_ID.test(id) || used.has(id)) id = shortId("c");
      used.add(id);
      idFor.set(k, id);
    }
    choices = keys.map((k, i) => ({ id: idFor.get(k)!, text: texts[i] }));
    const marked = fd.getAll("correct").map(String).filter((k) => idFor.has(k));
    correct = Array.from(new Set(marked.map((k) => idFor.get(k)!)));
    if (type === "single_choice" && correct.length !== 1) return { ok: false, error: t("quiz.err.correctOne") };
    if (type === "multiple_select" && correct.length < 1) return { ok: false, error: t("quiz.err.correctSome") };
  } else if (type === "true_false") {
    const v = str(fd, "tf_correct", 8);
    if (v !== "true" && v !== "false") return { ok: false, error: t("quiz.err.correctOne") };
    correct = [v];
  }

  const supabase = await createClient();
  const v = await quizForVersion(supabase, versionId);
  if (!v) return { ok: false, error: t("quiz.err.unknown") };
  if (v.status !== "draft") return { ok: false, error: t("quiz.err.notDraft") };
  const { error } = await supabase.rpc("upsert_question", {
    p_version: versionId,
    p_question: questionId,
    p_type: type,
    p_prompt: prompt,
    p_points: Math.round(points * 100) / 100,
    p_choices: choices,
    p_correct: type === "short_answer" ? [] : correct,
    p_explanation: explanation,
    p_position: null,
  });
  if (error) return { ok: false, error: friendlyError(error, t("quiz.err.saveFailed")) };
  revalidateQuiz(v.offeringId, v.quizId);
  return { ok: true, message: questionId ? t("quiz.author.questionSaved") : t("quiz.author.questionAdded") };
}

export async function deleteQuestion(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const questionId = uuid(fd, "question_id");
  const versionId = uuid(fd, "version_id");
  if (!questionId || !versionId) return { ok: false, error: t("quiz.err.unknown") };
  const supabase = await createClient();
  const v = await quizForVersion(supabase, versionId);
  if (!v) return { ok: false, error: t("quiz.err.unknown") };
  if (v.status !== "draft") return { ok: false, error: t("quiz.err.notDraft") };
  const { error } = await supabase.rpc("delete_question", { p_question: questionId });
  if (error) return { ok: false, error: friendlyError(error, t("quiz.err.saveFailed")) };
  revalidateQuiz(v.offeringId, v.quizId);
  return { ok: true, message: t("quiz.author.deleted") };
}

export async function moveQuestion(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const versionId = uuid(fd, "version_id");
  const questionId = uuid(fd, "question_id");
  const direction = str(fd, "direction", 8);
  if (!versionId || !questionId || (direction !== "up" && direction !== "down")) return { ok: false, error: t("quiz.err.unknown") };
  const supabase = await createClient();
  const v = await quizForVersion(supabase, versionId);
  if (!v) return { ok: false, error: t("quiz.err.unknown") };
  if (v.status !== "draft") return { ok: false, error: t("quiz.err.notDraft") };
  const { data: rows } = await supabase.from("questions").select("id").eq("quiz_version_id", versionId).order("position").order("created_at");
  const ids = (rows ?? []).map((r) => r.id as string);
  const i = ids.indexOf(questionId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return { ok: true, message: t("quiz.author.moved") };
  [ids[i], ids[j]] = [ids[j], ids[i]];
  const { error } = await supabase.rpc("reorder_questions", { p_version: versionId, p_ids: ids });
  if (error) return { ok: false, error: friendlyError(error, t("quiz.err.saveFailed")) };
  revalidateQuiz(v.offeringId, v.quizId);
  return { ok: true, message: t("quiz.author.moved") };
}

export async function createDraftVersion(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const quizId = uuid(fd, "quiz_id");
  if (!quizId) return { ok: false, error: t("quiz.err.unknown") };
  const supabase = await createClient();
  const quiz = await loadQuiz(supabase, quizId);
  if (!quiz) return { ok: false, error: t("quiz.err.unknown") };
  const { error } = await supabase.rpc("create_quiz_draft", { p_quiz: quizId });
  if (error) return { ok: false, error: friendlyError(error, t("quiz.err.saveFailed")) };
  revalidateQuiz(quiz.offering_id, quizId);
  return { ok: true, message: t("quiz.author.draftCreated") };
}

export async function publishQuizVersion(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const versionId = uuid(fd, "version_id");
  if (!versionId) return { ok: false, error: t("quiz.err.unknown") };
  const supabase = await createClient();
  const v = await quizForVersion(supabase, versionId);
  if (!v) return { ok: false, error: t("quiz.err.unknown") };
  const { error } = await supabase.rpc("publish_quiz_version", { p_version: versionId });
  if (error) return { ok: false, error: friendlyError(error, t("quiz.err.saveFailed")) };
  revalidateQuiz(v.offeringId, v.quizId);
  return { ok: true, message: t("quiz.author.published", { version: v.versionNo }) };
}

// ---------------------------------------------------------------------------
// Learner attempts
// ---------------------------------------------------------------------------

/** Start (or resume) an attempt. The database serializes starts, so a double click or a second tab returns the same attempt. */
export async function startQuizAttempt(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const quizId = uuid(fd, "quiz_id");
  if (!quizId) return { ok: false, error: t("quiz.err.unknown") };
  const supabase = await createClient();
  const quiz = await loadQuiz(supabase, quizId);
  if (!quiz) return { ok: false, error: t("quiz.err.unknown") };
  const { data, error } = await supabase.rpc("start_quiz_attempt", { p_quiz: quizId });
  if (error || !isUuid(data)) return { ok: false, error: friendlyError(error, t("quiz.err.startFailed")) };
  revalidatePath(quizBase(quiz.offering_id));
  redirect(`${quizBase(quiz.offering_id, quizId)}/attempts/${data}`);
}

export type SaveAnswerResult =
  | { ok: true; savedAt: string; deadlineAt: string | null; serverNow: string }
  | { ok: false; reason: "expired" | "submitted"; message: string }
  | { ok: false; reason: "invalid" | "error"; message: string };

/** Autosave of one answer. Never revalidates: the attempt page keeps its own state. */
export async function saveAttemptAnswer(input: { attemptId: string; questionId: string; type: QuestionType; response: QuizResponse }): Promise<SaveAnswerResult> {
  if (!isUuid(input?.attemptId) || !isUuid(input?.questionId) || !QUESTION_TYPES.includes(input.type)) {
    return { ok: false, reason: "invalid", message: t("quiz.err.answerNotSaved") };
  }
  const response = normalizeResponse(input.type, input.response);
  if (response === "invalid") return { ok: false, reason: "invalid", message: t("quiz.err.answerInvalid") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_attempt_answer", { p_attempt: input.attemptId, p_question: input.questionId, p_response: response });
  if (error || !data) {
    const message = friendlyError(error, t("quiz.err.answerNotSaved"));
    // Validation and authorization failures are permanent; anything else is retried by the client.
    const permanent = error?.code === "P0001" || error?.code === "42501";
    return { ok: false, reason: permanent ? "invalid" : "error", message };
  }
  if (data.ok === false) {
    return { ok: false, reason: data.reason === "expired" ? "expired" : "submitted", message: String(data.message ?? "") };
  }
  return { ok: true, savedAt: String(data.saved_at), deadlineAt: data.deadline_at ? String(data.deadline_at) : null, serverNow: String(data.server_now) };
}

export type AttemptState = { ok: true; status: string; deadlineAt: string | null; serverNow: string; submittedAt: string | null; finalizedReason: string | null } | { ok: false; error: string };

/** Current server state of an attempt; finalizes it lazily when its deadline has passed. */
export async function checkAttempt(attemptId: string): Promise<AttemptState> {
  if (!isUuid(attemptId)) return { ok: false, error: t("quiz.err.unknown") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_attempt", { p_attempt: attemptId });
  if (error || !data) return { ok: false, error: friendlyError(error, t("quiz.err.unreachable")) };
  return {
    ok: true,
    status: String(data.status),
    deadlineAt: data.deadline_at ?? null,
    serverNow: String(data.server_now),
    submittedAt: data.submitted_at ?? null,
    finalizedReason: data.finalized_reason ?? null,
  };
}

export type SubmitAttemptResult = { ok: true; status: string; submittedAt: string | null; finalizedReason: string | null } | { ok: false; error: string };

/** Final submission. Idempotent in the database: repeated submits return the same final state. */
export async function submitQuizAttempt(attemptId: string): Promise<SubmitAttemptResult> {
  if (!isUuid(attemptId)) return { ok: false, error: t("quiz.err.unknown") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_quiz_attempt", { p_attempt: attemptId });
  if (error || !data) return { ok: false, error: friendlyError(error, t("quiz.attempt.submitFailed")) };
  const { data: attempt } = await supabase.from("quiz_attempts").select("quiz_id, offering_id").eq("id", attemptId).maybeSingle();
  if (attempt) revalidateQuiz(attempt.offering_id as string, attempt.quiz_id as string);
  return { ok: true, status: String(data.status), submittedAt: data.submitted_at ?? null, finalizedReason: data.finalized_reason ?? null };
}

// ---------------------------------------------------------------------------
// Staff grading
// ---------------------------------------------------------------------------
async function attemptScope(supabase: Supabase, attemptId: string) {
  const { data } = await supabase.from("quiz_attempts").select("id, quiz_id, offering_id").eq("id", attemptId).maybeSingle();
  return data as { id: string; quiz_id: string; offering_id: string } | null;
}

export async function gradeAttemptQuestion(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const attemptId = uuid(fd, "attempt_id");
  const questionId = uuid(fd, "question_id");
  const max = num(fd, "max_points");
  const points = num(fd, "points");
  if (!attemptId || !questionId) return { ok: false, error: t("quiz.err.unknown") };
  if (points === null || points < 0 || (max !== null && points > max)) {
    return { ok: false, error: t("quiz.grade.err.points", { max: max ?? "" }), fieldErrors: { points: t("quiz.grade.err.points", { max: max ?? "" }) } };
  }
  const feedback = str(fd, "feedback", 10_000);
  const supabase = await createClient();
  const scope = await attemptScope(supabase, attemptId);
  if (!scope) return { ok: false, error: t("quiz.err.unknown") };
  const { error } = await supabase.rpc("grade_attempt_question", { p_attempt: attemptId, p_question: questionId, p_points: Math.round(points * 100) / 100, p_feedback: feedback });
  if (error) return { ok: false, error: friendlyError(error, t("quiz.err.saveFailed")) };
  revalidateQuiz(scope.offering_id, scope.quiz_id);
  return { ok: true, message: t("quiz.grade.gradeSaved") };
}

export async function voidQuizAttempt(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const attemptId = uuid(fd, "attempt_id");
  const reason = str(fd, "reason", 1000);
  if (!attemptId) return { ok: false, error: t("quiz.err.unknown") };
  if (reason.length < 3) return { ok: false, error: t("quiz.grade.err.reason") };
  const supabase = await createClient();
  const scope = await attemptScope(supabase, attemptId);
  if (!scope) return { ok: false, error: t("quiz.err.unknown") };
  const { error } = await supabase.rpc("void_attempt", { p_attempt: attemptId, p_reason: reason });
  if (error) return { ok: false, error: friendlyError(error, t("quiz.err.saveFailed")) };
  revalidateQuiz(scope.offering_id, scope.quiz_id);
  return { ok: true, message: t("quiz.grade.voided") };
}

export async function setAccommodation(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const quizId = uuid(fd, "quiz_id");
  const userId = uuid(fd, "user_id");
  if (!quizId) return { ok: false, error: t("quiz.err.unknown") };
  if (!userId) return { ok: false, error: t("quiz.grade.err.learner"), fieldErrors: { user_id: t("quiz.grade.err.learner") } };
  const minutesRaw = str(fd, "extra_minutes", 8) || "0";
  const attemptsRaw = str(fd, "extra_attempts", 8) || "0";
  const minutes = Number(minutesRaw);
  const attempts = Number(attemptsRaw);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10000) return { ok: false, error: t("quiz.grade.err.minutes") };
  if (!Number.isInteger(attempts) || attempts < 0 || attempts > 100) return { ok: false, error: t("quiz.grade.err.attempts") };
  const close = dateTime(fd, "extended_closes_at");
  if (close === "invalid") return { ok: false, error: t("quiz.grade.err.close") };
  const supabase = await createClient();
  const quiz = await loadQuiz(supabase, quizId);
  if (!quiz) return { ok: false, error: t("quiz.err.unknown") };
  const { data, error } = await supabase.rpc("set_quiz_accommodation", {
    p_quiz: quizId,
    p_user: userId,
    p_extra_minutes: minutes,
    p_extra_attempts: attempts,
    p_extended_closes_at: close,
    p_note: str(fd, "note", 1000),
  });
  if (error) return { ok: false, error: friendlyError(error, t("quiz.err.saveFailed")) };
  revalidateQuiz(quiz.offering_id, quizId);
  return { ok: true, message: Number(data?.extended_attempts ?? 0) > 0 ? t("quiz.grade.acc.savedExtended") : t("quiz.grade.acc.saved") };
}

export async function clearAccommodation(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const quizId = uuid(fd, "quiz_id");
  const userId = uuid(fd, "user_id");
  if (!quizId || !userId) return { ok: false, error: t("quiz.err.unknown") };
  const supabase = await createClient();
  const quiz = await loadQuiz(supabase, quizId);
  if (!quiz) return { ok: false, error: t("quiz.err.unknown") };
  const { error } = await supabase.rpc("clear_quiz_accommodation", { p_quiz: quizId, p_user: userId });
  if (error) return { ok: false, error: friendlyError(error, t("quiz.err.saveFailed")) };
  revalidateQuiz(quiz.offering_id, quizId);
  return { ok: true, message: t("quiz.grade.acc.removed") };
}

export async function releaseQuizAnswers(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const quizId = uuid(fd, "quiz_id");
  if (!quizId) return { ok: false, error: t("quiz.err.unknown") };
  const supabase = await createClient();
  const quiz = await loadQuiz(supabase, quizId);
  if (!quiz) return { ok: false, error: t("quiz.err.unknown") };
  const { error } = await supabase.rpc("release_quiz_answers", { p_quiz: quizId });
  if (error) return { ok: false, error: friendlyError(error, t("quiz.err.saveFailed")) };
  revalidateQuiz(quiz.offering_id, quizId);
  return { ok: true, message: t("quiz.grade.released") };
}

/** Publishes this quiz's changed, fully graded results (pending ones are never published by the database). */
export async function publishQuizResults(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const quizId = uuid(fd, "quiz_id");
  if (!quizId) return { ok: false, error: t("quiz.err.unknown") };
  const supabase = await createClient();
  const quiz = await loadQuiz(supabase, quizId);
  if (!quiz) return { ok: false, error: t("quiz.err.unknown") };
  const { data: item } = await supabase.from("grade_items").select("id").eq("quiz_id", quizId).maybeSingle();
  if (!item) return { ok: false, error: t("quiz.err.unknown") };
  const { data: grades } = await supabase.from("grades").select("id").eq("grade_item_id", item.id).eq("dirty", true).neq("status", "pending");
  const ids = (grades ?? []).map((g) => g.id as string);
  if (ids.length === 0) return { ok: true, message: t("quiz.grade.allPublished") };
  const { data, error } = await supabase.rpc("publish_grades", { p_offering: quiz.offering_id, p_grade_ids: ids });
  if (error) return { ok: false, error: friendlyError(error, t("quiz.err.saveFailed")) };
  revalidateQuiz(quiz.offering_id, quizId);
  return { ok: true, message: t("quiz.grade.publishedCount", { count: Number(data ?? 0) }) };
}
