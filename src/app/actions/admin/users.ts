"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, uuid } from "@/lib/forms";
import type { ActionResult } from "@/lib/errors";
import { actionAdmin, dbFail, fail } from "@/lib/admin/action-utils";
import { t } from "@/i18n";

const ROLES = ["platform_admin", "coordinator"] as const;
type PlatformRole = (typeof ROLES)[number];

function refresh(userId: string) {
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
  revalidatePath("/admin");
}

/** Grants or removes a platform role (platform administrators only; audited by the database). */
export async function setPlatformRole(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin({ platform: true });
  if ("denied" in auth) return auth.denied;
  const userId = uuid(formData, "user");
  const role = str(formData, "role", 32) as PlatformRole;
  const grant = str(formData, "grant", 1) === "1";
  if (!userId || !ROLES.includes(role)) return fail(t("admin.common.invalidRequest"));

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_role", { p_user: userId, p_role: role, p_grant: grant });
  if (error) return dbFail(error);
  refresh(userId);
  const roleLabel = t(`admin.roles.${role}`);
  return { ok: true, message: grant ? t("admin.user.roleGranted", { role: roleLabel }) : t("admin.user.roleRemoved", { role: roleLabel }) };
}

/** Suspends or reactivates an account with a recorded reason. Takes effect on the person's next request. */
export async function setAccountSuspension(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin({ platform: true });
  if ("denied" in auth) return auth.denied;
  const userId = uuid(formData, "user");
  const suspend = str(formData, "suspend", 1) === "1";
  const reason = str(formData, "reason", 600);
  if (!userId) return fail(t("admin.common.invalidRequest"));
  if (reason.length < 3 || reason.length > 500) return fail(t("admin.user.reasonRequired"), { reason: t("admin.user.reasonRequired") });

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_account_suspension", { p_user: userId, p_suspend: suspend, p_reason: reason });
  if (error) return dbFail(error);
  refresh(userId);
  return { ok: true, message: suspend ? t("admin.user.suspended") : t("admin.user.reactivated") };
}

/** Gives a coordinator responsibility for one more cohort. */
export async function addCoordinatorScope(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin({ platform: true });
  if ("denied" in auth) return auth.denied;
  const userId = uuid(formData, "user");
  const cohortId = uuid(formData, "cohort");
  if (!userId) return fail(t("admin.common.invalidRequest"));
  if (!cohortId) return fail(t("admin.user.chooseCohort"), { cohort: t("admin.user.chooseCohort") });

  const supabase = await createClient();
  const { error } = await supabase
    .from("coordinator_scopes")
    .insert({ user_id: userId, cohort_id: cohortId, granted_by: auth.ctx.user.id });
  if (error) return error.code === "23505" ? fail(t("admin.user.scopeExists")) : dbFail(error);
  refresh(userId);
  revalidatePath(`/admin/cohorts/${cohortId}`);
  return { ok: true, message: t("admin.user.scopeAdded") };
}

export async function removeCoordinatorScope(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin({ platform: true });
  if ("denied" in auth) return auth.denied;
  const userId = uuid(formData, "user");
  const cohortId = uuid(formData, "cohort");
  if (!userId || !cohortId) return fail(t("admin.common.invalidRequest"));

  const supabase = await createClient();
  const { data, error } = await supabase.from("coordinator_scopes").delete().eq("user_id", userId).eq("cohort_id", cohortId).select("cohort_id");
  if (error) return dbFail(error);
  if (!data || data.length === 0) return fail(t("admin.common.notFound"));
  refresh(userId);
  revalidatePath(`/admin/cohorts/${cohortId}`);
  return { ok: true, message: t("admin.user.scopeRemoved") };
}
