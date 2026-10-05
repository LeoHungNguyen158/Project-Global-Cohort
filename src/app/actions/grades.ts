"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { bool, str, uuid, uuids } from "@/lib/forms";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { formatPoints, parseMaxPoints, parsePoints } from "@/lib/domain/grades";
import { t } from "@/i18n";

// Gradebook actions. Everything runs as the signed-in user: set_grade, publish_grades and
// unpublish_grade check the grade/publish permissions in the database, and grade item
// writes go through the grade_items RLS policy (authoring permission, manual items only).
// The checks here only produce clear messages; they never replace the database checks.

type Db = Awaited<ReturnType<typeof createClient>>;

const FEEDBACK_MAX = 20_000;
const PUBLISH_MAX = 5_000;

function revalidateGrades(offeringId: string) {
  revalidatePath(`/courses/${offeringId}/grades`);
  revalidatePath(`/grades/${offeringId}`);
  revalidatePath("/grades");
}

async function offeringStatus(db: Db, offeringId: string): Promise<string | null> {
  const { data } = await db.from("course_offerings").select("status").eq("id", offeringId).maybeSingle();
  return (data?.status as string | undefined) ?? null;
}

async function signedIn(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}

const notSignedIn: ActionResult = { ok: false, error: t("gradebook.err.signIn") };

/** Enter or change one learner's grade. The learner does not see it until it is published. */
export async function saveGrade(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  if (!(await signedIn())) return notSignedIn;
  const itemId = uuid(fd, "item_id");
  const learnerId = uuid(fd, "user_id");
  if (!itemId || !learnerId) return { ok: false, error: t("gradebook.err.item") };
  const result = str(fd, "result", 16);
  if (result !== "points" && result !== "missing" && result !== "exempt") {
    return { ok: false, error: t("gradebook.err.status"), fieldErrors: { result: t("gradebook.err.status") } };
  }
  const rawFeedback = fd.get("feedback");
  const feedback = typeof rawFeedback === "string" ? rawFeedback.replace(/\r\n/g, "\n").trim() : "";
  if (feedback.length > FEEDBACK_MAX) return { ok: false, error: t("gradebook.err.feedback"), fieldErrors: { feedback: t("gradebook.err.feedback") } };

  const supabase = await createClient();
  const [{ data: item }, { data: learner }] = await Promise.all([
    supabase.from("grade_items").select("id, offering_id, title, max_points").eq("id", itemId).maybeSingle(),
    supabase.from("profiles").select("display_name").eq("id", learnerId).maybeSingle(),
  ]);
  if (!item) return { ok: false, error: t("gradebook.err.item") };
  if ((await offeringStatus(supabase, item.offering_id)) === "archived") return { ok: false, error: t("gradebook.archivedReadOnly") };

  let points: number | null = null;
  let shown = result === "missing" ? t("gradebook.entry.missing") : t("gradebook.entry.exempt");
  if (result === "points") {
    const parsed = parsePoints(str(fd, "points", 32), item.max_points);
    if (!parsed.ok) {
      const msg = t("gradebook.err.points", { max: formatPoints(item.max_points) });
      return { ok: false, error: msg, fieldErrors: { points: msg } };
    }
    points = parsed.value;
    shown = t("grades.score", { points: parsed.text, max: formatPoints(item.max_points) });
  }

  const { error } = await supabase.rpc("set_grade", {
    p_item: item.id,
    p_user: learnerId,
    p_status: result === "points" ? "graded" : result,
    p_points: points,
    p_feedback: feedback,
  });
  if (error) return { ok: false, error: friendlyError(error, t("gradebook.err.generic")) };

  const { data: released } = await supabase
    .from("released_grades")
    .select("grade_id")
    .eq("grade_item_id", item.id)
    .eq("user_id", learnerId)
    .maybeSingle();
  revalidateGrades(item.offering_id);
  const message = t("gradebook.saved", { value: shown, learner: learner?.display_name ?? t("gradebook.learner"), item: item.title });
  return { ok: true, message: released ? `${message} ${t("gradebook.savedPublishedNote")}` : message };
}

/**
 * Publish exactly the grades listed in the form (the confirmation dialog shows which).
 * The database releases only grades that are still changed and not pending, so the
 * count it returns is what learners now see.
 */
export async function publishGrades(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  if (!(await signedIn())) return notSignedIn;
  const offeringId = uuid(fd, "offering_id");
  const ids = Array.from(new Set(uuids(fd, "grade_id"))).slice(0, PUBLISH_MAX);
  if (!offeringId || ids.length === 0) return { ok: false, error: t("gradebook.err.publishList") };
  const supabase = await createClient();
  const status = await offeringStatus(supabase, offeringId);
  if (!status) return { ok: false, error: t("gradebook.err.item") };
  if (status === "archived") return { ok: false, error: t("gradebook.archivedReadOnly") };
  const { data, error } = await supabase.rpc("publish_grades", { p_offering: offeringId, p_grade_ids: ids });
  if (error) return { ok: false, error: friendlyError(error, t("gradebook.err.generic")) };
  const count = Number(data ?? 0);
  revalidateGrades(offeringId);
  if (count === 0) return { ok: false, error: t("gradebook.err.publishList") };
  if (count < ids.length) return { ok: true, message: t("gradebook.publishedPartial", { count, expected: ids.length }) };
  return { ok: true, message: count === 1 ? t("gradebook.publishedOne") : t("gradebook.published", { count }) };
}

