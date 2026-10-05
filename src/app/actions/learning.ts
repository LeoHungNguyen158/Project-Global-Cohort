"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { dateTime, int, isUuid, str, uuid } from "@/lib/forms";
import { completionEdges, wouldCreateCycle, type RuleRow } from "@/lib/domain/prerequisites";
import { LIMITS, parseScorePercent } from "@/lib/learning/validate";
import { withNotice } from "@/lib/learning/notices";
import { t } from "@/i18n";

// Learner progress, prerequisite rules and per-learner overrides. The database decides
// every permission (mark_lesson_progress checks enrollment and locks; RLS on
// prerequisite_rules / prerequisite_overrides requires author permission), and audit
// triggers record rule and override changes. Inputs are re-validated here.

type Supabase = Awaited<ReturnType<typeof createClient>>;

const MAX_SECONDS = 7 * 24 * 3600;

function progressError(error: { message?: string; code?: string } | null): string {
  const msg = error?.message ?? "";
  if (/locked/i.test(msg)) return t("learn.err.locked");
  if (/90%/.test(msg)) return t("learn.err.playedNotYet");
  if (/actively enrolled/i.test(msg)) return t("learn.err.notLearner");
  return friendlyError(error, t("learn.err.progress"));
}

function revalidateCourse(offeringId: string) {
  revalidatePath(`/courses/${offeringId}`, "layout");
}

/**
 * Periodic position save from the video player. Returns data only (no page re-render),
 * so it can run every few seconds without disturbing the page.
 */
export async function saveLessonPosition(input: {
  offeringId: string;
  lessonId: string;
  position: number;
  duration: number | null;
}): Promise<ActionResult<{ position: number }>> {
  const position = Math.floor(Number(input?.position));
  const duration = input?.duration === null || input?.duration === undefined ? null : Math.round(Number(input.duration));
  if (!isUuid(input?.offeringId) || !isUuid(input?.lessonId)) return { ok: false, error: t("learn.err.progress") };
  if (!Number.isFinite(position) || position < 0 || position > MAX_SECONDS) return { ok: false, error: t("learn.err.progress") };
  if (duration !== null && (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SECONDS)) return { ok: false, error: t("learn.err.progress") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_lesson_progress", {
    p_offering: input.offeringId,
    p_lesson: input.lessonId,
    p_position_seconds: position,
    p_duration_seconds: duration,
    p_complete: false,
  });
  if (error) return { ok: false, error: progressError(error) };
  return { ok: true, data: { position } };
}

/** First visit to a non-video lesson: records it as started (never overwrites existing progress). */
export async function recordLessonVisit(input: { offeringId: string; lessonId: string }): Promise<ActionResult> {
  if (!isUuid(input?.offeringId) || !isUuid(input?.lessonId)) return { ok: false, error: t("learn.err.progress") };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: t("learn.err.progress") };
  const { data: lesson } = await supabase.from("lessons").select("lineage_id").eq("id", input.lessonId).maybeSingle();
  if (!lesson) return { ok: false, error: t("learn.err.locked") };
  const { data: existing } = await supabase
    .from("lesson_progress")
    .select("lesson_lineage")
    .eq("offering_id", input.offeringId)
    .eq("user_id", auth.user.id)
    .eq("lesson_lineage", lesson.lineage_id)
    .maybeSingle();
  if (existing) return { ok: true };
  const { error } = await supabase.rpc("mark_lesson_progress", {
    p_offering: input.offeringId,
    p_lesson: input.lessonId,
    p_position_seconds: 0,
    p_duration_seconds: null,
    p_complete: false,
  });
  if (error) return { ok: false, error: progressError(error) };
  return { ok: true };
}

/** The lesson's completion control (acknowledgement, or the playback rule for videos). */
export async function completeLesson(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const offeringId = uuid(formData, "offeringId");
  const lessonId = uuid(formData, "lessonId");
  if (!offeringId || !lessonId) return { ok: false, error: t("learn.complete.error") };
  const rawPosition = int(formData, "position");
  const duration = int(formData, "duration");
  const played = str(formData, "mode", 20) === "played";
  const supabase = await createClient();
  // Lessons without a player send no position: keep the saved one (the RPC overwrites it).
  let position = rawPosition !== null && rawPosition >= 0 && rawPosition <= MAX_SECONDS ? rawPosition : null;
  if (position === null) {
    const { data: auth } = await supabase.auth.getUser();
    const { data: lesson } = await supabase.from("lessons").select("lineage_id").eq("id", lessonId).maybeSingle();
    if (auth.user && lesson) {
      const { data: existing } = await supabase
        .from("lesson_progress")
        .select("last_position_seconds")
        .eq("offering_id", offeringId)
        .eq("user_id", auth.user.id)
        .eq("lesson_lineage", lesson.lineage_id)
        .maybeSingle();
      position = existing ? Number(existing.last_position_seconds) : 0;
    }
  }
  const { error } = await supabase.rpc("mark_lesson_progress", {
    p_offering: offeringId,
    p_lesson: lessonId,
    p_position_seconds: position ?? 0,
    p_duration_seconds: duration !== null && duration > 0 && duration <= MAX_SECONDS ? duration : null,
    p_complete: true,
  });
  if (error) return { ok: false, error: progressError(error) };
  revalidateCourse(offeringId);
  return { ok: true, message: played ? t("learn.complete.successPlayed") : t("learn.complete.success") };
}

