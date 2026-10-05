"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { dateTime, isHttpsUrl, isUuid, num, str, uuid } from "@/lib/forms";
import { markdownToSafeHtml } from "@/lib/markdown";
import { parseRubric, scoreRubric, validateRubric } from "@/lib/assessment/rubric";
import { rubricProblemText } from "@/lib/assessment/rubric-text";
import { SUBMISSION_TYPES, type SubmissionTypeKey } from "@/lib/assessment/assignment-status";
import { t } from "@/i18n";

// Inputs are re-validated here; the database (RLS and RPCs) decides who may do what.

const TEXT_MAX = 100_000;
const MAX_FILES = 20;

function paths(offeringId: string, assignmentId?: string) {
  revalidatePath(`/courses/${offeringId}/assignments`);
  if (assignmentId) revalidatePath(`/courses/${offeringId}/assignments/${assignmentId}`, "layout");
}

type AssignmentInput = {
  title: string;
  instructions_html: string;
  submission_types: SubmissionTypeKey[];
  points: number;
  rubric: ReturnType<typeof parseRubric>;
  available_from: string | null;
  due_at: string | null;
  closes_at: string | null;
  late_policy: "accept_flag" | "reject";
  max_submissions: number;
  status: "draft" | "published" | "archived";
};

function readAssignment(fd: FormData): { ok: true; value: AssignmentInput } | { ok: false; error: string; field: string } {
  const title = str(fd, "title", 400);
  if (!title || title.length > 300) return { ok: false, error: t("assign.author.err.title"), field: "title" };
  const rawInstructions = str(fd, "instructions", 60_000);
  if (rawInstructions.length > 50_000) return { ok: false, error: t("assign.author.err.instructions"), field: "instructions" };
  const types = SUBMISSION_TYPES.filter((ty) => fd.getAll("submission_types").map(String).includes(ty));
  if (types.length === 0) return { ok: false, error: t("assign.author.err.types"), field: "submission_types" };
  const points = num(fd, "points");
  if (points === null || points <= 0 || points > 10000) return { ok: false, error: t("assign.author.err.points"), field: "points" };
  const max = Number(str(fd, "max_submissions", 8));
  if (!Number.isInteger(max) || max < 1 || max > 50) return { ok: false, error: t("assign.author.err.max"), field: "max_submissions" };
  const available = dateTime(fd, "available_from");
  const due = dateTime(fd, "due_at");
  const closes = dateTime(fd, "closes_at");
  if (available === "invalid" || due === "invalid" || closes === "invalid") return { ok: false, error: t("assign.author.err.dates"), field: "due_at" };
  const ms = (v: string | null) => (v ? new Date(v).getTime() : null);
  const [a, d, c] = [ms(available), ms(due), ms(closes)];
  if ((a !== null && d !== null && d <= a) || (d !== null && c !== null && c < d) || (a !== null && c !== null && c <= a)) {
    return { ok: false, error: t("assign.author.err.dates"), field: "due_at" };
  }
  let rubricRaw: unknown = [];
  try {
    rubricRaw = JSON.parse(str(fd, "rubric", 200_000) || "[]");
  } catch {
    return { ok: false, error: t("assign.author.err.rubric.invalid"), field: "rubric" };
  }
  if (!Array.isArray(rubricRaw)) return { ok: false, error: t("assign.author.err.rubric.invalid"), field: "rubric" };
  const rubric = parseRubric(rubricRaw);
  if (rubric.length !== rubricRaw.length) {
    // parseRubric drops entries without a valid id or with missing/zero points: name the first one.
    const dropped = rubricRaw.findIndex((entry) => parseRubric([entry]).length === 0);
    return { ok: false, error: t("assign.author.err.rubric.criterionPoints", { number: dropped + 1 }), field: "rubric" };
  }
  const roundedPoints = Math.round(points * 100) / 100;
  const problem = validateRubric(rubric, roundedPoints);
  if (problem) return { ok: false, error: rubricProblemText(problem), field: "rubric" };
  const late = str(fd, "late_policy", 20) === "reject" ? "reject" : "accept_flag";
  const statusRaw = str(fd, "status", 20);
  const status = statusRaw === "published" || statusRaw === "archived" ? statusRaw : "draft";
  return {
    ok: true,
    value: {
      title,
      instructions_html: markdownToSafeHtml(rawInstructions),
      submission_types: types,
      points: roundedPoints,
      rubric,
      available_from: available,
      due_at: due,
      closes_at: closes,
      late_policy: late,
      max_submissions: max,
      status,
    },
  };
}

