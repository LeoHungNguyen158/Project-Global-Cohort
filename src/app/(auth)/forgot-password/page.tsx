import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { requestPasswordReset } from "@/app/actions/auth";
import { t } from "@/i18n";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold">{t("auth.forgotTitle")}</h1>
      <p className="mb-6 text-sm text-muted">Enter the email address you use for this workspace. We will email you a link to choose a new password.</p>
      <ActionForm action={requestPasswordReset} className="space-y-4">
        <Field label={t("auth.email")} htmlFor="email" required>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <SubmitButton className="w-full" pendingText="Sending…">{t("auth.sendReset")}</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm"><Link className="text-primary underline" href="/login">Back to sign in</Link></p>
    </>
  );
}
