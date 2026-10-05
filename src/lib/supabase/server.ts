import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { assertPublicEnv, publicEnv } from "@/lib/env";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * User-scoped Supabase client for Server Components, Server Actions and Route
 * Handlers. Every query runs as the signed-in user, so PostgreSQL RLS applies.
 */
export async function createClient(): Promise<SupabaseClient> {
  assertPublicEnv();
  const cookieStore = await cookies();
  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are refreshed by the proxy instead.
        }
      },
    },
  });
}
