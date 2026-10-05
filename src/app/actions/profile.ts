"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/forms";
import { checkBio, checkDisplayName, checkNewPassword, isProfileLocale, NOTIFICATION_KINDS, type PasswordProblem } from "@/components/profile/validation";
import { listTimeZones } from "@/components/profile/timezones";
import { t, type MessageKey } from "@/i18n";

async function signedIn() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user ?? null };
}

/** Name, bio, preferred language and time zone. Every field is validated again here and by the database. */
export async function updateProfile(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: t("profile.error.signIn") };

  const name = checkDisplayName(formData.get("display_name"));
  if (!name.ok) return { ok: false, error: t(name.error === "required" ? "profile.error.displayNameRequired" : "profile.error.displayNameTooLong") };
  const bio = checkBio(formData.get("bio"));
  if (!bio.ok) return { ok: false, error: t("profile.error.bioTooLong") };
  const locale = formData.get("locale");
  if (!isProfileLocale(locale)) return { ok: false, error: t("profile.error.locale") };
  const timezone = String(formData.get("timezone") ?? "");
  const { data: current } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
  // Offered zones, or the zone already stored (kept even if it is an older alias).
  if (!listTimeZones().includes(timezone) && timezone !== current?.timezone) return { ok: false, error: t("profile.error.timezone") };

  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: name.value, bio: bio.value, locale, timezone })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();
  if (error) {
    if (/time zone/i.test(error.message ?? "")) return { ok: false, error: t("profile.error.timezone") };
    if (/display name/i.test(error.message ?? "")) return { ok: false, error: t("profile.error.displayNameRequired") };
    return { ok: false, error: friendlyError(error, t("profile.error.saveFailed")) };
  }
  if (!data) return { ok: false, error: t("profile.error.saveFailed") };
  // The name and time zone appear on every page (navigation, dates).
  revalidatePath("/", "layout");
  return { ok: true, message: t("profile.detailsSaved") };
}

/** Uses an uploaded, verified avatar file as the profile photo. */
export async function setAvatar(assetId: string): Promise<ActionResult> {
  if (!isUuid(assetId)) return { ok: false, error: t("profile.error.photo") };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: t("profile.error.signIn") };
  const { data: asset } = await supabase.from("content_assets").select("id, owner_id, purpose, status").eq("id", assetId).maybeSingle();
  if (!asset || asset.owner_id !== user.id || asset.purpose !== "avatar") return { ok: false, error: t("profile.error.photo") };
  if (asset.status === "quarantined") return { ok: false, error: t("profile.photoHeld") };
  if (asset.status !== "ready") return { ok: false, error: t("profile.error.photo") };
  const { error } = await supabase.from("profiles").update({ avatar_asset_id: asset.id }).eq("id", user.id);
  if (error) return { ok: false, error: friendlyError(error, t("profile.error.photoFailed")) };
  revalidatePath("/", "layout");
  return { ok: true, message: t("profile.photoSaved") };
}

export async function removeAvatar(): Promise<ActionResult> {
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: t("profile.error.signIn") };
  const { error } = await supabase.from("profiles").update({ avatar_asset_id: null }).eq("id", user.id);
  if (error) return { ok: false, error: friendlyError(error, t("profile.error.photoFailed")) };
  revalidatePath("/", "layout");
  // The remove control disappears with the photo, so the confirmation is shown by the
  // page itself after this redirect.
  redirect("/profile?photo=removed#photo");
}

/** In-app notification preferences, one row per kind (private.notify honors in_app). */
export async function saveNotificationPreferences(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: t("profile.error.signIn") };
  // Email stays off: course notification emails are not configured on this platform.
  const rows = NOTIFICATION_KINDS.map((kind) => ({ user_id: user.id, kind, in_app: formData.get(`in_app_${kind}`) === "on", email: false }));
  const { error } = await supabase.from("notification_preferences").upsert(rows, { onConflict: "user_id,kind" });
  if (error) return { ok: false, error: friendlyError(error, t("profile.error.notificationsFailed")) };
  revalidatePath("/profile");
  return { ok: true, message: t("profile.notificationsSaved") };
}

const PASSWORD_ERRORS: Record<PasswordProblem, MessageKey> = {
  tooShort: "profile.error.tooShort",
  tooLong: "profile.error.tooLong",
  letter: "profile.error.letter",
  number: "profile.error.number",
  mismatch: "profile.error.mismatch",
};

/**
 * Changes the password after re-checking the current one. The check signs in with a
 * separate, non-persisted client (so the browser session is untouched) and revokes
 * that temporary session immediately.
 */
export async function changePassword(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const currentPassword = formData.get("current_password");
  const newPassword = formData.get("new_password");
  if (typeof currentPassword !== "string" || currentPassword.length === 0) return { ok: false, error: t("profile.error.currentPasswordRequired") };
  const problem = checkNewPassword(newPassword, formData.get("confirm_password"));
  if (problem) return { ok: false, error: t(PASSWORD_ERRORS[problem]) };
  if (newPassword === currentPassword) return { ok: false, error: t("profile.error.samePassword") };

  const { supabase, user } = await signedIn();
  if (!user?.email) return { ok: false, error: t("profile.error.signIn") };

  const verifier = createSupabaseClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: check, error: checkError } = await verifier.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (checkError || !check.session || check.user?.id !== user.id) {
    if (checkError?.status === 429) return { ok: false, error: t("profile.error.rateLimited") };
    return { ok: false, error: t("profile.error.currentPasswordWrong") };
  }
  await verifier.auth.signOut({ scope: "local" });

  const { error } = await supabase.auth.updateUser({ password: newPassword as string });
  if (error) {
    if (error.status === 429) return { ok: false, error: t("profile.error.rateLimited") };
    if (/different/i.test(error.message)) return { ok: false, error: t("profile.error.samePassword") };
    return { ok: false, error: t("profile.error.passwordFailed") };
  }
  return { ok: true, message: t("profile.passwordChanged") };
}
