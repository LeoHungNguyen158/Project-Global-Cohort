// Password strength rules shared by sign-up, reset and profile password changes. They match
// the Auth server settings in supabase/config.toml (minimum_password_length = 10,
// password_requirements = "letters_digits").

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

export type PasswordStrengthProblem = "tooShort" | "tooLong" | "letter" | "number";

export function passwordProblem(pw: string): PasswordStrengthProblem | null {
  if (pw.length < PASSWORD_MIN) return "tooShort";
  if (pw.length > PASSWORD_MAX) return "tooLong";
  if (!/[A-Za-z]/.test(pw)) return "letter";
  if (!/[0-9]/.test(pw)) return "number";
  return null;
}
