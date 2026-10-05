"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/forms";
import { t } from "@/i18n";

export async function toggleFavorite(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const offeringId = formData.get("offering_id");
  const favorite = formData.get("favorite") === "1";
  if (!isUuid(offeringId)) return { ok: false, error: t("courses.unknown") };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: t("common.sessionEnded") };
  const { error } = favorite
    ? await supabase.from("favorites").upsert({ user_id: auth.user.id, offering_id: offeringId }, { onConflict: "user_id,offering_id", ignoreDuplicates: true })
    : await supabase.from("favorites").delete().eq("user_id", auth.user.id).eq("offering_id", offeringId);
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/courses");
  revalidatePath("/activity");
  return { ok: true, message: favorite ? t("courses.favoriteAdded") : t("courses.favoriteRemoved") };
}

export async function setCoursesView(formData: FormData): Promise<void> {
  const view = formData.get("view") === "grid" ? "grid" : "list";
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  await supabase.from("profiles").update({ courses_view: view }).eq("id", auth.user.id);
  revalidatePath("/courses");
}
