"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, uuid } from "@/lib/forms";
import type { ActionResult } from "@/lib/errors";
import { actionAdmin, dbFail, fail } from "@/lib/admin/action-utils";
import { isValidCode } from "@/lib/admin/validation";
import { t } from "@/i18n";

function checkFields(code: string, title: string): ActionResult | null {
  if (!isValidCode(code)) return fail(t("admin.courses.error.code"), { code: t("admin.courses.error.code") });
  if (title.length < 1 || title.length > 300) return fail(t("admin.courses.error.title"), { title: t("admin.courses.error.title") });
  return null;
}

/** Creates a course with its first draft version (platform administrators). */
export async function createCourse(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin({ platform: true });
  if ("denied" in auth) return auth.denied;
  const code = str(formData, "code", 80);
  const title = str(formData, "title", 400);
  const invalid = checkFields(code, title);
  if (invalid) return invalid;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_course", { p_code: code, p_title: title });
  if (error) return dbFail(error);
  revalidatePath("/admin/courses");
  redirect(`/admin/courses/${(data as { course_id: string }).course_id}?created=1`);
}

export async function renameCourse(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin({ platform: true });
  if ("denied" in auth) return auth.denied;
  const courseId = uuid(formData, "course");
  const title = str(formData, "title", 400);
  if (!courseId) return fail(t("admin.common.invalidRequest"));
  if (title.length < 1 || title.length > 300) return fail(t("admin.courses.error.title"), { title: t("admin.courses.error.title") });

  const supabase = await createClient();
  const { data, error } = await supabase.from("courses").update({ title, updated_at: new Date().toISOString() }).eq("id", courseId).select("id");
  if (error) return dbFail(error);
  if (!data || data.length === 0) return fail(t("admin.common.notFound"));
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/admin/courses");
  return { ok: true, message: t("admin.course.renamed") };
}

/** Copies the latest published (else draft) content into a new course as draft version 1. */
export async function duplicateCourse(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin({ platform: true });
  if ("denied" in auth) return auth.denied;
  const courseId = uuid(formData, "course");
  const code = str(formData, "code", 80);
  const title = str(formData, "title", 400);
  if (!courseId) return fail(t("admin.common.invalidRequest"));
  const invalid = checkFields(code, title);
  if (invalid) return invalid;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_duplicate_course", { p_course: courseId, p_code: code, p_title: title });
  if (error) return dbFail(error);
  revalidatePath("/admin/courses");
  redirect(`/admin/courses/${data as string}?duplicated=1`);
}

/** Archives a course (no new offerings can use it) or restores it. Never deletes. */
export async function setCourseArchived(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin({ platform: true });
  if ("denied" in auth) return auth.denied;
  const courseId = uuid(formData, "course");
  const archive = str(formData, "archive", 1) === "1";
  if (!courseId) return fail(t("admin.common.invalidRequest"));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("courses")
    .update({ archived_at: archive ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", courseId)
    .select("id");
  if (error) return dbFail(error);
  if (!data || data.length === 0) return fail(t("admin.common.notFound"));
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/admin/courses");
  return { ok: true, message: archive ? t("admin.course.archived") : t("admin.course.restored") };
}
