"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { bool, str, uuid } from "@/lib/forms";
import type { ActionResult } from "@/lib/errors";
import { actionAdmin, dbFail, fail } from "@/lib/admin/action-utils";
import { canAdminCohort, type AdminContext } from "@/lib/admin/access";
import { getAdminOffering } from "@/lib/admin/data";
import { validateOffering, type OfferingInput } from "@/lib/admin/validation";
import { isValidEmail, normalizeEmail } from "@/lib/admin/import";
import { t, type MessageKey } from "@/i18n";

const FIELD_ERRORS: Record<string, MessageKey> = {
  code: "admin.offerings.error.code",
  termLabel: "admin.offerings.error.termLabel",
  timezone: "admin.cohorts.error.timezone",
  dateTime: "admin.offerings.error.dateTime",
  dateTimeOrder: "admin.offerings.error.dateTimeOrder",
  status: "admin.offerings.error.status",
  color: "admin.offerings.error.color",
};

function readOffering(formData: FormData): OfferingInput {
  return {
    code: str(formData, "code", 80),
    termLabel: str(formData, "term_label", 120),
    startsLocal: str(formData, "starts_local", 20),
    endsLocal: str(formData, "ends_local", 20),
    timezone: str(formData, "timezone", 80),
    status: str(formData, "status", 20) || "draft",
    accentColor: str(formData, "accent_color", 10) || "#1D4ED8",
    catalogState: str(formData, "catalog_state", 30) || "not_open",
  };
}

function invalid(errors: Record<string, string>) {
  const fieldErrors = Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, t(FIELD_ERRORS[v] ?? "admin.common.failed")]));
  return fail(Object.values(fieldErrors)[0], fieldErrors);
}

function offeringConflict(error: { code?: string; message?: string }) {
  return error.code === "23505" ? fail(t("admin.offerings.error.codeTaken"), { code: t("admin.offerings.error.codeTaken") }) : dbFail(error);
}

function refresh(offeringId: string) {
  revalidatePath(`/admin/offerings/${offeringId}`);
  revalidatePath("/admin/offerings");
  revalidatePath("/admin");
}

/** Loads the offering for an action, or a "not found" failure outside the caller's scope. */
async function scopedOffering(ctx: AdminContext, formData: FormData) {
  const offeringId = uuid(formData, "offering");
  if (!offeringId) return null;
  return getAdminOffering(ctx, offeringId);
}

/** Creates an offering of a course version for a cohort (cohort administrators). */
export async function createOffering(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const versionId = uuid(formData, "course_version");
  const cohortId = uuid(formData, "cohort");
  const input = readOffering(formData);
  if (!versionId) return fail(t("admin.offerings.error.version"), { course_version: t("admin.offerings.error.version") });
  if (!cohortId || !canAdminCohort(auth.ctx, cohortId)) return fail(t("admin.offerings.error.cohort"), { cohort: t("admin.offerings.error.cohort") });
  if (input.status === "archived") input.status = "";
  const { errors, times } = validateOffering(input);
  if (Object.keys(errors).length > 0) return invalid(errors);

  const supabase = await createClient();
  const { data: options, error: optionsError } = await supabase.rpc("admin_course_version_options");
  if (optionsError) return dbFail(optionsError);
  const version = ((options ?? []) as { course_id: string; version_id: string }[]).find((o) => o.version_id === versionId);
  if (!version) return fail(t("admin.offerings.error.version"), { course_version: t("admin.offerings.error.version") });

  const { data, error } = await supabase
    .from("course_offerings")
    .insert({
      course_id: version.course_id,
      course_version_id: versionId,
      cohort_id: cohortId,
      code: input.code,
      term_label: input.termLabel,
      starts_at: times.startsAt,
      ends_at: times.endsAt,
      timezone: input.timezone,
      status: input.status,
      accent_color: input.accentColor,
      catalog_visible: bool(formData, "catalog_visible"),
      catalog_state: input.catalogState,
      created_by: auth.ctx.user.id,
    })
    .select("id")
    .single();
  if (error) return offeringConflict(error);
  revalidatePath("/admin/offerings");
  redirect(`/admin/offerings/${data.id}?created=1`);
}

