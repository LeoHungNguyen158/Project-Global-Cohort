// Central, validated access to environment configuration.
// NEXT_PUBLIC_* values are inlined into browser bundles at build time.

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
};

export function assertPublicEnv() {
  if (!publicEnv.supabaseUrl || !publicEnv.supabasePublishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. See .env.example and docs/SETUP.md.",
    );
  }
}

export type AppEnv = "development" | "staging" | "production";

export function serverEnv() {
  const appEnv = (process.env.APP_ENV ?? "development") as AppEnv;
  return {
    appEnv,
    appBaseUrl: (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    secretKey: process.env.SUPABASE_SECRET_KEY ?? "",
    uploadScanMode: (process.env.UPLOAD_SCAN_MODE === "quarantine" ? "quarantine" : "none") as "none" | "quarantine",
  };
}
