"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { bool, str } from "@/lib/forms";
import type { ActionResult } from "@/lib/errors";
import { actionAdmin, dbFail, fail } from "@/lib/admin/action-utils";
import { isUploadPurpose, typeAllowedFor, validateSettings } from "@/lib/admin/settings";
import { megabytesToBytes } from "@/lib/admin/validation";
import { t } from "@/i18n";

/** Saves the program name, support contact and public catalog switch (audited by the database). */
export async function updateSettings(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin({ platform: true });
  if ("denied" in auth) return auth.denied;
  const input = {
    programName: str(formData, "program_name", 200),
    supportEmail: str(formData, "support_email", 400),
    supportUrl: str(formData, "support_url", 600),
  };
  const errors = validateSettings(input);
  const first = Object.entries(errors)[0];
  if (first) {
    const fieldErrors = Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, t(`admin.settings.error.${v}`)]));
    return fail(fieldErrors[first[0]], fieldErrors);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_update_settings", {
    p_program_name: input.programName,
    p_support_email: input.supportEmail,
    p_support_url: input.supportUrl,
    p_public_catalog: bool(formData, "public_catalog"),
  });
  if (error) return dbFail(error);
  const changed = Number(data ?? 0);
  // Support contact and catalog visibility appear on public pages too.
  revalidatePath("/", "layout");
  return { ok: true, message: changed === 0 ? t("admin.settings.noChanges") : t("admin.settings.saved", { count: changed }) };
}

/** Allows a verifiable file type for an upload purpose, or changes its size limit. */
export async function setUploadLimit(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin({ platform: true });
  if ("denied" in auth) return auth.denied;
  const purpose = str(formData, "purpose", 20);
  const mime = str(formData, "mime", 120);
  const bytes = megabytesToBytes(str(formData, "max_mb", 20));
  if (!isUploadPurpose(purpose) || !typeAllowedFor(purpose, mime)) return fail(t("admin.settings.error.type"));
  if (bytes === null) return fail(t("admin.settings.error.size"), { max_mb: t("admin.settings.error.size") });
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_upload_limit", { p_purpose: purpose, p_mime: mime, p_max_bytes: bytes });
  if (error) return dbFail(error);
  revalidatePath("/admin/settings");
  return { ok: true, message: t("admin.settings.limitSaved") };
}

/** Stops accepting a file type for an upload purpose (existing files are not touched). */
export async function removeUploadLimit(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin({ platform: true });
  if ("denied" in auth) return auth.denied;
  const purpose = str(formData, "purpose", 20);
  const mime = str(formData, "mime", 120);
  if (!isUploadPurpose(purpose)) return fail(t("admin.common.invalidRequest"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_upload_limit", { p_purpose: purpose, p_mime: mime });
  if (error) return dbFail(error);
  revalidatePath("/admin/settings");
  return { ok: true, message: t("admin.settings.limitRemoved") };
}
