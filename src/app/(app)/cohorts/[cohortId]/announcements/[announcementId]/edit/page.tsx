import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/forms";
import { PageBody } from "@/components/ui/page-header";
import { CohortHeader } from "@/components/cohorts/cohort-header";
import { EditAnnouncementScreen } from "@/components/announcements/screens";
import { loadAnnouncement, loadRevisions } from "@/lib/comms/announcement-queries";
import { loadCohort, loadCohortOverview } from "@/lib/comms/queries";
import { announcementsPath, type AnnouncementScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("ann.editTitle") };

export default async function EditCohortAnnouncementPage({ params }: { params: Promise<{ cohortId: string; announcementId: string }> }) {
  const { cohortId, announcementId } = await params;
  const user = await requireUser(`/cohorts/${cohortId}`);
  if (!isUuid(cohortId) || !isUuid(announcementId)) notFound();
  const [cohort, overview] = await Promise.all([loadCohort(cohortId), loadCohortOverview(cohortId)]);
  if (!cohort || !overview?.is_admin) notFound();
  const scope: AnnouncementScope = { type: "cohort", id: cohort.id };
  const item = await loadAnnouncement(scope, announcementId);
  if (!item) notFound();
  const revisions = await loadRevisions(item.id);
  const names = new Map([...overview.staff.map((s) => [s.user_id, s.name] as const), ...overview.coordinators.map((c) => [c.user_id, c.name] as const)]);
  return (
    <>
      <CohortHeader cohort={cohort} current={t("ann.editTitle")} />
      <PageBody>
        <EditAnnouncementScreen
          scope={scope}
          scopeLabel={`${cohort.code} · ${cohort.name}`}
          item={{ ...item, authorName: item.authorName ?? (item.authorId ? (names.get(item.authorId) ?? null) : null) }}
          revisions={revisions}
          tz={user.timezone}
          listHref={`${announcementsPath(scope)}#announcements`}
        />
      </PageBody>
    </>
  );
}
