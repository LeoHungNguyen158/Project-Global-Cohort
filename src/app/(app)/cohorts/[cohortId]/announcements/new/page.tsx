import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/forms";
import { PageBody } from "@/components/ui/page-header";
import { CohortHeader } from "@/components/cohorts/cohort-header";
import { NewAnnouncementScreen } from "@/components/announcements/screens";
import { loadCohort, loadCohortOverview } from "@/lib/comms/queries";
import { announcementsPath } from "@/lib/comms/paths";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("ann.createTitle") };

export default async function NewCohortAnnouncementPage({ params }: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await params;
  const user = await requireUser(`/cohorts/${cohortId}/announcements/new`);
  if (!isUuid(cohortId)) notFound();
  const [cohort, overview] = await Promise.all([loadCohort(cohortId), loadCohortOverview(cohortId)]);
  // Cohort announcements are written by the cohort's administrators only.
  if (!cohort || !overview?.is_admin) notFound();
  return (
    <>
      <CohortHeader cohort={cohort} current={t("ann.createTitle")} />
      <PageBody>
        <NewAnnouncementScreen
          scope={{ type: "cohort", id: cohort.id }}
          scopeLabel={`${cohort.code} · ${cohort.name}`}
          tz={user.timezone}
          listHref={`${announcementsPath({ type: "cohort", id: cohort.id })}#announcements`}
        />
      </PageBody>
    </>
  );
}