export async function createAssignment(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const offeringId = uuid(fd, "offering_id");
  if (!offeringId) return { ok: false, error: t("assign.err.unknown") };
  const parsed = readAssignment(fd);
  if (!parsed.ok) return { ok: false, error: parsed.error, fieldErrors: { [parsed.field]: parsed.error } };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: t("assign.err.signedOut") };
  const { data, error } = await supabase
    .from("assignments")
    .insert({ offering_id: offeringId, ...parsed.value, created_by: auth.user.id })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: friendlyError(error, t("assign.err.saveFailed")) };
  paths(offeringId);
  redirect(`/courses/${offeringId}/assignments/${data.id}/edit?created=1`);
}

export async function updateAssignment(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const assignmentId = uuid(fd, "assignment_id");
  if (!assignmentId) return { ok: false, error: t("assign.err.unknown") };
  const parsed = readAssignment(fd);
  if (!parsed.ok) return { ok: false, error: parsed.error, fieldErrors: { [parsed.field]: parsed.error } };
  const supabase = await createClient();
  // Existing grades keep their points when the assignment's points change; refuse a change that
  // would leave a grade above the new maximum.
  const { data: item } = await supabase.from("grade_items").select("id").eq("assignment_id", assignmentId).maybeSingle();
  if (item) {
    const { data: top } = await supabase
      .from("grades")
      .select("points")
      .eq("grade_item_id", item.id)
      .not("points", "is", null)
      .order("points", { ascending: false })
      .limit(1);
    const highest = top?.[0]?.points === undefined || top?.[0]?.points === null ? null : Number(top[0].points);
    if (highest !== null && highest > parsed.value.points) {
      const error = t("assign.author.err.pointsBelowGrades", { highest });
      return { ok: false, error, fieldErrors: { points: error } };
    }
  }
  const { data, error } = await supabase.from("assignments").update(parsed.value).eq("id", assignmentId).select("id, offering_id");
  if (error) return { ok: false, error: friendlyError(error, t("assign.err.saveFailed")) };
  const row = data?.[0] as { id: string; offering_id: string } | undefined;
  if (!row) return { ok: false, error: t("assign.err.noPermission") };
  paths(row.offering_id, row.id);
  return { ok: true, message: t("assign.author.saved") };
}

// ---------------------------------------------------------------------------
// Learner submissions (called from the submission editor with try/catch, so a dropped
// connection never loses what is on the page)
// ---------------------------------------------------------------------------
export type WorkInput = { assignmentId: string; text: string; url: string; assetIds: string[] };

function readWork(input: WorkInput): { ok: true; text: string; url: string | null; assets: string[] } | { ok: false; error: string } {
  if (!isUuid(input?.assignmentId)) return { ok: false, error: t("assign.err.unknown") };
  const text = typeof input.text === "string" ? input.text : "";
  if (text.length > TEXT_MAX) return { ok: false, error: t("assign.err.text") };
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (url && (!isHttpsUrl(url) || url.length > 2000)) return { ok: false, error: t("assign.err.url") };
  const assets = Array.isArray(input.assetIds) ? Array.from(new Set(input.assetIds.filter(isUuid))).slice(0, MAX_FILES) : [];
  return { ok: true, text, url: url || null, assets };
}

