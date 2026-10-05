import "server-only";
import { createClient } from "@supabase/supabase-js";
import { assertPublicEnv, publicEnv, serverEnv } from "@/lib/env";

/**
 * Privileged client (secret/service-role key). Bypasses RLS, so it is used only for
 * narrowly scoped server operations AFTER the caller has been authorized:
 * sending auth invitations, verifying uploaded file signatures, and maintenance.
 * Never import this from client components.
 */
export function createAdminClient() {
  assertPublicEnv();
  const { secretKey } = serverEnv();
  if (!secretKey) {
    throw new Error("SUPABASE_SECRET_KEY is not configured; this operation requires server credentials.");
  }
  return createClient(publicEnv.supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
