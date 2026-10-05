/** Map database/RPC errors to messages safe to show users (no internals). */
export function friendlyError(err: { message?: string; code?: string } | null | undefined, fallback = "Something went wrong. Please try again."): string {
  if (!err) return fallback;
  const code = err.code ?? "";
  if (code === "42501") return err.message && !/permission denied|row-level security/i.test(err.message) ? err.message : "You do not have permission to do that.";
  if (code === "P0429") return "Too many requests. Please wait a little and try again.";
  if (code === "23505") return "That already exists.";
  if (code === "23514" || code === "22P02" || code === "23502") return "Some values are not valid. Check the form and try again.";
  if (code === "P0001" || code === "P0410" || code === "P0413" || code === "P0415" || code === "P0428") return err.message ?? fallback;
  if (/row-level security|permission denied/i.test(err.message ?? "")) return "You do not have permission to do that.";
  return fallback;
}

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
