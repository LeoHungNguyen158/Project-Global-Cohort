"use server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/errors";
import { uuid } from "@/lib/forms";
import { communityPath } from "@/lib/comms/paths";
import { t } from "@/i18n";

// Community membership only. Joining or leaving a community never changes cohort
// participation or course enrollment. RLS: a person may add themselves to an open
// community they can see, and remove only themselves.

function refresh(communityId: string) {
  revalidatePath("/cohorts");
  revalidatePath(communityPath(communityId), "layout");
}

export async function joinCommunity(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: t("msg.sessionExpired") };
  const communityId = uuid(formData, "communityId");
  if (!communityId) return { ok: false, error: t("msg.invalidRequest") };
  const supabase = await createClient();
  const { error } = await supabase.from("community_members").insert({ community_id: communityId, user_id: user.id });
  // Already a member (for example after a double click): the outcome the person wanted.
  if (error && error.code !== "23505") return { ok: false, error: t("community.errJoin") };
  refresh(communityId);
  return { ok: true, message: t("community.joinedDone") };
}

export async function leaveCommunity(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: t("msg.sessionExpired") };
  const communityId = uuid(formData, "communityId");
  if (!communityId) return { ok: false, error: t("msg.invalidRequest") };
  const supabase = await createClient();
  const { error } = await supabase.from("community_members").delete().eq("community_id", communityId).eq("user_id", user.id);
  if (error) return { ok: false, error: t("community.errLeave") };
  const { data: still } = await supabase.from("community_members").select("user_id").eq("community_id", communityId).eq("user_id", user.id).maybeSingle();
  if (still) return { ok: false, error: t("community.errLeave") };
  refresh(communityId);
  return { ok: true, message: t("community.leftDone") };
}
