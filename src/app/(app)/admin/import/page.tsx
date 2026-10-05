import type { Metadata } from "next";
import { Download } from "lucide-react";
import { requireAdmin } from "@/lib/admin/access";
import { listAdminCohorts, listAdminOfferings, offeringLabel } from "@/lib/admin/data";
import { MAX_IMPORT_ROWS } from "@/lib/admin/import";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, td, th } from "@/components/admin/scroll-table";
import { Disclosure } from "@/components/ui/disclosure";
import { buttonClass } from "@/components/ui/button";
import { SectionTitle } from "@/components/admin/badges";
import { ImportWizard } from "@/components/admin/import-wizard";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.import.title") };

const COLUMNS = ["email", "display_name", "role", "cohort_code", "offering_code"] as const;

export default async function AdminImportPage() {
  const ctx = await requireAdmin("/admin/import");
  const [cohorts, offerings] = await Promise.all([listAdminCohorts(ctx), listAdminOfferings(ctx)]);
  const openCohorts = cohorts.filter((c) => c.status !== "archived");
  const openOfferings = offerings.filter((o) => o.status !== "archived");

  return (
    <PageBody className="space-y-6">
      <SectionTitle
        title={t("admin.import.title")}
        description={t("admin.import.description", { max: MAX_IMPORT_ROWS })}
        actions={
          <a href="/api/admin/import/template" className={buttonClass("secondary")} download>
            <Download aria-hidden="true" className="h-4 w-4" />
            {t("admin.import.template")}
          </a>
        }
      />

      <Panel aria-labelledby="import-format">
        <PanelHeader id="import-format" title={t("admin.import.formatTitle")} />
        <div className="space-y-3 p-4 sm:px-6">
          <p className="text-sm">{t("admin.import.formatIntro")}</p>
          <Disclosure summary={t("admin.import.formatShow")} summaryClassName="text-primary">
            <Table caption={t("admin.import.formatCaption")} captionHidden>
              <thead>
                <tr>
                  <th scope="col" className={th}>{t("admin.import.formatColumn")}</th>
                  <th scope="col" className={th}>{t("admin.import.formatRequired")}</th>
                  <th scope="col" className={th}>{t("admin.import.formatMeaning")}</th>
                </tr>
              </thead>
              <tbody>
                {COLUMNS.map((c) => (
                  <tr key={c}>
                    <th scope="row" className={`${td} font-mono text-sm font-normal`}>{c}</th>
                    <td className={td}>{c === "email" ? t("admin.common.yes") : t("admin.import.formatOptional")}</td>
                    <td className={td}>{t(`admin.import.formatDoc.${c}`)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              <li>{t("admin.import.formatRule.encoding")}</li>
              <li>{t("admin.import.formatRule.quotes")}</li>
              <li>{t("admin.import.formatRule.duplicates")}</li>
              <li>{t("admin.import.formatRule.existing")}</li>
            </ul>
          </Disclosure>
        </div>
      </Panel>

      {openCohorts.length === 0 ? (
        <p className="text-sm text-muted">{t("admin.invite.noScopes")}</p>
      ) : (
        <ImportWizard
          cohorts={openCohorts.map((c) => ({ code: c.code, label: `${c.code} — ${c.name}` }))}
          offerings={openOfferings.map((o) => ({ code: o.code, label: offeringLabel(o) }))}
        />
      )}
    </PageBody>
  );
}
