import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import { signIn } from "@/app/actions/auth";
import { safeNextPath } from "@/lib/safe-redirect";
import { t } from "@/i18n";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold">{t("auth.signIn")}</h1>
      <p className="mb-6 text-sm text-muted">{t("auth.inviteOnly")}</p>
      {sp.error === "inactive" ? <Alert tone="error" className="mb-4">{t("auth.inactive")}</Alert> : null}
      {sp.error === "link" ? <Alert tone="error" className="mb-4">{t("auth.linkInvalid")}</Alert> : null}
      {sp.signed_out ? <Alert tone="success" className="mb-4">You have signed out.</Alert> : null}
      {sp.password_updated ? <Alert tone="success" className="mb-4">{t("auth.resetDone")}</Alert> : null}
      <ActionForm action={signIn} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field label={t("auth.email")} htmlFor="email" required>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label={t("auth.password")} htmlFor="password" required>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full" pendingText={t("auth.signingIn")}>{t("auth.signIn")}</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm">
        <Link href="/forgot-password" className="text-primary underline">{t("auth.forgot")}</Link>
      </p>
    </>
  );
}
