"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { str, uuid } from "@/lib/forms";
import type { ActionResult } from "@/lib/errors";
import { actionAdmin, dbFail, fail } from "@/lib/admin/action-utils";
import { t } from "@/i18n";

/** Approves (enrolls the requester and notifies them) or declines a pending access request. */
export async function reviewAccessRequest(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const requestId = uuid(formData, "request");
  const decision = str(formData, "decision", 10);
  const note = str(formData, "note", 2100);
  if (!requestId || !["approve", "decline"].includes(decision)) return fail(t("admin.common.invalidRequest"));
  if (note.length > 2000) return fail(t("admin.requests.noteTooLong"));

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_access_request", { p_request: requestId, p_approve: decision === "approve", p_note: note });
  if (error) return dbFail(error);
  revalidatePath("/admin/access-requests");
  revalidatePath("/admin");
  return { ok: true, message: decision === "approve" ? t("admin.requests.approved") : t("admin.requests.declined") };
}
