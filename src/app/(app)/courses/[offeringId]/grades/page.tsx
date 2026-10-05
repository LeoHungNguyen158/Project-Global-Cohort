import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireOffering } from "@/lib/data/offering-access";
import { offeringTitle } from "@/lib/data/offerings";
import { PageBody } from "@/components/ui/page-header";
import { Gradebook } from "@/components/grades/gradebook";
import { LearnerGrades } from "@/components/grades/learner-grades";
import { loadLearnerGrades } from "@/components/grades/load";
import { t } from "@/i18n";

type SP = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params }: { params: Promise<{ offeringId: string }> }): Promise<Metadata> {
  const { offeringId } = await params;
  const { offering } = await requireOffering(offeringId);
  return { title: `${t("grades.title")} · ${offeringTitle(offering)}` };
}

/** Course Grades tab: the gradebook for staff, the learner's own grades for everyone else. */
export default async function CourseGradesPage({ params, searchParams }: { params: Promise<{ offeringId: string }>; searchParams: Promise<SP> }) {
  const { offeringId } = await params;
  const sp = await searchParams;
  const access = await requireOffering(offeringId);
  const { offering, user } = access;

  if (access.isStaffView) {
    return (
      <PageBody>
        <Gradebook access={access} search={{ item: first(sp.item), status: first(sp.status), q: first(sp.q) }} />
      </PageBody>
    );
  }

  const db = await createClient();
  const grades = await loadLearnerGrades(db, user.id, [offering.id]);
  const data = grades.get(offering.id) ?? { offeringId: offering.id, rows: [], total: { earned: "0", possible: "0", percent: null, included: [], excluded: [] }, releasedCount: 0 };
  return (
    <PageBody className="max-w-5xl">
      <LearnerGrades data={data} courseTitle={offeringTitle(offering)} courseTz={offering.timezone} tz={user.timezone} />
    </PageBody>
  );
}
