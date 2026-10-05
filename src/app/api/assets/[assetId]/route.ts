import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/forms";

const SIGNED_URL_SECONDS = 300;

/**
 * Protected file access. The asset row is read as the signed-in user (RLS decides,
 * including lesson locks and prerequisites), and the short-lived signed URL is
 * created with the same user session, so Storage policies apply a second time.
 * Responds 404 for anything the caller may not read, without revealing whether it exists.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await ctx.params;
  const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  if (!isUuid(assetId)) return notFound();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse("Sign in required", { status: 401, headers: { "Cache-Control": "private, no-store" } });

  const { data: asset } = await supabase
    .from("content_assets")
    .select("id, bucket, object_path, filename, status, owner_id")
    .eq("id", assetId)
    .maybeSingle();
  if (!asset) return notFound();
  if (asset.status !== "ready" && asset.owner_id !== auth.user.id) return notFound();

  const download = request.nextUrl.searchParams.get("download") === "1";
  const { data: signed, error } = await supabase.storage
    .from(asset.bucket)
    .createSignedUrl(asset.object_path, SIGNED_URL_SECONDS, download ? { download: asset.filename } : undefined);
  if (error || !signed) return notFound();

  const res = NextResponse.redirect(signed.signedUrl, 302);
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
