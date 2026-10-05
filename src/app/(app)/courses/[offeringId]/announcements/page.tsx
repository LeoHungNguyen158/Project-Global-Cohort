import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireOffering } from "@/lib/data/offering-access";
import { PageBody } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionTitle } from "@/components/announcements/section-title";
import { ManagedAnnouncements, ReleasedAnnouncements } from "@/components/announcements/announcement-feed";
import { SavedNotice } from "@/components/announcements/screens";
import { loadAnnouncements } from "@/lib/comms/announcement-queries";
import type { AnnouncementScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("ann.title") };

export default async function CourseAnnouncementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { offeringId } = await params;
  const sp = await searchParams;
  const access = await requireOffering(offeringId);
  const { offering, user } = access;
  const tz = user.timezone;
  const manage = access.canCommunicate;
  const locked = offering.status === "archived";
  const scope: AnnouncementScope = { type: "offering", id: offering.id };
  const items = await loadAnnouncements(scope, { staff: manage });
  const newHref = `/courses/${offering.id}/announcements/new`;

  return (
    <PageBody>
      <SectionTitle
        actions={
          manage && !locked ? (
            <ButtonLink href={newHref}>
              <Plus aria-hidden="true" className="h-4 w-4" /> {t("ann.new")}
            </ButtonLink>
          ) : null
        }
        description={manage ? t("ann.staffNote") : undefined}
      >
        {t("ann.title")}
      </SectionTitle>
      <SavedNotice saved={sp.saved} />
      {manage && locked ? <Alert tone="info" className="mb-4">{t("ann.archivedOffering")}</Alert> : null}
      <p className="mb-4 text-sm text-muted">{t("common.timezoneNote", { tz })}.</p>
      {manage ? (
        items.length === 0 ? (
          <EmptyState title={t("ann.empty")} action={locked ? undefined : <ButtonLink href={newHref}>{t("ann.new")}</ButtonLink>}>
            {locked ? null : t("ann.emptyStaff")}
          </EmptyState>
        ) : (
          <ManagedAnnouncements items={items} scope={scope} scopeName={offering.code} tz={tz} locked={locked} />
        )
      ) : (
        <ReleasedAnnouncements items={items} scope={scope} scopeName={offering.code} tz={tz} emptyTitle={t("ann.empty")} emptyText={t("ann.emptyLearner")} />
      )}
    </PageBody>
  );
}
