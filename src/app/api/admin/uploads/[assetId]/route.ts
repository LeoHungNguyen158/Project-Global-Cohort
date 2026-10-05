import { NextResponse } from "next/server";
import { adminForRequest } from "@/lib/admin/access";
import { isUuid } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const NO_STORE = { "Cache-Control": "private, no-store" };
const SIGNED_URL_SECONDS = 120;

/**
 * Lets a platform administrator download a quarantined upload to review it. The
 * caller's own session must see the file in the review queue (platform administrators
 * only, checked by the database) before the privileged client signs a short-lived,
 * download-only link. Everyone else gets 404.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await ctx.params;
  const notFound = () => new NextResponse("Not found", { status: 404, headers: NO_STORE });
  if (!isUuid(assetId)) return notFound();
  const admin = await adminForRequest();
  if (!admin?.isPlatformAdmin) return notFound();

  const supabase = await createClient();
  const { data: queue, error } = await supabase.rpc("admin_list_quarantined_assets");
  if (error || !((queue ?? []) as { id: string }[]).some((a) => a.id === assetId)) return notFound();

  const service = createAdminClient();
  const { data: asset } = await service.from("content_assets").select("bucket, object_path, filename, status").eq("id", assetId).maybeSingle();
  if (!asset || asset.status !== "quarantined") return notFound();
  const { data: signed, error: signError } = await service.storage
    .from(asset.bucket)
    .createSignedUrl(asset.object_path, SIGNED_URL_SECONDS, { download: asset.filename });
  if (signError || !signed) return notFound();

  const res = NextResponse.redirect(signed.signedUrl, 302);
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
