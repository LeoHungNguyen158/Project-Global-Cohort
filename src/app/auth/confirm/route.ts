import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";

const TYPES: EmailOtpType[] = ["invite", "recovery", "email", "signup", "email_change", "magiclink"];

/**
 * Verifies email links (invite, recovery, confirmation) on the server and sets the
 * session cookie. Invitation and recovery links continue to the password form.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(url.searchParams.get("next"), "/activity");
  const fail = new URL("/login?error=link", url.origin);
  if (!tokenHash || !type || !TYPES.includes(type)) return NextResponse.redirect(fail);

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(fail);

  if (type === "invite") {
    return NextResponse.redirect(new URL(`/reset-password?invite=1&next=${encodeURIComponent(next)}`, url.origin));
  }
  if (type === "recovery") {
    return NextResponse.redirect(new URL("/reset-password", url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
