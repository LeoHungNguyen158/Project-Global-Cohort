import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatBytes } from "@/lib/uploads/mime";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Table, td, th } from "@/components/ui/table";
import { DocSection, OnThisPage } from "@/components/public/doc-page";
import { SupportContact } from "@/components/public/support-contact";
import { getSiteSettings } from "@/components/public/site-settings";
import { fileTypeLabelKey, sortByFileType } from "@/components/public/file-types";
import { tx } from "@/components/public/rich-t";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("help.title") };

const link = "text-primary underline underline-offset-2";

// Public page: works signed in and signed out (no requireUser).
export default async function HelpPage() {
  const [user, settings] = await Promise.all([getCurrentUser(), getSiteSettings()]);

  let limits: { mime: string; max_bytes: number }[] | null = null;
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase.from("upload_limits").select("mime, max_bytes").eq("purpose", "submission");
    limits = sortByFileType((data ?? []) as { mime: string; max_bytes: number }[]);
  }

  const sections = [
    { id: "signing-in", label: t("help.signin.title") },
    { id: "courses", label: t("help.courses.title") },
    { id: "uploading", label: t("help.upload.title") },
    { id: "quizzes", label: t("help.quiz.title") },
    { id: "grades", label: t("help.grades.title") },
    { id: "support", label: t("help.support.title") },
  ];

  return (
    <>
      <PageHeader title={t("help.title")} description={t("help.description")} />
      <PageBody>
        <div className="max-w-3xl">
          <OnThisPage label={t("help.onThisPage")} items={sections} />
          <div className="space-y-8">
            <DocSection id="signing-in" title={t("help.signin.title")}>
              <p>{t("help.signin.p1")}</p>
              <p>{tx("help.signin.p2", { signIn: <Link className={link} href="/login">{t("help.signin.signInLink")}</Link> })}</p>
              <p>{tx("help.signin.p3", { forgot: <Link className={link} href="/forgot-password">{t("help.signin.forgotLink")}</Link> })}</p>
              <p>{tx("help.signin.p4", { profile: <Link className={link} href="/profile#password">{t("help.signin.profileLink")}</Link> })}</p>
              <p>{t("help.signin.p5")}</p>
              <p>{t("help.signin.p6")}</p>
            </DocSection>

            <DocSection id="courses" title={t("help.courses.title")}>
              <p>{t("help.courses.p1")}</p>
              <p>{t("help.courses.p2")}</p>
              <p>{t("help.courses.p3")}</p>
              <p>{t("help.courses.p4")}</p>
              <p>{tx("help.courses.p5", { catalog: <Link className={link} href="/catalog">{t("help.courses.catalogLink")}</Link> })}</p>
            </DocSection>

            <DocSection id="uploading" title={t("help.upload.title")}>
              <p>{t("help.upload.p1")}</p>
              <p>{t("help.upload.p2")}</p>
              <p>{t("help.upload.p3")}</p>
              {limits && limits.length > 0 ? (
                <Table caption={t("help.upload.typesCaption")}>
                  <thead>
                    <tr>
                      <th scope="col" className={th}>{t("help.upload.typeHeader")}</th>
                      <th scope="col" className={th}>{t("help.upload.sizeHeader")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {limits.map((l) => {
                      const key = fileTypeLabelKey(l.mime);
                      return (
                        <tr key={l.mime}>
                          <td className={td}>{key ? t(key) : l.mime}</td>
                          <td className={td}>{formatBytes(Number(l.max_bytes))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              ) : !user ? (
                <p className="text-muted">{t("help.upload.typesSignedOut")}</p>
              ) : null}
            </DocSection>

            <DocSection id="quizzes" title={t("help.quiz.title")}>
              <p>{t("help.quiz.p1")}</p>
              <p>{t("help.quiz.p2")}</p>
              <p>{t("help.quiz.p3")}</p>
              <p>{t("help.quiz.p4")}</p>
              <p>{t("help.quiz.p5")}</p>
            </DocSection>

            <DocSection id="grades" title={t("help.grades.title")}>
              <p>{t("help.grades.p1")}</p>
              <p>{t("help.grades.p2")}</p>
              <p>{t("help.grades.p3")}</p>
            </DocSection>

            <DocSection id="support" title={t("help.support.title")}>
              <h3 className="text-base font-semibold">{t("help.support.contactTitle")}</h3>
              <SupportContact settings={settings} />
              <p>{t("help.support.p1")}</p>
              <p>{tx("help.support.p2", { accessibility: <Link className={link} href="/accessibility">{t("help.support.accessibilityLink")}</Link> })}</p>
              <p>
                {tx("help.legalLinks", {
                  privacy: <Link className={link} href="/privacy">{t("help.privacyLink")}</Link>,
                  terms: <Link className={link} href="/terms">{t("help.termsLink")}</Link>,
                  accessibility: <Link className={link} href="/accessibility">{t("help.accessibilityLink")}</Link>,
                })}
              </p>
            </DocSection>
          </div>
        </div>
      </PageBody>
    </>
  );
}
