import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import { updatePassword } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { t } from "@/i18n";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return (
      <>
        <h1 className="mb-4 text-2xl font-semibold">{t("auth.resetTitle")}</h1>
        <Alert tone="error">{t("auth.linkInvalid")}</Alert>
        <p className="mt-6 text-sm"><Link className="text-primary underline" href="/forgot-password">Request a new link</Link></p>
      </>
    );
  }
  const next = safeNextPath(sp.next, "/activity");
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold">{sp.invite ? "Set your password" : t("auth.resetTitle")}</h1>
      <p className="mb-6 text-sm text-muted">Signed in as {data.user.email}. {t("auth.passwordRules")}</p>
      <ActionForm action={updatePassword} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field label={t("auth.newPassword")} htmlFor="password" required hint={t("auth.passwordRules")}>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required aria-describedby="password-hint" />
        </Field>
        <Field label={t("auth.confirmPassword")} htmlFor="confirm" required>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <SubmitButton className="w-full">Save password</SubmitButton>
      </ActionForm>
    </>
  );
}