// ---------------------------------------------------------------------------
// Prerequisite rules (staff with author permission; RLS enforces it)
// ---------------------------------------------------------------------------

/** The lesson lineages of a course the user can read (any version), for validating rule targets. */
async function courseLineages(supabase: Supabase, offeringId: string): Promise<Set<string> | null> {
  const { data: offering } = await supabase.from("course_offerings").select("course_id, status").eq("id", offeringId).maybeSingle();
  if (!offering) return null;
  const { data: versions } = await supabase.from("course_versions").select("id").eq("course_id", offering.course_id);
  const ids = (versions ?? []).map((v) => v.id as string);
  if (ids.length === 0) return new Set();
  const { data: lessons } = await supabase.from("lessons").select("lineage_id").in("course_version_id", ids);
  return new Set((lessons ?? []).map((l) => l.lineage_id as string));
}

async function ruleContext(formData: FormData) {
  const offeringId = uuid(formData, "offeringId");
  const target = uuid(formData, "target");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  return { offeringId, target, supabase, userId: auth.user?.id ?? null };
}

function ruleError(error: { message?: string; code?: string } | null): string {
  if (/cycle/i.test(error?.message ?? "")) return t("author.rules.cycle");
  return friendlyError(error, t("author.err.generic"));
}

async function archivedOffering(supabase: Supabase, offeringId: string): Promise<boolean> {
  const { data } = await supabase.from("course_offerings").select("status").eq("id", offeringId).maybeSingle();
  return data?.status === "archived";
}

export async function addLessonRule(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { offeringId, target, supabase, userId } = await ruleContext(formData);
  const required = uuid(formData, "required");
  if (!offeringId || !userId) return { ok: false, error: t("author.err.generic") };
  if (!target || !required) return { ok: false, error: t("author.err.chooseLesson") };
  if (target === required) return { ok: false, error: t("author.rules.same") };
  if (await archivedOffering(supabase, offeringId)) return { ok: false, error: t("author.err.archived") };
  const lineages = await courseLineages(supabase, offeringId);
  if (!lineages || !lineages.has(target) || !lineages.has(required)) return { ok: false, error: t("author.err.chooseLesson") };
  // Friendly early check; the database trigger rejects cycles regardless.
  const { data: existing } = await supabase
    .from("prerequisite_rules")
    .select("id, target_lesson_lineage, kind, required_lesson_lineage, quiz_id, min_score_pct, release_at")
    .eq("offering_id", offeringId);
  if (wouldCreateCycle(completionEdges((existing ?? []) as RuleRow[]), { target, required })) return { ok: false, error: t("author.rules.cycle") };
  const { error } = await supabase.from("prerequisite_rules").insert({
    offering_id: offeringId,
    target_lesson_lineage: target,
    kind: "lesson_complete",
    required_lesson_lineage: required,
    created_by: userId,
  });
  if (error) return { ok: false, error: ruleError(error) };
  revalidateCourse(offeringId);
  return { ok: true, message: t("author.rules.added") };
}

export async function addQuizRule(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { offeringId, target, supabase, userId } = await ruleContext(formData);
  const quizId = uuid(formData, "quizId");
  const score = parseScorePercent(str(formData, "minScore", 10));
  if (!offeringId || !userId) return { ok: false, error: t("author.err.generic") };
  if (!target) return { ok: false, error: t("author.err.chooseLesson") };
  if (!quizId) return { ok: false, error: t("author.err.chooseQuiz") };
  if (score === "invalid") return { ok: false, error: t("author.err.score") };
  if (await archivedOffering(supabase, offeringId)) return { ok: false, error: t("author.err.archived") };
  const lineages = await courseLineages(supabase, offeringId);
  if (!lineages || !lineages.has(target)) return { ok: false, error: t("author.err.chooseLesson") };
  const { data: quiz } = await supabase.from("quizzes").select("id").eq("id", quizId).eq("offering_id", offeringId).maybeSingle();
  if (!quiz) return { ok: false, error: t("author.err.chooseQuiz") };
  const { error } = await supabase.from("prerequisite_rules").insert({
    offering_id: offeringId,
    target_lesson_lineage: target,
    kind: "quiz_min_score",
    quiz_id: quizId,
    min_score_pct: score,
    created_by: userId,
  });
  if (error) return { ok: false, error: ruleError(error) };
  revalidateCourse(offeringId);
  return { ok: true, message: t("author.rules.added") };
}

