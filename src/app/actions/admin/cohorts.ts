"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { optStr, str, uuid } from "@/lib/forms";
import type { ActionResult } from "@/lib/errors";
import { actionAdmin, dbFail, fail } from "@/lib/admin/action-utils";
import { canAdminCohort } from "@/lib/admin/access";
import { validateCohort, type CohortInput } from "@/lib/admin/validation";
import { isValidEmail, normalizeEmail } from "@/lib/admin/import";
import { t, type MessageKey } from "@/i18n";

const FIELD_ERRORS: Record<string, MessageKey> = {
  code: "admin.cohorts.error.code",
  name: "admin.cohorts.error.name",
  description: "admin.cohorts.error.description",
  timezone: "admin.cohorts.error.timezone",
  date: "admin.cohorts.error.date",
  dateOrder: "admin.cohorts.error.dateOrder",
  status: "admin.cohorts.error.status",
};

function readCohort(formData: FormData): CohortInput {
  return {
    code: str(formData, "code", 80),
    name: str(formData, "name", 300),
    description: str(formData, "description", 2100),
    timezone: str(formData, "timezone", 80),
    startsOn: optStr(formData, "starts_on", 20),
    endsOn: optStr(formData, "ends_on", 20),
    status: str(formData, "status", 20),
  };
}

function invalid(errors: Record<string, string>) {
  const fieldErrors = Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, t(FIELD_ERRORS[v] ?? "admin.common.failed")]));
  return fail(Object.values(fieldErrors)[0], fieldErrors);
}

function cohortConflict(error: { code?: string; message?: string }) {
  return error.code === "23505" ? fail(t("admin.cohorts.error.codeTaken"), { code: t("admin.cohorts.error.codeTaken") }) : dbFail(error);
}

/** Creates a cohort (platform administrators; the database enforces it). */
export async function createCohort(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin({ platform: true });
  if ("denied" in auth) return auth.denied;
  const input = readCohort(formData);
  if (input.status === "archived") input.status = "";
  const errors = validateCohort(input);
  if (Object.keys(errors).length > 0) return invalid(errors);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cohorts")
    .insert({
      code: input.code,
      name: input.name,
      description: input.description,
      timezone: input.timezone,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      status: input.status,
      created_by: auth.ctx.user.id,
    })
    .select("id")
    .single();
  if (error) return cohortConflict(error);
  revalidatePath("/admin/cohorts");
  redirect(`/admin/cohorts/${data.id}?created=1`);
}

export async function updateCohort(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const cohortId = uuid(formData, "cohort");
  if (!cohortId || !canAdminCohort(auth.ctx, cohortId)) return fail(t("admin.common.notFound"));
  const input = readCohort(formData);
  const errors = validateCohort(input);
  if (input.status === "archived") errors.status = "status";
  if (Object.keys(errors).length > 0) return invalid(errors);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cohorts")
    .update({
      code: input.code,
      name: input.name,
      description: input.description,
      timezone: input.timezone,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      status: input.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cohortId)
    .neq("status", "archived")
    .select("id");
  if (error) return cohortConflict(error);
  if (!data || data.length === 0) return fail(t("admin.cohorts.error.archivedOrMissing"));
  revalidatePath(`/admin/cohorts/${cohortId}`);
  revalidatePath("/admin/cohorts");
  return { ok: true, message: t("admin.cohorts.saved") };
}

/** Archives a cohort or restores it to active. Nothing is deleted. */
export async function setCohortArchived(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const cohortId = uuid(formData, "cohort");
  const archive = str(formData, "archive", 1) === "1";
  if (!cohortId || !canAdminCohort(auth.ctx, cohortId)) return fail(t("admin.common.notFound"));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cohorts")
    .update({ status: archive ? "archived" : "active", updated_at: new Date().toISOString() })
    .eq("id", cohortId)
    .select("id");
  if (error) return dbFail(error);
  if (!data || data.length === 0) return fail(t("admin.common.notFound"));
  revalidatePath(`/admin/cohorts/${cohortId}`);
  revalidatePath("/admin/cohorts");
  revalidatePath("/admin");
  return { ok: true, message: archive ? t("admin.cohorts.archived") : t("admin.cohorts.restored") };
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

/** Adds an existing account to the cohort as a participant (or reactivates them). */
export async function addCohortParticipant(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const cohortId = uuid(formData, "cohort");
  const email = normalizeEmail(str(formData, "email", 320));
  if (!cohortId || !canAdminCohort(auth.ctx, cohortId)) return fail(t("admin.common.notFound"));
  if (!isValidEmail(email)) return fail(t("admin.invite.error.email"), { email: t("admin.invite.error.email") });

  const lookup = await findAccount(cohortId, email);
  if ("error" in lookup) return lookup.error;
  const supabase = await createClient();
  const { error } = await supabase
    .from("cohort_participation")
    .upsert({ cohort_id: cohortId, user_id: lookup.found.user_id, status: "active", created_by: auth.ctx.user.id }, { onConflict: "cohort_id,user_id" });
  if (error) return dbFail(error);
  revalidatePath(`/admin/cohorts/${cohortId}`);
  return { ok: true, message: t("admin.people.participantAdded", { name: lookup.found.display_name }) };
}

export async function setParticipantStatus(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const cohortId = uuid(formData, "cohort");
  const userId = uuid(formData, "user");
  const status = str(formData, "status", 20);
  if (!cohortId || !userId || !canAdminCohort(auth.ctx, cohortId)) return fail(t("admin.common.notFound"));
  if (!["active", "suspended", "withdrawn"].includes(status)) return fail(t("admin.common.invalidRequest"));

  const supabase = await createClient();
  const { data, error } = await supabase.from("cohort_participation").update({ status }).eq("cohort_id", cohortId).eq("user_id", userId).select("user_id");
  if (error) return dbFail(error);
  if (!data || data.length === 0) return fail(t("admin.common.notFound"));
  revalidatePath(`/admin/cohorts/${cohortId}`);
  return { ok: true, message: t("admin.people.participantStatusSaved") };
}

/**
 * Makes an existing account a coordinator of this cohort: grants the coordinator role
 * when needed and adds the cohort to their scope (platform administrators only).
 */
export async function addCohortCoordinator(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin({ platform: true });
  if ("denied" in auth) return auth.denied;
  const cohortId = uuid(formData, "cohort");
  const email = normalizeEmail(str(formData, "email", 320));
  if (!cohortId) return fail(t("admin.common.notFound"));
  if (!isValidEmail(email)) return fail(t("admin.invite.error.email"), { email: t("admin.invite.error.email") });

  const lookup = await findAccount(cohortId, email);
  if ("error" in lookup) return lookup.error;
  if (!lookup.found.email_confirmed) return fail(t("admin.people.notConfirmed"));
  const supabase = await createClient();
  const { error: roleError } = await supabase.rpc("admin_set_role", { p_user: lookup.found.user_id, p_role: "coordinator", p_grant: true });
  if (roleError) return dbFail(roleError);
  const { error } = await supabase.from("coordinator_scopes").insert({ user_id: lookup.found.user_id, cohort_id: cohortId, granted_by: auth.ctx.user.id });
  if (error && error.code !== "23505") return dbFail(error);
  revalidatePath(`/admin/cohorts/${cohortId}`);
  revalidatePath(`/admin/users/${lookup.found.user_id}`);
  return { ok: true, message: t("admin.people.coordinatorAdded", { name: lookup.found.display_name }) };
}
