"use server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/forms";
import { signatureMatches } from "@/lib/uploads/signature";
import { t } from "@/i18n";

export type UploadPurpose = "lesson" | "submission" | "message" | "avatar";
export type RegisteredUpload = { assetId: string; bucket: string; objectPath: string; maxBytes: number };
export type FinalizedUpload = { assetId: string; status: "ready" | "quarantined" | "rejected" | "pending"; reason?: string };

const PURPOSES: UploadPurpose[] = ["lesson", "submission", "message", "avatar"];

/**
 * Step 1: record the upload as pending. The database checks the caller may upload
 * for this purpose and scope, the type is accepted and the size is within limits,
 * and returns an opaque object path the caller's session may write once.
 */
export async function registerUpload(input: {
  purpose: UploadPurpose;
  filename: string;
  mime: string;
  size: number;
  offeringId?: string | null;
  courseVersionId?: string | null;
}): Promise<ActionResult<RegisteredUpload>> {
  if (!PURPOSES.includes(input.purpose)) return { ok: false, error: t("common.uploadUnknownType") };
  const filename = String(input.filename ?? "").trim();
  if (!filename || filename.length > 255 || /[/\\]/.test(filename)) return { ok: false, error: t("common.uploadBadName") };
  if (!Number.isSafeInteger(input.size) || input.size <= 0) return { ok: false, error: t("common.uploadEmpty") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_upload", {
    p_purpose: input.purpose,
    p_filename: filename,
    p_mime: String(input.mime ?? "").slice(0, 200),
    p_size: input.size,
    p_offering: isUuid(input.offeringId) ? input.offeringId : null,
    p_course_version: isUuid(input.courseVersionId) ? input.courseVersionId : null,
  });
  if (error || !data) return { ok: false, error: friendlyError(error, t("common.uploadCouldNotStart")) };
  return { ok: true, data: { assetId: data.asset_id, bucket: data.bucket, objectPath: data.object_path, maxBytes: Number(data.max_bytes) } };
}

/** Reads at most `limit` bytes from the start of a stored object without downloading it all. */
async function readHead(url: string, limit = 4096): Promise<Uint8Array> {
  const controller = new AbortController();
  const res = await fetch(url, { headers: { Range: `bytes=0-${limit - 1}` }, cache: "no-store", signal: controller.signal });
  if (!res.ok || !res.body) throw new Error(`read failed: ${res.status}`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < limit) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  // Abort rather than reader.cancel(): cancelling a partly read body never settles in the
  // Next.js server runtime, which left every upload over 4 KB stuck at "Checking file…".
  controller.abort();
  const out = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, out.length - offset);
    out.set(c.subarray(0, take), offset);
    offset += take;
    if (offset >= out.length) break;
  }
  return out;
}

/**
 * Step 3 (after the browser uploaded the object directly to private storage):
 * verify the stored object's size and file signature on the server, then mark the
 * asset ready (or quarantined when uploads are held for review). Mismatches are
 * rejected and the stored object is deleted. Safe to call more than once.
 */
export async function finalizeUpload(assetId: string): Promise<ActionResult<FinalizedUpload>> {
  if (!isUuid(assetId)) return { ok: false, error: t("common.uploadUnknown") };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: t("common.uploadSessionEnded") };
  // The owner can always read their own asset row (RLS); nobody else's is visible here.
  const { data: asset } = await supabase
    .from("content_assets")
    .select("id, owner_id, bucket, object_path, declared_mime, size_bytes, status")
    .eq("id", assetId)
    .maybeSingle();
  if (!asset || asset.owner_id !== auth.user.id) return { ok: false, error: t("common.uploadUnknown") };
  if (asset.status !== "pending") return { ok: true, data: { assetId, status: asset.status } };

  // Authorized above; the privileged client is used only to inspect and update this one object.
  const admin = createAdminClient();
  const reject = async (reason: string): Promise<ActionResult<FinalizedUpload>> => {
    await admin.storage.from(asset.bucket).remove([asset.object_path]);
    await admin.from("content_assets").update({ status: "rejected", rejection_reason: reason }).eq("id", asset.id).eq("status", "pending");
    return { ok: true, data: { assetId, status: "rejected", reason } };
  };

  const [prefix, folder, name] = asset.object_path.split("/");
  const { data: listing, error: listError } = await admin.storage.from(asset.bucket).list(`${prefix}/${folder}`, { search: name, limit: 5 });
  if (listError) return { ok: false, error: t("common.uploadVerifyRetry") };
  const stored = listing?.find((o) => o.name === name);
  if (!stored) return { ok: false, error: t("common.uploadIncomplete") };
  const storedSize = Number((stored.metadata as { size?: number } | null)?.size ?? -1);
  if (storedSize !== Number(asset.size_bytes)) return reject(t("common.uploadSizeMismatch"));

  const { data: signed, error: signError } = await admin.storage.from(asset.bucket).createSignedUrl(asset.object_path, 60);
  if (signError || !signed) return { ok: false, error: t("common.uploadVerifyRetry") };
  let head: Uint8Array;
  try {
    head = await readHead(signed.signedUrl);
  } catch {
    return { ok: false, error: t("common.uploadVerifyRetry") };
  }
  if (!signatureMatches(asset.declared_mime, head)) return reject(t("common.uploadTypeMismatch"));

  const status = serverEnv().uploadScanMode === "quarantine" ? "quarantined" : "ready";
  const { error: updateError } = await admin
    .from("content_assets")
    .update({ status, detected_mime: asset.declared_mime, completed_at: new Date().toISOString() })
    .eq("id", asset.id)
    .eq("status", "pending");
  if (updateError) return { ok: false, error: t("common.uploadVerifyRetry") };
  return { ok: true, data: { assetId, status } };
}
