import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOffering } from "@/lib/data/offering-access";
import { offeringTitle } from "@/lib/data/offerings";
import { isUuid } from "@/lib/forms";
import { PageBody } from "@/components/ui/page-header";
import { EditAnnouncementScreen } from "@/components/announcements/screens";
import { loadAnnouncement, loadRevisions } from "@/lib/comms/announcement-queries";
import { announcementsPath, type AnnouncementScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("ann.editTitle") };

export default async function EditCourseAnnouncementPage({ params }: { params: Promise<{ offeringId: string; announcementId: string }> }) {
  const { offeringId, announcementId } = await params;
  const access = await requireOffering(offeringId);
  if (!access.canCommunicate || !isUuid(announcementId)) notFound();
  const { offering, user } = access;
  const scope: AnnouncementScope = { type: "offering", id: offering.id };
  const item = await loadAnnouncement(scope, announcementId);
  if (!item) notFound();
  const revisions = await loadRevisions(item.id);
  return (
    <PageBody>
      <EditAnnouncementScreen
        scope={scope}
        scopeLabel={`${offering.code} · ${offeringTitle(offering)}`}
        item={item}
        revisions={revisions}
        tz={user.timezone}
        listHref={announcementsPath(scope)}
        lockedReason={offering.status === "archived" ? t("ann.archivedOffering") : undefined}
      />
    </PageBody>
  );
}
