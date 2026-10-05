"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { serverEnv } from "@/lib/env";
import type { ActionResult } from "@/lib/errors";
import { t, type MessageKey } from "@/i18n";
import { passwordProblem, type PasswordStrengthProblem } from "@/lib/password";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login?signed_out=1");
}

const loginSchema = z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(200) });

export async function signIn(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, error: t("auth.enterCredentials") };
  const supabase = await createClient();
  const { data: signedIn, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !signedIn.user) {
    if (error?.status === 429) return { ok: false, error: t("auth.tooManySignIns") };
    return { ok: false, error: t("auth.invalid") };
  }
  const { data: profile } = await supabase.from("profiles").select("suspended_at").eq("id", signedIn.user.id).maybeSingle();
  if (!profile || profile.suspended_at) {
    await supabase.auth.signOut();
    return { ok: false, error: t("auth.inactive") };
  }
  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function requestPasswordReset(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  const email = z.string().trim().email().max(320).safeParse(formData.get("email"));
  if (!email.success) return { ok: false, error: t("auth.enterValidEmail") };
  const supabase = await createClient();
  const { appBaseUrl } = serverEnv();
  // The recovery email template links to /auth/confirm with a token hash.
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, { redirectTo: `${appBaseUrl}/reset-password` });
  if (error && error.status === 429) return { ok: false, error: t("auth.tooManyResets") };
  // Same response whether or not the account exists (no account enumeration).
  return { ok: true, message: t("auth.resetSent") };
}

const PASSWORD_MESSAGES = {
  tooShort: "auth.pwMin",
  tooLong: "auth.pwInvalid",
  letter: "auth.pwLetter",
  number: "auth.pwNumber",
} as const satisfies Record<PasswordStrengthProblem, MessageKey>;

export async function updatePassword(_prev: ActionResult<unknown> | null, formData: FormData): Promise<ActionResult<unknown>> {
  const raw = formData.get("password");
  const password = typeof raw === "string" ? raw : "";
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: t(PASSWORD_MESSAGES[problem]) };
  if (formData.get("password") !== formData.get("confirm")) return { ok: false, error: t("auth.pwMismatch") };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: t("auth.linkInvalid") };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, error: error.message.includes("different") ? t("auth.pwSame") : t("auth.pwFailed") };
  const next = safeNextPath(String(formData.get("next") ?? ""), "/activity");
  redirect(`${next}${next.includes("?") ? "&" : "?"}password_updated=1`);
}
