"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { uuid } from "@/lib/forms";
import { cleanText } from "@/components/public/text";
import { t } from "@/i18n";

const MESSAGE_MAX = 2000;

/**
 * Sends a reviewable access request for a catalog offering. It never enrolls anyone:
 * request_access() only records a pending request that program staff approve or decline.
 */
export async function requestAccess(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const offeringId = uuid(formData, "offering_id");
  if (!offeringId) return { ok: false, error: t("catalog.error.unknown") };
  const raw = formData.get("message");
  const message = cleanText(typeof raw === "string" ? raw : "", { multiline: true });
  if (Array.from(message).length > MESSAGE_MAX) return { ok: false, error: t("catalog.error.messageTooLong") };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: t("catalog.error.signIn") };

  // A second request while one is pending is refused (the database also keeps at most one).
  const { data: pending } = await supabase
    .from("access_requests")
    .select("id")
    .eq("offering_id", offeringId)
    .eq("user_id", auth.user.id)
    .eq("status", "pending")
    .limit(1);
  if (pending && pending.length > 0) return { ok: false, error: t("catalog.error.alreadyPending") };

  const { error } = await supabase.rpc("request_access", { p_offering: offeringId, p_message: message });
  if (error) {
    if (/enrollment record/i.test(error.message ?? "")) return { ok: false, error: t("catalog.error.enrollmentExists") };
    if (/not open for access requests/i.test(error.message ?? "")) return { ok: false, error: t("catalog.error.notOpen") };
    return { ok: false, error: friendlyError(error, t("catalog.error.requestFailed")) };
  }
  revalidatePath("/catalog");
  return { ok: true, message: t("catalog.requestSent") };
}

/** Withdraws the caller's own pending request (withdraw_access_request checks ownership). */
export async function withdrawAccessRequest(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const requestId = uuid(formData, "request_id");
  if (!requestId) return { ok: false, error: t("catalog.error.unknown") };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: t("catalog.error.signIn") };
  const { error } = await supabase.rpc("withdraw_access_request", { p_request: requestId });
  if (error) {
    if (/already been reviewed or withdrawn/i.test(error.message ?? "")) return { ok: false, error: t("catalog.error.alreadyReviewed") };
    return { ok: false, error: friendlyError(error, t("catalog.error.withdrawFailed")) };
  }
  revalidatePath("/catalog");
  return { ok: true, message: t("catalog.withdrawn") };
}
