import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadCalendarSources, type CalendarSources } from "@/lib/calendar/load";
import type { CalendarItem } from "@/lib/calendar/items";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { CalendarScreen } from "@/components/calendar/calendar-screen";
import type { ManageScope } from "@/components/calendar/types";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("cal.title") };

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SCOPE_RE = /^(offering|cohort):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * The person's calendar across their courses and cohorts. Filters: ?scope=offering:<id> or
 * ?scope=cohort:<id> (also ?offering=<id> and ?cohort=<id>), ?type=, ?view=, ?date=.
 * A course or cohort the person does not belong to is a 404.
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser("/calendar");
  const db = await createClient();
  const sources = await loadCalendarSources(db, user);

  const cohortParam = first(sp.cohort);
  const offeringParam = first(sp.offering);
  const rawScope = (first(sp.scope) ?? "").trim() || (cohortParam ? `cohort:${cohortParam}` : offeringParam ? `offering:${offeringParam}` : "");
  let scoped: CalendarSources = sources;
  let scopeValue = "";
  let manage: ManageScope | null = null;
  let canManage: (item: CalendarItem) => boolean = () => false;
  if (rawScope) {
    const m = SCOPE_RE.exec(rawScope);
    if (!m) notFound();
    const id = m[2].toLowerCase();
    if (m[1] === "offering") {
      const o = sources.offerings.find((x) => x.id === id);
      if (!o) notFound();
      scoped = { offerings: [o], cohorts: [] };
    } else {
      const c = sources.cohorts.find((x) => x.id === id);
      if (!c) notFound();
      scoped = { offerings: sources.offerings.filter((o) => o.cohortId === c.id), cohorts: [c] };
      if (user.isPlatformAdmin || user.coordinatorCohorts.includes(c.id)) {
        manage = { scopeType: "cohort", scopeId: c.id, scopeWord: t("cal.scopeWordCohort"), defaultTz: c.timezone };
        canManage = (item) => item.offeringId === null && item.cohortId === c.id;
      }
    }
    scopeValue = `${m[1]}:${id}`;
  }

  const options = [
    ...sources.offerings.map((o) => ({ value: `offering:${o.id}`, label: t("cal.scopeCourse", { code: o.code, title: o.title }) })),
    ...sources.cohorts.map((c) => ({ value: `cohort:${c.id}`, label: t("cal.scopeCohort", { name: c.name }) })),
  ];

  return (
    <>
      <PageHeader title={t("cal.title")} description={t("cal.description")} />
      <PageBody>
        <CalendarScreen
          basePath="/calendar"
          search={{ view: first(sp.view), date: first(sp.date), type: first(sp.type) }}
          keep={scopeValue ? { scope: scopeValue } : {}}
          user={user}
          sources={scoped}
          scopeSelect={{ options, value: scopeValue }}
          manage={manage}
          canManage={canManage}
        />
      </PageBody>
    </>
  );
}
