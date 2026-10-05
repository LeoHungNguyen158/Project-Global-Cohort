import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser, staffFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOffering, offeringTitle } from "@/lib/data/offerings";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { LearnerGrades } from "@/components/grades/learner-grades";
import { loadLearnerGrades } from "@/components/grades/load";
import { t } from "@/i18n";

export async function generateMetadata({ params }: { params: Promise<{ offeringId: string }> }): Promise<Metadata> {
  const { offeringId } = await params;
  const offering = await getOffering(offeringId);
  return { title: offering ? t("grades.detailTitle", { course: offeringTitle(offering) }) : t("grades.title") };
}

/**
 * A learner's grades for one offering. Grade notifications link here as
 * /grades/<offering>#item-<gradeItemId>. Staff and administrators are sent to the gradebook.
 */
export default async function LearnerGradeDetailPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const user = await requireUser(`/grades/${offeringId}`);
  const offering = await getOffering(offeringId);
  if (!offering) notFound();
  const isStaff = Boolean(staffFor(user, offering.id)) || user.isPlatformAdmin || user.coordinatorCohorts.includes(offering.cohort_id);
  if (isStaff) redirect(`/courses/${offering.id}/grades`);
  if (!user.enrollments.some((e) => e.offering_id === offering.id)) notFound();

  const db = await createClient();
  const grades = await loadLearnerGrades(db, user.id, [offering.id]);
  const data = grades.get(offering.id) ?? { offeringId: offering.id, rows: [], total: { earned: "0", possible: "0", percent: null, included: [], excluded: [] }, releasedCount: 0 };
  const title = offeringTitle(offering);

  return (
    <>
      <div aria-hidden="true" className="h-1.5" style={{ backgroundColor: offering.accent_color }} />
      <PageHeader
        title={t("grades.detailTitle", { course: title })}
        crumbs={[{ label: t("grades.title"), href: "/grades" }, { label: offering.code }]}
        description={
          <>
            <span>{offering.code}{offering.cohorts?.name ? ` · ${offering.cohorts.name}` : ""}</span>
            <span className="block text-sm">{t("grades.detailDescription")}</span>
          </>
        }
        actions={
          <Link href={`/courses/${offering.id}`} className="inline-flex min-h-10 items-center text-sm text-primary underline underline-offset-2">
            {t("grades.openCourse")}
          </Link>
        }
      />
      <PageBody className="max-w-5xl">
        <LearnerGrades data={data} courseTitle={title} courseTz={offering.timezone} tz={user.timezone} />
      </PageBody>
    </>
  );
}
