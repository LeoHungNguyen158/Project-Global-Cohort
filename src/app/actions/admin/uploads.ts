"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { str, uuid } from "@/lib/forms";
import { actionAdmin, dbFail, fail } from "@/lib/admin/action-utils";
import type { NoticeResult } from "@/components/admin/result-form";
import { t } from "@/i18n";

/**
 * Releases a quarantined upload (it becomes available where it was attached) or rejects
 * it with a reason. The database authorizes and audits the decision; only after that is
 * the rejected file's stored object deleted with the privileged storage client.
 */
export async function reviewUpload(_prev: NoticeResult | null, formData: FormData): Promise<NoticeResult> {
  const auth = await actionAdmin({ platform: true });
  if ("denied" in auth) return auth.denied;
  const assetId = uuid(formData, "asset");
  const decision = str(formData, "decision", 10);
  const reason = str(formData, "reason", 600);
  if (!assetId || !["release", "reject"].includes(decision)) return fail(t("admin.common.invalidRequest"));
  const release = decision === "release";
  if (!release && (reason.length < 3 || reason.length > 500)) return fail(t("admin.uploads.reasonInvalid"), { reason: t("admin.uploads.reasonInvalid") });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_review_asset", { p_asset: assetId, p_release: release, p_reason: release ? "" : reason });
  if (error) return dbFail(error);
  revalidatePath("/admin/uploads");
  revalidatePath("/admin");
  if (release) return { ok: true, message: t("admin.uploads.released") };

  const stored = data as { bucket: string; object_path: string };
  const { error: removeError } = await createAdminClient().storage.from(stored.bucket).remove([stored.object_path]);
  if (removeError) {
    return { ok: true, message: t("admin.uploads.rejectedKept"), data: { tone: "warning" } };
  }
  return { ok: true, message: t("admin.uploads.rejected") };
}
