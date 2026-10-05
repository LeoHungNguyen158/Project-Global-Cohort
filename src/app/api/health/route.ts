import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness and dependency check for uptime monitors and the Hostinger runbook.
 * Reports only coarse status; never configuration values or secrets.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let auth: "ok" | "unreachable" | "not_configured" = "not_configured";
  if (url && key) {
    try {
      const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, cache: "no-store", signal: AbortSignal.timeout(4000) });
      auth = res.ok ? "ok" : "unreachable";
    } catch {
      auth = "unreachable";
    }
  }
  const ok = auth === "ok";
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", app: "ok", supabase_auth: auth, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