export async function updateOffering(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const offering = await scopedOffering(auth.ctx, formData);
  if (!offering) return fail(t("admin.common.notFound"));
  if (offering.status === "archived") return fail(t("admin.offerings.error.archived"));
  const input = { ...readOffering(formData), status: offering.status };
  const { errors, times } = validateOffering(input);
  if (Object.keys(errors).length > 0) return invalid(errors);

  const supabase = await createClient();
  const { error } = await supabase
    .from("course_offerings")
    .update({
      code: input.code,
      term_label: input.termLabel,
      starts_at: times.startsAt,
      ends_at: times.endsAt,
      timezone: input.timezone,
      accent_color: input.accentColor,
      catalog_visible: bool(formData, "catalog_visible"),
      catalog_state: input.catalogState,
      updated_at: new Date().toISOString(),
    })
    .eq("id", offering.id);
  if (error) return offeringConflict(error);
  refresh(offering.id);
  return { ok: true, message: t("admin.offering.saved") };
}

/** Publish (release to enrolled learners), complete, archive or restore an offering. */
export async function changeOfferingStatus(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const offering = await scopedOffering(auth.ctx, formData);
  if (!offering) return fail(t("admin.common.notFound"));
  const change = str(formData, "change", 20);
  const supabase = await createClient();

  if (change === "publish") {
    const { error } = await supabase.rpc("publish_offering", { p_offering: offering.id });
    if (error) return dbFail(error);
    refresh(offering.id);
    return { ok: true, message: t("admin.offering.published") };
  }
  if (change === "complete") {
    const { data, error } = await supabase.rpc("admin_complete_offering", { p_offering: offering.id });
    if (error) return dbFail(error);
    refresh(offering.id);
    return { ok: true, message: t("admin.offering.completed", { count: Number(data ?? 0) }) };
  }
  if (change === "archive" || change === "restore") {
    if (change === "archive" && offering.status === "archived") return fail(t("admin.offering.alreadyArchived"));
    if (change === "restore" && offering.status !== "archived") return fail(t("admin.offering.notArchived"));
    const { error } = await supabase
      .from("course_offerings")
      .update({ status: change === "archive" ? "archived" : "draft", updated_at: new Date().toISOString() })
      .eq("id", offering.id);
    if (error) return dbFail(error);
    refresh(offering.id);
    return { ok: true, message: change === "archive" ? t("admin.offering.archived") : t("admin.offering.restored") };
  }
  return fail(t("admin.common.invalidRequest"));
}