export async function addReleaseRule(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { offeringId, target, supabase, userId } = await ruleContext(formData);
  const releaseAt = dateTime(formData, "releaseAt");
  if (!offeringId || !userId) return { ok: false, error: t("author.err.generic") };
  if (!target) return { ok: false, error: t("author.err.chooseLesson") };
  if (!releaseAt || releaseAt === "invalid") return { ok: false, error: t("author.err.date") };
  if (await archivedOffering(supabase, offeringId)) return { ok: false, error: t("author.err.archived") };
  const lineages = await courseLineages(supabase, offeringId);
  if (!lineages || !lineages.has(target)) return { ok: false, error: t("author.err.chooseLesson") };
  const { error } = await supabase.from("prerequisite_rules").insert({
    offering_id: offeringId,
    target_lesson_lineage: target,
    kind: "release_at",
    release_at: releaseAt,
    created_by: userId,
  });
  if (error) return { ok: false, error: ruleError(error) };
  revalidateCourse(offeringId);
  return { ok: true, message: t("author.rules.added") };
}

/** Removing a rule never touches lesson_progress: recorded completions stay as they are. */
export async function removeRule(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const offeringId = uuid(formData, "offeringId");
  const ruleId = uuid(formData, "ruleId");
  if (!offeringId || !ruleId) return { ok: false, error: t("author.err.notFound") };
  const supabase = await createClient();
  if (await archivedOffering(supabase, offeringId)) return { ok: false, error: t("author.err.archived") };
  const { data, error } = await supabase.from("prerequisite_rules").delete().eq("id", ruleId).eq("offering_id", offeringId).select("id");
  if (error) return { ok: false, error: friendlyError(error, t("author.err.generic")) };
  if (!data || data.length === 0) return { ok: false, error: t("author.err.notFound") };
  revalidateCourse(offeringId);
  // The removed rule's button is gone with it, so the page shows the result instead.
  redirect(withNotice(`/courses/${offeringId}/content/manage/rules`, "ruleRemoved"));
}

// ---------------------------------------------------------------------------
// Overrides (audited by the prerequisite_overrides audit trigger)
// ---------------------------------------------------------------------------

export async function grantOverride(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const offeringId = uuid(formData, "offeringId");
  const learnerId = uuid(formData, "userId");
  const lineage = uuid(formData, "lineage");
  const reason = str(formData, "reason", LIMITS.reason + 1);
  if (!offeringId || !learnerId) return { ok: false, error: t("author.err.notFound") };
  if (!lineage) return { ok: false, error: t("author.err.chooseLesson") };
  if (reason.length < 3 || reason.length > LIMITS.reason) return { ok: false, error: t("author.err.reason") };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: t("author.err.generic") };
  const lineages = await courseLineages(supabase, offeringId);
  if (!lineages || !lineages.has(lineage)) return { ok: false, error: t("author.err.chooseLesson") };
  const { error } = await supabase.from("prerequisite_overrides").insert({
    offering_id: offeringId,
    user_id: learnerId,
    target_lesson_lineage: lineage,
    reason,
    granted_by: auth.user.id,
  });
  if (error) return { ok: false, error: friendlyError(error, t("author.err.generic")) };
  revalidateCourse(offeringId);
  return { ok: true, message: t("people.detail.granted") };
}

export async function revokeOverride(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const offeringId = uuid(formData, "offeringId");
  const overrideId = uuid(formData, "overrideId");
  if (!offeringId || !overrideId) return { ok: false, error: t("author.err.notFound") };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prerequisite_overrides")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", overrideId)
    .eq("offering_id", offeringId)
    .is("revoked_at", null)
    .select("id, user_id");
  if (error) return { ok: false, error: friendlyError(error, t("author.err.generic")) };
  if (!data || data.length === 0) return { ok: false, error: t("author.err.notFound") };
  revalidateCourse(offeringId);
  redirect(withNotice(`/courses/${offeringId}/people/${data[0].user_id as string}`, "overrideRevoked"));
}
