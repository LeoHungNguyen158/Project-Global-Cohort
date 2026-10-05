import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { DocList, DocSection, DraftNotice } from "@/components/public/doc-page";
import { SupportContact } from "@/components/public/support-contact";
import { getSiteSettings } from "@/components/public/site-settings";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("legal.a11y.metaTitle") };

// Accessibility statement: the WCAG 2.2 AA target, what was tested, known limits and
// how to report a barrier. Public page.
export default async function AccessibilityPage() {
  const settings = await getSiteSettings();
  return (
    <>
      <PageHeader title={t("legal.a11y.title")} />
      <PageBody>
        <div className="max-w-3xl">
          <DraftNotice />
          <div className="space-y-8">
            <DocSection id="target" title={t("legal.a11y.targetTitle")}>
              <p>{t("legal.a11y.target1")}</p>
            </DocSection>
            <DocSection id="built-in" title={t("legal.a11y.doneTitle")}>
              <DocList
                items={[
                  t("legal.a11y.done1"),
                  t("legal.a11y.done2"),
                  t("legal.a11y.done3"),
                  t("legal.a11y.done4"),
                  t("legal.a11y.done5"),
                  t("legal.a11y.done6"),
                ]}
              />
            </DocSection>
            <DocSection id="testing" title={t("legal.a11y.testedTitle")}>
              <DocList items={[t("legal.a11y.tested1"), t("legal.a11y.tested2"), t("legal.a11y.tested3")]} />
            </DocSection>
            <DocSection id="limitations" title={t("legal.a11y.limitsTitle")}>
              <DocList
                items={[t("legal.a11y.limits1"), t("legal.a11y.limits2"), t("legal.a11y.limits3"), t("legal.a11y.limits4"), t("legal.a11y.limits5")]}
              />
            </DocSection>
            <DocSection id="report" title={t("legal.a11y.reportTitle")}>
              <p>{t("legal.a11y.report1")}</p>
              <SupportContact settings={settings} />
            </DocSection>
          </div>
        </div>
      </PageBody>
    </>
  );
}
