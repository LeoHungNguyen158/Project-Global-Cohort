import type { Metadata } from "next";
import { requireOffering } from "@/lib/data/offering-access";
import { offeringTitle } from "@/lib/data/offerings";
import { offeringRef } from "@/lib/calendar/load";
import { PageBody } from "@/components/ui/page-header";
import { CalendarScreen } from "@/components/calendar/calendar-screen";
import type { ManageScope } from "@/components/calendar/types";
import { t } from "@/i18n";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params }: { params: Promise<{ offeringId: string }> }): Promise<Metadata> {
  const { offeringId } = await params;
  const { offering } = await requireOffering(offeringId);
  return { title: `${t("cal.title")} · ${offeringTitle(offering)}` };
}

/**
 * Course Calendar tab: this offering's deadlines, quiz windows and events. Staff with the
 * communicate permission (instructors, teaching assistants, administrators) add, edit,
 * cancel and delete course events; the database enforces the same rule.
 */
export default async function CourseCalendarPage({ params, searchParams }: { params: Promise<{ offeringId: string }>; searchParams: Promise<SP> }) {
  const { offeringId } = await params;
  const sp = await searchParams;
  const access = await requireOffering(offeringId);
  const { offering, user } = access;
  const ref = { ...offeringRef(offering, user), isStaff: access.isStaffView };
  const archived = offering.status === "archived";
  const manage: ManageScope | null =
    access.canCommunicate && !archived
      ? { scopeType: "offering", scopeId: offering.id, scopeWord: t("cal.scopeWordCourse"), defaultTz: offering.timezone }
      : null;

  return (
    <PageBody>
      <CalendarScreen
        basePath={`/courses/${offering.id}/calendar`}
        search={{ view: first(sp.view), date: first(sp.date), type: first(sp.type) }}
        user={user}
        sources={{ offerings: [ref], cohorts: [] }}
        manage={manage}
        manageNote={access.isStaffView && archived ? t("cal.manageUnavailableArchived") : null}
        canManage={(item) => manage !== null && item.offeringId === offering.id && (item.type === "live_session" || item.type === "office_hours" || item.type === "event")}
      />
    </PageBody>
  );
}
