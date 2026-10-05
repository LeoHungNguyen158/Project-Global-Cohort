import { t } from "@/i18n";

/** Map database/RPC errors to messages safe to show users (no internals). */
export function friendlyError(err: { message?: string; code?: string } | null | undefined, fallback = t("common.errorRetry")): string {
  if (!err) return fallback;
  const code = err.code ?? "";
  if (code === "42501") return err.message && !/permission denied|row-level security/i.test(err.message) ? err.message : t("common.noPermission");
  if (code === "P0429") return t("common.tooManyRequests");
  if (code === "23505") return t("common.alreadyExists");
  if (code === "23514" || code === "22P02" || code === "23502") return t("common.invalidValues");
  if (code === "P0001" || code === "P0410" || code === "P0413" || code === "P0415" || code === "P0428") return err.message ?? fallback;
  if (/row-level security|permission denied/i.test(err.message ?? "")) return t("common.noPermission");
  return fallback;
}

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
