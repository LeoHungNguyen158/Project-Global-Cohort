"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { optStr, str, uuid } from "@/lib/forms";
import type { ActionResult } from "@/lib/errors";
import { actionAdmin, dbFail, fail } from "@/lib/admin/action-utils";
import { canAdminCohort, type AdminContext } from "@/lib/admin/access";
import { getAdminCommunity } from "@/lib/admin/data";
import { validateCommunity, type CommunityInput } from "@/lib/admin/validation";
import { isValidEmail, normalizeEmail } from "@/lib/admin/import";
import { t, type MessageKey } from "@/i18n";

// Communities: platform administrators manage all of them; cohort coordinators manage the
// communities of their cohorts (the communities_write policy and the admin_*_community_member
// functions enforce the same rule). Changes are audited by the database. Community membership
// never changes cohort participation, enrollments or staff assignments.

const FIELD_ERRORS: Record<string, MessageKey> = {
  name: "admin.communities.error.name",
  description: "admin.communities.error.description",
  joinPolicy: "admin.communities.error.joinPolicy",
  cohort: "admin.communities.error.cohort",
};

function readCommunity(formData: FormData): CommunityInput {
  return {
    name: str(formData, "name", 300),
    description: str(formData, "description", 2100),
    cohortId: optStr(formData, "cohort", 64),
    joinPolicy: str(formData, "join_policy", 20),
  };
}

function invalid(errors: Record<string, string>) {
  const fieldErrors = Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, t(FIELD_ERRORS[v] ?? "admin.common.failed")]));
  return fail(Object.values(fieldErrors)[0], fieldErrors);
}

/** Program-wide (no cohort) needs a platform administrator; otherwise one of the caller's cohorts. */
function checkCohortChoice(ctx: AdminContext, input: CommunityInput, errors: Record<string, string>) {
  if (input.cohortId === null) {
    if (!ctx.isPlatformAdmin) errors.cohort = "cohort";
  } else if (!/^[0-9a-f-]{36}$/i.test(input.cohortId) || !canAdminCohort(ctx, input.cohortId)) {
    errors.cohort = "cohort";
  }
}

function communityFail(error: { code?: string; message?: string; hint?: string }) {
  if (error.hint === "community_members_outside_cohort") {
    const message = t("admin.communities.error.membersOutsideCohort");
    return fail(message, { cohort: message });
  }
  return dbFail(error);
}

export async function createCommunity(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const input = readCommunity(formData);
  const errors = validateCommunity(input);
  checkCohortChoice(auth.ctx, input, errors);
  if (Object.keys(errors).length > 0) return invalid(errors);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communities")
    .insert({
      name: input.name,
      description: input.description,
      cohort_id: input.cohortId,
      join_policy: input.joinPolicy,
      created_by: auth.ctx.user.id,
    })
    .select("id")
    .single();
  if (error) return dbFail(error);
  revalidatePath("/admin/communities");
  revalidatePath("/cohorts");
  redirect(`/admin/communities/${data.id}?created=1`);
}

export async function updateCommunity(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const communityId = uuid(formData, "community");
  const current = communityId ? await getAdminCommunity(auth.ctx, communityId) : null;
  if (!current) return fail(t("admin.common.notFound"));
  const input = readCommunity(formData);
  const errors = validateCommunity(input);
  // Keeping the current cohort is always allowed (it may be archived by now).
  if (input.cohortId !== current.cohort_id) checkCohortChoice(auth.ctx, input, errors);
  if (Object.keys(errors).length > 0) return invalid(errors);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communities")
    .update({ name: input.name, description: input.description, cohort_id: input.cohortId, join_policy: input.joinPolicy })
    .eq("id", current.id)
    .select("id");
  if (error) return communityFail(error);
  if (!data || data.length === 0) return fail(t("admin.common.notFound"));
  revalidatePath(`/admin/communities/${current.id}`);
  revalidatePath("/admin/communities");
  revalidatePath("/cohorts");
  return { ok: true, message: t("admin.communities.saved") };
}

type Found = { user_id: string; display_name: string; email_confirmed: boolean; suspended: boolean };

/**
 * Adds a person: chosen from the cohort's people (`user`) or, for program-wide communities,
 * an existing account found by email address (`email`, platform administrators only).
 */
export async function addCommunityMember(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const communityId = uuid(formData, "community");
  const community = communityId ? await getAdminCommunity(auth.ctx, communityId) : null;
  if (!community) return fail(t("admin.common.notFound"));
  const supabase = await createClient();

  let userId = uuid(formData, "user");
  let name = "";
  if (!userId) {
    const email = normalizeEmail(str(formData, "email", 320));
    if (!isValidEmail(email)) return fail(t("admin.invite.error.email"), { email: t("admin.invite.error.email") });
    const { data, error } = await supabase.rpc("admin_find_user", { p_email: email, p_cohort: community.cohort_id });
    if (error) return dbFail(error);
    const found = ((data ?? []) as Found[])[0];
    if (!found) return fail(t("admin.people.noAccount"));
    if (found.suspended) return fail(t("admin.people.accountSuspended"));
    userId = found.user_id;
    name = found.display_name;
  }

  const { data: outcome, error } = await supabase.rpc("admin_add_community_member", { p_community: community.id, p_user: userId });
  if (error) return dbFail(error);
  if (!name) {
    const { data: people } = await supabase.rpc("admin_community_people", { p_community: community.id });
    name = ((people ?? []) as { user_id: string; display_name: string }[]).find((p) => p.user_id === userId)?.display_name ?? "";
  }
  switch (outcome as string) {
    case "added":
      revalidatePath(`/admin/communities/${community.id}`);
      revalidatePath("/admin/communities");
      return { ok: true, message: t("admin.community.added", { name }) };
    case "already_member":
      return fail(t("admin.community.alreadyMember", { name }));
    case "suspended":
      return fail(t("admin.people.accountSuspended"));
    case "not_in_cohort":
      return fail(t("admin.community.notInCohort"));
    default:
      return fail(t("admin.people.noAccount"));
  }
}

export async function removeCommunityMember(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const communityId = uuid(formData, "community");
  const userId = uuid(formData, "user");
  if (!communityId || !userId) return fail(t("admin.common.invalidRequest"));
  const community = await getAdminCommunity(auth.ctx, communityId);
  if (!community) return fail(t("admin.common.notFound"));

  const supabase = await createClient();
  const { data: removed, error } = await supabase.rpc("admin_remove_community_member", { p_community: community.id, p_user: userId });
  if (error) return dbFail(error);
  if (!removed) return fail(t("admin.community.notMember"));
  revalidatePath(`/admin/communities/${community.id}`);
  revalidatePath("/admin/communities");
  return { ok: true, message: t("admin.community.removed") };
}
