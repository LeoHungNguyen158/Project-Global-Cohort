import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { normalizeSupportEmail, normalizeSupportUrl } from "./text";

export type SiteSettings = {
  supportEmail: string | null;
  supportUrl: string | null;
  publicCatalog: boolean;
};

/**
 * Public platform settings (support contact, public catalog switch). Works signed in
 * and signed out through the public_site_settings() database function, which returns
 * only these keys. Returns null when the settings could not be read, so pages can
 * show an error state instead of guessing.
 */
export const getSiteSettings = cache(async (): Promise<SiteSettings | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_site_settings");
  if (error || !data || typeof data !== "object") return null;
  const raw = data as { support_email?: unknown; support_url?: unknown; public_catalog?: unknown };
  return {
    supportEmail: normalizeSupportEmail(raw.support_email),
    supportUrl: normalizeSupportUrl(raw.support_url),
    publicCatalog: raw.public_catalog === true,
  };
});
