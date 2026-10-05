import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOffering } from "@/lib/data/offering-access";
import { offeringTitle } from "@/lib/data/offerings";
import { PageBody } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SectionTitle } from "@/components/announcements/section-title";
import { BackLink } from "@/components/announcements/screens";
import { TopicEditor } from "@/components/discussions/topic-editor";
import { topicsPath, type DiscussionScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("disc.createTitle") };

export default async function NewCourseTopicPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const access = await requireOffering(offeringId);
  if (!access.canCommunicate || access.offering.status === "archived") notFound();
  const { offering } = access;
  const scope: DiscussionScope = { type: "offering", id: offering.id };
  return (
    <PageBody>
      <BackLink href={topicsPath(scope)} label={t("disc.backToTopics")} />
      <SectionTitle description={t("disc.createIn", { scope: `${offering.code} · ${offeringTitle(offering)}` })}>{t("disc.createTitle")}</SectionTitle>
      <Panel className="max-w-3xl px-4 py-5 sm:px-6">
        <TopicEditor scope={scope} moderator cancelHref={topicsPath(scope)} />
      </Panel>
    </PageBody>
  );
}
