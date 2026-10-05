import type { Metadata } from "next";
import Link from "next/link";
import { Eye, Settings2, ListChecks } from "lucide-react";
import { requireOffering } from "@/lib/data/offering-access";
import { formatWithCourseTime } from "@/lib/time";
import { flattenLessons, nextAction, requiredCounts } from "@/lib/learning/outline";
import { describeConditions, loadOutline, loadProgress, loadQuizzes, loadRules } from "@/lib/learning/data";
import { CourseOutline } from "@/components/learning/course-outline";
import { NextActionBlock } from "@/components/learning/next-action";
import { ProgressMeter } from "@/components/learning/progress-meter";
import { PageBody } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("learn.content.title") };

export default async function ContentPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const access = await requireOffering(offeringId);
  const { offering, user } = access;
  const tz = user.timezone;
  const staffView = access.isStaffView;
  const { outline, error } = await loadOutline(offeringId);
  const lessons = flattenLessons(outline.modules).map((x) => x.lesson);
  const notStarted = Boolean(offering.starts_at && new Date(offering.starts_at) > new Date());

  let conditions: Map<string, string[]> | undefined;
  if (staffView) {
    const [rules, quizzes] = await Promise.all([loadRules(offeringId), loadQuizzes(offeringId)]);
    conditions = describeConditions(rules, {
      tz,
      courseTz: offering.timezone,
      lessonTitles: new Map(lessons.map((l) => [l.lineage_id, l.title])),
      quizTitles: new Map(quizzes.map((q) => [q.id, q.title])),
    });
  }
  const progress = staffView ? null : await loadProgress(offeringId);
  const counts = requiredCounts(lessons);

  return (
    <PageBody>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-xl font-semibold">{t("learn.content.title")}</h2>
          {staffView && access.canAuthor ? (
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`/courses/${offeringId}/content/manage`} variant="secondary" size="sm">
                <Settings2 aria-hidden="true" className="h-4 w-4" /> {t("learn.staff.manageContent")}
              </ButtonLink>
              <ButtonLink href={`/courses/${offeringId}/content/manage/rules`} variant="secondary" size="sm">
                <ListChecks aria-hidden="true" className="h-4 w-4" /> {t("learn.staff.releaseRules")}
              </ButtonLink>
            </div>
          ) : null}
        </div>

        {error ? (
          <Alert tone="error" title={t("learn.err.load")}>
            <Link href={`/courses/${offeringId}/content`} className="font-medium underline">{t("learn.err.retry")}</Link>
          </Alert>
        ) : null}

        {staffView ? (
          <div role="note" className="flex gap-3 rounded-md border border-[#c7d6fb] bg-primary-soft px-4 py-3 text-sm">
            <Eye aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{t("learn.content.staffBanner")}</p>
          </div>
        ) : null}

        {!staffView && notStarted && offering.starts_at ? (
          <Alert tone="info" title={t("learn.overview.upcomingTitle")}>
            {t("learn.content.opensBanner", { date: formatWithCourseTime(offering.starts_at, tz, offering.timezone) })}
          </Alert>
        ) : null}

        {!staffView && lessons.length > 0 ? (
          <section aria-labelledby="content-progress" className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-panel p-4 sm:p-6">
            <h3 id="content-progress" className="text-lg font-semibold">{t("learn.overview.progressTitle")}</h3>
            {counts.total > 0 ? (
              <ProgressMeter
                done={progress?.requiredCompleted ?? counts.done}
                total={progress?.requiredTotal ?? counts.total}
                percent={progress?.percent ?? null}
              />
            ) : null}
            <p className="text-xs text-muted">{t("learn.progress.rule")}</p>
            <NextActionBlock offeringId={offeringId} action={nextAction(outline.modules)} tz={tz} courseTz={offering.timezone} />
          </section>
        ) : null}

        {!error && lessons.length === 0 && outline.modules.length === 0 ? (
          <EmptyState title={staffView ? t("learn.content.emptyStaff") : t("learn.content.empty")}>
            {staffView && access.canAuthor ? (
              <Link href={`/courses/${offeringId}/content/manage`} className="text-primary underline">{t("learn.staff.manageContent")}</Link>
            ) : null}
          </EmptyState>
        ) : (
          <CourseOutline
            offeringId={offeringId}
            modules={outline.modules}
            staffView={staffView}
            tz={tz}
            courseTz={offering.timezone}
            hideStartReason={!staffView && notStarted}
            conditions={conditions}
          />
        )}
      </div>
    </PageBody>
  );
}