export async function saveSubmissionDraft(input: WorkInput): Promise<ActionResult<{ savedAt: string }>> {
  const w = readWork(input);
  if (!w.ok) return { ok: false, error: w.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_submission_draft", { p_assignment: input.assignmentId, p_text: w.text, p_url: w.url, p_assets: w.assets });
  if (error || !data) return { ok: false, error: friendlyError(error, t("assign.err.saveFailed")) };
  return { ok: true, message: t("assign.detail.draftSavedShort"), data: { savedAt: String(data.draft_saved_at) } };
}

export type Receipt = { versionNo: number; receiptCode: string; submittedAt: string; isLate: boolean; duplicate: boolean };

/**
 * Saves what is on the page and submits it as a new version. The client key makes a retry
 * after a dropped connection return the original receipt instead of creating a second version.
 */
export async function submitAssignmentWork(input: WorkInput & { clientKey: string }): Promise<ActionResult<Receipt>> {
  const w = readWork(input);
  if (!w.ok) return { ok: false, error: w.error };
  const key = typeof input.clientKey === "string" && /^[A-Za-z0-9-]{8,80}$/.test(input.clientKey) ? input.clientKey : null;
  if (!key) return { ok: false, error: t("assign.err.saveFailed") };
  if (!w.text.trim() && !w.url && w.assets.length === 0) return { ok: false, error: t("assign.err.empty") };
  const supabase = await createClient();
  const saved = await supabase.rpc("save_submission_draft", { p_assignment: input.assignmentId, p_text: w.text, p_url: w.url, p_assets: w.assets });
  if (saved.error) return { ok: false, error: friendlyError(saved.error, t("assign.err.saveFailed")) };
  const { data, error } = await supabase.rpc("submit_assignment", { p_assignment: input.assignmentId, p_client_key: key });
  if (error || !data) return { ok: false, error: friendlyError(error, t("assign.err.submitFailed")) };
  const { data: asg } = await supabase.from("assignments").select("offering_id").eq("id", input.assignmentId).maybeSingle();
  if (asg) paths(asg.offering_id as string, input.assignmentId);
  return {
    ok: true,
    data: {
      versionNo: Number(data.version_no),
      receiptCode: String(data.receipt_code),
      submittedAt: String(data.submitted_at),
      isLate: Boolean(data.is_late),
      duplicate: Boolean(data.duplicate),
    },
  };
}

// ---------------------------------------------------------------------------
// Staff grading
// ---------------------------------------------------------------------------
async function submissionScope(supabase: Awaited<ReturnType<typeof createClient>>, submissionId: string) {
  const { data } = await supabase
    .from("submissions")
    .select("id, assignment_id, offering_id, user_id, status, submitted_count, assignments(points, rubric)")
    .eq("id", submissionId)
    .maybeSingle();
  return data as unknown as {
    id: string;
    assignment_id: string;
    offering_id: string;
    user_id: string;
    status: string;
    submitted_count: number;
    assignments: { points: number; rubric: unknown } | null;
  } | null;
}

export async function gradeSubmission(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const submissionId = uuid(fd, "submission_id");
  const versionNo = Number(str(fd, "version_no", 8));
  if (!submissionId || !Number.isInteger(versionNo) || versionNo < 1) return { ok: false, error: t("assign.err.unknown") };
  const supabase = await createClient();
  const scope = await submissionScope(supabase, submissionId);
  if (!scope?.assignments) return { ok: false, error: t("assign.err.unknown") };
  const max = Number(scope.assignments.points);
  const rubric = parseRubric(scope.assignments.rubric);
  let points: number | null;
  let rubricScores: Record<string, number> = {};
  if (rubric.length > 0) {
    const input: Record<string, number | null> = {};
    for (const c of rubric) input[c.id] = num(fd, `criterion_${c.id}`);
    const scored = scoreRubric(rubric, input);
    if (!scored.ok) return { ok: false, error: scored.missing.length ? t("assign.grade.err.rubricMissing") : t("assign.grade.err.rubricRange") };
    points = scored.total;
    rubricScores = scored.scores;
  } else {
    points = num(fd, "points");
  }
  if (points === null || points < 0 || points > max) return { ok: false, error: t("assign.grade.err.points", { max }), fieldErrors: { points: t("assign.grade.err.points", { max }) } };
  const feedback = str(fd, "feedback", 20_000);
  const { error } = await supabase.rpc("grade_submission_version", {
    p_submission: submissionId,
    p_version_no: versionNo,
    p_points: Math.round(points * 100) / 100,
    p_feedback: feedback,
    p_rubric: rubricScores,
    p_return: false,
    p_return_note: "",
  });
  if (error) return { ok: false, error: friendlyError(error, t("assign.err.saveFailed")) };
  paths(scope.offering_id, scope.assignment_id);
  return { ok: true, message: t("assign.grade.saved") };
}

export async function returnSubmission(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const submissionId = uuid(fd, "submission_id");
  const versionNo = Number(str(fd, "version_no", 8));
  if (!submissionId || !Number.isInteger(versionNo) || versionNo < 1) return { ok: false, error: t("assign.err.unknown") };
  const note = str(fd, "note", 6000);
  if (note.length > 5000) return { ok: false, error: t("assign.grade.err.note") };
  const supabase = await createClient();
  const scope = await submissionScope(supabase, submissionId);
  if (!scope) return { ok: false, error: t("assign.err.unknown") };
  const { error } = await supabase.rpc("grade_submission_version", {
    p_submission: submissionId,
    p_version_no: versionNo,
    p_points: null,
    p_feedback: "",
    p_rubric: {},
    p_return: true,
    p_return_note: note,
  });
  if (error) return { ok: false, error: friendlyError(error, t("assign.err.saveFailed")) };
  paths(scope.offering_id, scope.assignment_id);
  return { ok: true, message: t("assign.grade.returned") };
}

/** Publishes one learner's current grade for an assignment (publication permission; the database checks). */
export async function publishSubmissionGrade(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const gradeId = uuid(fd, "grade_id");
  const offeringId = uuid(fd, "offering_id");
  const assignmentId = uuid(fd, "assignment_id");
  if (!gradeId || !offeringId || !assignmentId) return { ok: false, error: t("assign.err.unknown") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_grades", { p_offering: offeringId, p_grade_ids: [gradeId] });
  if (error) return { ok: false, error: friendlyError(error, t("assign.err.saveFailed")) };
  paths(offeringId, assignmentId);
  return Number(data ?? 0) > 0 ? { ok: true, message: t("assign.grade.publishedOk") } : { ok: true, message: t("assign.grade.nothingToPublish") };
}
