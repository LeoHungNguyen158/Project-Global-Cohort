import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requireOffering } from "@/lib/data/offering-access";
import { PageBody } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { SectionTitle } from "@/components/announcements/section-title";
import { TopicList } from "@/components/discussions/topic-list";
import { loadTopicList } from "@/lib/comms/discussion-queries";
import { pageInfo, readPage, TOPICS_PAGE_SIZE } from "@/lib/comms/discussions";
import { newTopicPath, topicsPath, type DiscussionScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("disc.title") };

export default async function CourseDiscussionsPage({
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
  const scope: DiscussionScope = { type: "offering", id: offering.id };
  const requested = readPage(sp.page);
  let list = await loadTopicList(scope, requested, TOPICS_PAGE_SIZE);
  if (!list) notFound();
  const { page, pages } = pageInfo(list.total, TOPICS_PAGE_SIZE, requested);
  if (page !== requested) list = (await loadTopicList(scope, page, TOPICS_PAGE_SIZE)) ?? list;
  const archived = offering.status === "archived";
  // Course topics are opened by staff who may communicate in the course (RLS enforces the same rule).
  const canCreate = access.canCommunicate && !archived;

  return (
    <PageBody>
      <SectionTitle
        actions={
          canCreate ? (
            <ButtonLink href={newTopicPath(scope)}>
              <Plus aria-hidden="true" className="h-4 w-4" /> {t("disc.newTopic")}
            </ButtonLink>
          ) : null
        }
        description={`${t("disc.scopeNote", { scope: t("disc.scopeCourse") })} ${t("common.timezoneNote", { tz: user.timezone })}.`}
      >
        {t("disc.title")}
      </SectionTitle>
      {archived ? <Alert tone="info" className="mb-4">{t("disc.archivedNote")}</Alert> : null}
      {access.canCommunicate && !archived ? <p className="mb-4 text-sm text-muted">{t("disc.manageNote")}</p> : null}
      {list.topics.length === 0 ? (
        <EmptyState title={t("disc.empty")} action={canCreate ? <ButtonLink href={newTopicPath(scope)}>{t("disc.newTopic")}</ButtonLink> : undefined}>
          {canCreate ? t("disc.emptyStaff") : t("disc.emptyLearner")}
        </EmptyState>
      ) : (
        <TopicList topics={list.topics} scope={scope} tz={user.timezone} />
      )}
      <Pagination page={page} pages={pages} hrefFor={(p) => `${topicsPath(scope)}${p > 1 ? `?page=${p}` : ""}`} />
    </PageBody>
  );
}
