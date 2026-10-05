import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { DocList, DocSection, DraftNotice } from "@/components/public/doc-page";
import { SupportContact } from "@/components/public/support-contact";
import { getSiteSettings } from "@/components/public/site-settings";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("legal.privacy.metaTitle") };

// Factual draft of what the application does with personal data. Public page.
export default async function PrivacyPage() {
  const settings = await getSiteSettings();
  return (
    <>
      <PageHeader title={t("legal.privacy.title")} />
      <PageBody>
        <div className="max-w-3xl">
          <DraftNotice />
          <div className="space-y-8">
            <DocSection id="operator" title={t("legal.privacy.operatorTitle")}>
              <p>{t("legal.privacy.operator")}</p>
            </DocSection>
            <DocSection id="stored" title={t("legal.privacy.storedTitle")}>
              <DocList
                items={[
                  t("legal.privacy.stored1"),
                  t("legal.privacy.stored2"),
                  t("legal.privacy.stored3"),
                  t("legal.privacy.stored4"),
                  t("legal.privacy.stored5"),
                ]}
              />
            </DocSection>
            <DocSection id="where" title={t("legal.privacy.whereTitle")}>
              <p>{t("legal.privacy.where1")}</p>
              <p>{t("legal.privacy.where2")}</p>
            </DocSection>
            <DocSection id="cookies" title={t("legal.privacy.cookiesTitle")}>
              <p>{t("legal.privacy.cookies1")}</p>
              <p>{t("legal.privacy.cookies2")}</p>
            </DocSection>
            <DocSection id="who" title={t("legal.privacy.whoTitle")}>
              <DocList
                items={[
                  t("legal.privacy.who1"),
                  t("legal.privacy.who2"),
                  t("legal.privacy.who3"),
                  t("legal.privacy.who4"),
                  t("legal.privacy.who5"),
                ]}
              />
            </DocSection>
            <DocSection id="files" title={t("legal.privacy.filesTitle")}>
              <p>{t("legal.privacy.files1")}</p>
            </DocSection>
            <DocSection id="email" title={t("legal.privacy.emailTitle")}>
              <p>{t("legal.privacy.email1")}</p>
            </DocSection>
            <DocSection id="sample-data" title={t("legal.privacy.sampleTitle")}>
              <p>{t("legal.privacy.sample1")}</p>
            </DocSection>
            <DocSection id="retention" title={t("legal.privacy.retentionTitle")}>
              <p>{t("legal.privacy.retention1")}</p>
            </DocSection>
            <DocSection id="security" title={t("legal.privacy.securityTitle")}>
              <p>{t("legal.privacy.security1")}</p>
            </DocSection>
            <DocSection id="contact" title={t("legal.contactTitle")}>
              <SupportContact settings={settings} />
            </DocSection>
          </div>
        </div>
      </PageBody>
    </>
  );
}
