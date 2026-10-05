import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOffering } from "@/lib/data/offering-access";
import { offeringTitle } from "@/lib/data/offerings";
import { PageBody } from "@/components/ui/page-header";
import { NewAnnouncementScreen } from "@/components/announcements/screens";
import { announcementsPath } from "@/lib/comms/paths";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("ann.createTitle") };

export default async function NewCourseAnnouncementPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const access = await requireOffering(offeringId);
  // Only staff who may communicate in this course write announcements; archived courses are read-only.
  if (!access.canCommunicate || access.offering.status === "archived") notFound();
  const { offering, user } = access;
  return (
    <PageBody>
      <NewAnnouncementScreen
        scope={{ type: "offering", id: offering.id }}
        scopeLabel={`${offering.code} · ${offeringTitle(offering)}`}
        tz={user.timezone}
        listHref={announcementsPath({ type: "offering", id: offering.id })}
      />
    </PageBody>
  );
}
