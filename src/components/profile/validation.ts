import { cleanText } from "@/components/public/text";
import { passwordProblem } from "@/lib/password";

// Profile field rules, shared by the profile server actions and their unit tests.

export const DISPLAY_NAME_MAX = 120;
export const BIO_MAX = 2000;

export const PROFILE_LOCALES = ["en", "vi"] as const;
export type ProfileLocale = (typeof PROFILE_LOCALES)[number];

export function isProfileLocale(value: unknown): value is ProfileLocale {
  return typeof value === "string" && (PROFILE_LOCALES as readonly string[]).includes(value);
}

type Checked<E extends string> = { ok: true; value: string } | { ok: false; error: E };

/** Display names keep every letter people type (Vietnamese diacritics included), stored as NFC. */
export function checkDisplayName(raw: unknown): Checked<"required" | "tooLong"> {
  const value = cleanText(typeof raw === "string" ? raw : "").replace(/\s+/g, " ");
  if (!value) return { ok: false, error: "required" };
  if (Array.from(value).length > DISPLAY_NAME_MAX) return { ok: false, error: "tooLong" };
  return { ok: true, value };
}

export function checkBio(raw: unknown): Checked<"tooLong"> {
  const value = cleanText(typeof raw === "string" ? raw : "", { multiline: true });
  if (Array.from(value).length > BIO_MAX) return { ok: false, error: "tooLong" };
  return { ok: true, value };
}

export type PasswordProblem = "tooShort" | "tooLong" | "letter" | "number" | "mismatch";

/** The shared strength rules in src/lib/password.ts, plus the confirmation match. */
export function checkNewPassword(password: unknown, confirm: unknown): PasswordProblem | null {
  const pw = typeof password === "string" ? password : "";
  const problem = passwordProblem(pw);
  if (problem) return problem;
  if (pw !== confirm) return "mismatch";
  return null;
}

/** Notification kinds people can switch off (the ones the platform actually sends). */
export const NOTIFICATION_KINDS = ["announcement", "content", "grade", "submission", "message", "access_request", "invitation"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
