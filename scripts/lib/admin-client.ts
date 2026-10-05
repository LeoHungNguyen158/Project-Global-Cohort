import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isLocalUrl, requireEnv } from "./db";

/**
 * Service client for operator commands. The secret key bypasses row-level security, so
 * these commands run only from an authorized workstation or CI job, never from the web
 * server, and print what they target before changing anything.
 */
export function adminClient(): SupabaseClient {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function targetDescription(): string {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  return `${new URL(url).host}${isLocalUrl(url) ? " (local stack)" : ""}`;
}