/** Moves the offering to a newer published version of its course (learners are notified). */
export async function adoptOfferingVersion(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const offering = await scopedOffering(auth.ctx, formData);
  const versionId = uuid(formData, "version");
  if (!offering || !versionId) return fail(t("admin.common.notFound"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("adopt_course_version", { p_offering: offering.id, p_version: versionId });
  if (error) return dbFail(error);
  refresh(offering.id);
  return { ok: true, message: t("admin.offering.versionAdopted") };
}

type Found = { user_id: string; display_name: string; email_confirmed: boolean; suspended: boolean };

async function findAccount(cohortId: string, email: string): Promise<{ found: Found } | { error: ActionResult }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_find_user", { p_email: email, p_cohort: cohortId });
  if (error) return { error: dbFail(error) };
  const found = ((data ?? []) as Found[])[0];
  if (!found) return { error: fail(t("admin.people.noAccount")) };
  if (found.suspended) return { error: fail(t("admin.people.accountSuspended")) };
  return { found };
}

function staffFlags(role: string, formData: FormData) {
  // Instructors always have every course permission; the flags matter for teaching assistants.
  if (role === "instructor") return { can_author: true, can_grade: true, can_publish_grades: true };
  return { can_author: bool(formData, "can_author"), can_grade: bool(formData, "can_grade"), can_publish_grades: bool(formData, "can_publish_grades") };
}

export async function addStaff(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const offering = await scopedOffering(auth.ctx, formData);
  if (!offering) return fail(t("admin.common.notFound"));
  const email = normalizeEmail(str(formData, "email", 320));
  const role = str(formData, "role", 20);
  if (!isValidEmail(email)) return fail(t("admin.invite.error.email"), { email: t("admin.invite.error.email") });
  if (!["instructor", "ta"].includes(role)) return fail(t("admin.staff.error.role"));

  const lookup = await findAccount(offering.cohort_id, email);
  if ("error" in lookup) return lookup.error;
  const supabase = await createClient();
  const { data: enrolled } = await supabase
    .from("enrollments")
    .select("status")
    .eq("offering_id", offering.id)
    .eq("user_id", lookup.found.user_id)
    .in("status", ["active", "suspended"])
    .maybeSingle();
  if (enrolled) return fail(t("admin.staff.error.isLearner"));
  const { error } = await supabase.from("staff_assignments").insert({
    offering_id: offering.id,
    user_id: lookup.found.user_id,
    role,
    ...staffFlags(role, formData),
    created_by: auth.ctx.user.id,
  });
  if (error) return error.code === "23505" ? fail(t("admin.staff.error.exists")) : dbFail(error);
  refresh(offering.id);
  return { ok: true, message: t("admin.staff.added", { name: lookup.found.display_name }) };
}

export async function updateStaff(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const offering = await scopedOffering(auth.ctx, formData);
  const userId = uuid(formData, "user");
  const role = str(formData, "role", 20);
  if (!offering || !userId) return fail(t("admin.common.notFound"));
  if (!["instructor", "ta"].includes(role)) return fail(t("admin.staff.error.role"));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_assignments")
    .update({ role, ...staffFlags(role, formData) })
    .eq("offering_id", offering.id)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return dbFail(error);
  if (!data || data.length === 0) return fail(t("admin.common.notFound"));
  refresh(offering.id);
  return { ok: true, message: t("admin.staff.saved") };
}

export async function removeStaff(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const offering = await scopedOffering(auth.ctx, formData);
  const userId = uuid(formData, "user");
  if (!offering || !userId) return fail(t("admin.common.notFound"));
  const supabase = await createClient();
  const { data, error } = await supabase.from("staff_assignments").delete().eq("offering_id", offering.id).eq("user_id", userId).select("user_id");
  if (error) return dbFail(error);
  if (!data || data.length === 0) return fail(t("admin.common.notFound"));
  refresh(offering.id);
  return { ok: true, message: t("admin.staff.removed") };
}

/** Enrolls an existing account (or re-activates a previous enrollment) and adds cohort participation. */
export async function addEnrollment(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const offering = await scopedOffering(auth.ctx, formData);
  if (!offering) return fail(t("admin.common.notFound"));
  if (offering.status === "archived") return fail(t("admin.offerings.error.archived"));
  const email = normalizeEmail(str(formData, "email", 320));
  if (!isValidEmail(email)) return fail(t("admin.invite.error.email"), { email: t("admin.invite.error.email") });

  const lookup = await findAccount(offering.cohort_id, email);
  if ("error" in lookup) return lookup.error;
  const userId = lookup.found.user_id;
  const supabase = await createClient();
  const { data: staff } = await supabase.from("staff_assignments").select("role").eq("offering_id", offering.id).eq("user_id", userId).maybeSingle();
  if (staff) return fail(t("admin.enroll.error.isStaff"));
  const { data: existing } = await supabase.from("enrollments").select("id, status").eq("offering_id", offering.id).eq("user_id", userId).maybeSingle();
  if (existing?.status === "active") return fail(t("admin.enroll.error.exists"));
  const { error } = existing
    ? await supabase.from("enrollments").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", existing.id)
    : await supabase.from("enrollments").insert({ offering_id: offering.id, user_id: userId, status: "active", source: "admin", created_by: auth.ctx.user.id });
  if (error) return dbFail(error);
  const { error: cpError } = await supabase
    .from("cohort_participation")
    .upsert({ cohort_id: offering.cohort_id, user_id: userId, status: "active", created_by: auth.ctx.user.id }, { onConflict: "cohort_id,user_id", ignoreDuplicates: true });
  refresh(offering.id);
  return {
    ok: true,
    message: cpError
      ? t("admin.enroll.addedNoCohort", { name: lookup.found.display_name })
      : t(offering.status === "published" ? "admin.enroll.addedOpen" : "admin.enroll.added", { name: lookup.found.display_name }),
  };
}

/** Changes an enrollment's status. Anything but active/completed removes course access at once. */
export async function setEnrollmentStatus(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const offering = await scopedOffering(auth.ctx, formData);
  const userId = uuid(formData, "user");
  const status = str(formData, "status", 20);
  if (!offering || !userId) return fail(t("admin.common.notFound"));
  if (!["active", "suspended", "withdrawn", "completed"].includes(status)) return fail(t("admin.common.invalidRequest"));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enrollments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("offering_id", offering.id)
    .eq("user_id", userId)
    .select("id");
  if (error) return dbFail(error);
  if (!data || data.length === 0) return fail(t("admin.common.notFound"));
  refresh(offering.id);
  return { ok: true, message: t(`admin.enroll.status.${status as "active" | "suspended" | "withdrawn" | "completed"}`) };
}
