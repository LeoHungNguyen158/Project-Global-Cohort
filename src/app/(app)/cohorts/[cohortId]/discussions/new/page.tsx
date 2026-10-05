import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/forms";
import { PageBody } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { CohortHeader } from "@/components/cohorts/cohort-header";
import { SectionTitle } from "@/components/announcements/section-title";
import { BackLink } from "@/components/announcements/screens";
import { TopicEditor } from "@/components/discussions/topic-editor";
import { loadCohort, loadCohortOverview } from "@/lib/comms/queries";
import { topicsPath, type DiscussionScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("disc.createTitle") };

export default async function NewCohortTopicPage({ params }: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await params;
  await requireUser(`/cohorts/${cohortId}/discussions/new`);
  if (!isUuid(cohortId)) notFound();
  const [cohort, overview] = await Promise.all([loadCohort(cohortId), loadCohortOverview(cohortId)]);
  // Cohort topics are opened by the cohort's administrators (RLS enforces the same rule).
  if (!cohort || !overview?.is_admin) notFound();
  const scope: DiscussionScope = { type: "cohort", id: cohort.id };
  return (
    <>
      <CohortHeader cohort={cohort} current={t("disc.createTitle")} />
      <PageBody>
        <BackLink href={topicsPath(scope)} label={t("disc.backToTopics")} />
        <SectionTitle description={t("disc.createIn", { scope: `${cohort.code} · ${cohort.name}` })}>{t("disc.createTitle")}</SectionTitle>
        <Panel className="max-w-3xl px-4 py-5 sm:px-6">
          <TopicEditor scope={scope} moderator cancelHref={topicsPath(scope)} />
        </Panel>
      </PageBody>
    </>
  );
}
