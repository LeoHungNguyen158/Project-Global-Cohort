import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { DocList, DocSection, DraftNotice } from "@/components/public/doc-page";
import { SupportContact } from "@/components/public/support-contact";
import { getSiteSettings } from "@/components/public/site-settings";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("legal.terms.metaTitle") };

// Factual draft of the terms of use, pending the program owner's review. Public page.
export default async function TermsPage() {
  const settings = await getSiteSettings();
  return (
    <>
      <PageHeader title={t("legal.terms.title")} />
      <PageBody>
        <div className="max-w-3xl">
          <DraftNotice />
          <div className="space-y-8">
            <DocSection id="who" title={t("legal.terms.whoTitle")}>
              <p>{t("legal.terms.who1")}</p>
            </DocSection>
            <DocSection id="account" title={t("legal.terms.accountTitle")}>
              <p>{t("legal.terms.account1")}</p>
            </DocSection>
            <DocSection id="acceptable-use" title={t("legal.terms.useTitle")}>
              <DocList
                items={[t("legal.terms.use1"), t("legal.terms.use2"), t("legal.terms.use3"), t("legal.terms.use4"), t("legal.terms.use5")]}
              />
            </DocSection>
            <DocSection id="content" title={t("legal.terms.contentTitle")}>
              <p>{t("legal.terms.content1")}</p>
            </DocSection>
            <DocSection id="outcomes" title={t("legal.terms.outcomesTitle")}>
              <p>{t("legal.terms.outcomes1")}</p>
            </DocSection>
            <DocSection id="availability" title={t("legal.terms.availabilityTitle")}>
              <p>{t("legal.terms.availability1")}</p>
            </DocSection>
            <DocSection id="suspension" title={t("legal.terms.suspensionTitle")}>
              <p>{t("legal.terms.suspension1")}</p>
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
