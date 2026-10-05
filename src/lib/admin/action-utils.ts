import "server-only";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { t } from "@/i18n";
import { adminForRequest, type AdminContext } from "./access";

export type Fail = { ok: false; error: string; fieldErrors?: Record<string, string> };

export function fail(error: string, fieldErrors?: Record<string, string>): Fail {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

/** Maps a database error to a safe message; P0001 raises carry deliberate wording. */
export function dbFail(error: { message?: string; code?: string } | null | undefined): Fail {
  return fail(friendlyError(error, t("admin.common.failed")));
}

/**
 * Resolves the calling administrator for a server action. The database authorizes the
 * operation again; this only avoids doing work for people who are not administrators.
 */
export async function actionAdmin(options: { platform?: boolean } = {}): Promise<{ ctx: AdminContext } | { denied: Fail }> {
  const ctx = await adminForRequest();
  if (!ctx || (options.platform && !ctx.isPlatformAdmin)) return { denied: fail(t("admin.common.notAllowed")) };
  return { ctx };
}

export type { ActionResult };
