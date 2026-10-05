import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listMyOfferings, offeringPhase, offeringTitle, type OfferingSummary } from "@/lib/data/offerings";
import { compareNames } from "@/lib/domain/grades";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { OverviewCard, type OverviewEntry } from "@/components/grades/overview-card";
import { loadLearnerGrades, loadStaffSummary } from "@/components/grades/load";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("grades.title") };

const PER_PAGE = 12;

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Grades overview ("Current courses and organizations"): one card per offering the person
 * takes or teaches. Learners see a running percentage from released grades only; staff see
 * real grading and publishing counts linking to the gradebook. Past offerings are a tab.
 */
export default async function GradesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser("/grades");
  const scope = first(sp.scope) === "past" ? "past" : "current";

  const offerings = await listMyOfferings();
  const staffById = new Map(user.staff.map((s) => [s.offering_id, s]));
  const enrollmentById = new Map(user.enrollments.map((e) => [e.offering_id, e.status]));
  const mine = offerings.filter((o) => staffById.has(o.id) || enrollmentById.has(o.id));
  const inScope = mine.filter((o) => (offeringPhase(o) === "archived") === (scope === "past"));

  const rank = { ongoing: 0, upcoming: 1, archived: 2 } as const;
  inScope.sort((a, b) => {
    if (scope === "past") return (b.ends_at ?? "").localeCompare(a.ends_at ?? "") || compareNames(offeringTitle(a), offeringTitle(b));
    return rank[offeringPhase(a)] - rank[offeringPhase(b)] || compareNames(offeringTitle(a), offeringTitle(b));
  });

  const pages = Math.max(1, Math.ceil(inScope.length / PER_PAGE));
  const page = Math.min(Math.max(1, Number(first(sp.page)) || 1), pages);
  const pageItems = inScope.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const db = await createClient();
  const learnerIds = pageItems.filter((o) => !staffById.has(o.id)).map((o) => o.id);
  const staffItems = pageItems.filter((o) => staffById.has(o.id));
  const [learnerGrades, summaries] = await Promise.all([
    loadLearnerGrades(db, user.id, learnerIds),
    Promise.all(staffItems.map(async (o) => [o.id, await loadStaffSummary(db, o.id)] as const)),
  ]);
  const summaryById = new Map(summaries);

  const entries: OverviewEntry[] = pageItems.map((o: OfferingSummary) => {
    const staff = staffById.get(o.id);
    if (staff) {
      return {
        role: staff.role,
        offering: o,
        canPublish: staff.role === "instructor" || staff.can_publish_grades,
        summary: summaryById.get(o.id) ?? null,
      };
    }
    return { role: "learner", offering: o, completed: enrollmentById.get(o.id) === "completed", grades: learnerGrades.get(o.id) ?? null };
  });

  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    if (scope === "past") params.set("scope", "past");
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/grades?${s}` : "/grades";
  };

  return (
    <>
      <PageHeader title={t("grades.title")} description={t("grades.description")} />
      <TabNav
        label={t("grades.scopeNav")}
        current={scope}
        tabs={[
          { key: "current", href: "/grades", label: t("grades.tabCurrent") },
          { key: "past", href: "/grades?scope=past", label: t("grades.tabPast") },
        ]}
      />
      <PageBody className="max-w-5xl">
        <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">{scope === "current" ? t("grades.scope") : t("grades.tabPast")}</p>
        {entries.length === 0 ? (
          <EmptyState title={scope === "current" ? t("grades.noCurrent") : t("grades.noPast")}>
            {scope === "current" ? t("grades.noCurrentHint") : t("grades.noPastHint")}
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {entries.map((e) => (
              <OverviewCard key={e.offering.id} entry={e} tz={user.timezone} />
            ))}
          </ul>
        )}
        <Pagination page={page} pages={pages} hrefFor={hrefFor} />
      </PageBody>
    </>
  );
}
