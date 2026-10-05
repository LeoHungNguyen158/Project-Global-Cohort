import { PageHeader } from "@/components/ui/page-header";
import type { CohortRow } from "@/lib/comms/queries";
import { t } from "@/i18n";

/** Header for pages beneath a cohort (the cohort's name is the page's h1). */
export function CohortHeader({ cohort, current }: { cohort: Pick<CohortRow, "id" | "code" | "name">; current: string }) {
  return (
    <PageHeader
      title={cohort.name}
      crumbs={[{ label: t("cohort.allCohorts"), href: "/cohorts" }, { label: cohort.code, href: `/cohorts/${cohort.id}` }, { label: current }]}
      description={t("msg.idLabel", { code: cohort.code })}
    />
  );
}