/** Withdraw a published grade from the learner (audited in the database). */
export async function unpublishGrade(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  if (!(await signedIn())) return notSignedIn;
  const gradeId = uuid(fd, "grade_id");
  if (!gradeId) return { ok: false, error: t("gradebook.err.item") };
  const supabase = await createClient();
  const { data: grade } = await supabase.from("grades").select("id, offering_id").eq("id", gradeId).maybeSingle();
  if (!grade) return { ok: false, error: t("gradebook.err.item") };
  if ((await offeringStatus(supabase, grade.offering_id)) === "archived") return { ok: false, error: t("gradebook.archivedReadOnly") };
  const { error } = await supabase.rpc("unpublish_grade", { p_grade: gradeId });
  if (error) return { ok: false, error: friendlyError(error, t("gradebook.err.generic")) };
  revalidateGrades(grade.offering_id);
  return { ok: true, message: t("gradebook.unpublished") };
}

function readItemFields(fd: FormData): { title: string; counts: boolean; visible: boolean; fieldErrors: Record<string, string> } {
  const title = str(fd, "title", 400);
  const fieldErrors: Record<string, string> = {};
  if (title.length < 1 || title.length > 300) fieldErrors.title = t("gradebook.err.title");
  return { title, counts: bool(fd, "counts_toward_total"), visible: bool(fd, "visible_to_learners"), fieldErrors };
}

/** Add a manual or participation grade item (authoring permission, enforced by RLS). */
export async function createGradeItem(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  if (!(await signedIn())) return notSignedIn;
  const offeringId = uuid(fd, "offering_id");
  if (!offeringId) return { ok: false, error: t("gradebook.err.item") };
  const { title, counts, visible, fieldErrors } = readItemFields(fd);
  const kind = str(fd, "kind", 32);
  if (kind !== "manual" && kind !== "participation") fieldErrors.kind = t("gradebook.err.kind");
  const max = parseMaxPoints(str(fd, "max_points", 32));
  if (!max.ok) fieldErrors.max_points = t("gradebook.err.max");
  if (Object.keys(fieldErrors).length > 0 || !max.ok) {
    return { ok: false, error: Object.values(fieldErrors)[0], fieldErrors };
  }
  const supabase = await createClient();
  const status = await offeringStatus(supabase, offeringId);
  if (!status) return { ok: false, error: t("gradebook.err.item") };
  if (status === "archived") return { ok: false, error: t("gradebook.archivedReadOnly") };
  const { data: last } = await supabase
    .from("grade_items")
    .select("position")
    .eq("offering_id", offeringId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("grade_items").insert({
    offering_id: offeringId,
    kind,
    title,
    max_points: max.value,
    counts_toward_total: counts,
    visible_to_learners: visible,
    position: (Number(last?.position ?? 0) || 0) + 1,
  });
  if (error) return { ok: false, error: friendlyError(error, t("gradebook.noAuthorPermission")) };
  revalidateGrades(offeringId);
  return { ok: true, message: t("gradebook.itemCreated", { title }) };
}

/** Edit a manual or participation item. Max points are locked once grades exist. */
export async function updateGradeItem(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  if (!(await signedIn())) return notSignedIn;
  const itemId = uuid(fd, "item_id");
  if (!itemId) return { ok: false, error: t("gradebook.err.item") };
  const { title, counts, visible, fieldErrors } = readItemFields(fd);
  const supabase = await createClient();
  const { data: item } = await supabase.from("grade_items").select("id, offering_id, kind, max_points").eq("id", itemId).maybeSingle();
  if (!item || (item.kind !== "manual" && item.kind !== "participation")) return { ok: false, error: t("gradebook.err.item") };
  if ((await offeringStatus(supabase, item.offering_id)) === "archived") return { ok: false, error: t("gradebook.archivedReadOnly") };

  const patch: Record<string, unknown> = { title, counts_toward_total: counts, visible_to_learners: visible };
  const rawMax = str(fd, "max_points", 32);
  if (rawMax !== "") {
    const max = parseMaxPoints(rawMax);
    if (!max.ok) fieldErrors.max_points = t("gradebook.err.max");
    else if (formatPoints(max.value) !== formatPoints(item.max_points)) {
      const { count } = await supabase.from("grades").select("id", { count: "exact", head: true }).eq("grade_item_id", item.id);
      if ((count ?? 0) > 0) fieldErrors.max_points = t("gradebook.itemMaxLocked");
      else patch.max_points = max.value;
    }
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, error: Object.values(fieldErrors)[0], fieldErrors };

  const { data: updated, error } = await supabase.from("grade_items").update(patch).eq("id", item.id).select("id");
  if (error) return { ok: false, error: friendlyError(error, t("gradebook.err.generic")) };
  if (!updated || updated.length === 0) return { ok: false, error: t("gradebook.noAuthorPermission") };
  revalidateGrades(item.offering_id);
  return { ok: true, message: t("gradebook.itemSaved") };
}
