"use client";
import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

let client: ReturnType<typeof createBrowserClient> | undefined;

/** Browser client: used only for direct-to-storage uploads with the user's own session. */
export function getBrowserClient() {
  if (!client) {
    client = createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey);
  }
  return client;
}
