import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  civilOf,
  dayLabel,
  dayStartUtc,
  isCivilDate,
  monthGrid,
  monthLabel,
  startOfWeek,
  todayIn,
  viewRange,
  weekOf,
} from "@/lib/calendar/dates";
import { assignmentItem, eventItem, groupByDay, inRange, quizItems, type OfferingRef } from "@/lib/calendar/items";
import { formatDateTime, formatWithCourseTime, wallTimeToUtcIso } from "@/lib/time";

const NY = "America/New_York";
const HCM = "Asia/Ho_Chi_Minh";

const offering: OfferingRef = {
  id: "o1",
  code: "AAF-F26",
  title: "Agentic AI Foundations",
  timezone: NY,
  accent: "#2563EB",
  cohortId: "c1",
  isStaff: false,
};

describe("AC13: one deadline, viewed from New York and Ho Chi Minh City", () => {
  // The instructor sets "due Friday Oct 30, 11:59 PM course time (New York)".
  const dueBeforeDst = wallTimeToUtcIso("2026-10-30T23:59", NY)!;
  // Same wall-clock deadline one week later, after New York leaves daylight time on 2026-11-01.
  const dueAfterDst = wallTimeToUtcIso("2026-11-06T23:59", NY)!;

  it("stores one UTC instant", () => {
    expect(dueBeforeDst).toBe("2026-10-31T03:59:00.000Z");
    expect(dueAfterDst).toBe("2026-11-07T04:59:00.000Z");
  });

  it("shows the right local time and calendar day in each zone, before the DST change", () => {
    expect(formatDateTime(dueBeforeDst, NY)).toBe("Oct 30, 2026, 11:59 PM EDT");
    expect(formatDateTime(dueBeforeDst, HCM)).toBe("Oct 31, 2026, 10:59 AM GMT+7");
    expect(civilOf(dueBeforeDst, NY)).toBe("2026-10-30");
    expect(civilOf(dueBeforeDst, HCM)).toBe("2026-10-31");
  });

  it("shifts only the Ho Chi Minh display after New York's DST change (Nov 1, 2026)", () => {
    expect(formatDateTime(dueAfterDst, NY)).toBe("Nov 6, 2026, 11:59 PM EST");
    expect(formatDateTime(dueAfterDst, HCM)).toBe("Nov 7, 2026, 11:59 AM GMT+7");
    expect(formatWithCourseTime(dueAfterDst, HCM, NY)).toBe("Nov 7, 2026, 11:59 AM GMT+7 (course time: Nov 6, 2026, 11:59 PM EST)");
  });

  it("places the item on each viewer's own calendar day without moving the instant", () => {
    const item = assignmentItem(
      { id: "a1", offering_id: "o1", title: "Project", status: "published", available_from: null, due_at: dueAfterDst, closes_at: null, late_policy: "accept_flag" },
      offering,
      null,
    )!;
    const ny = groupByDay([item], NY);
    const hcm = groupByDay([item], HCM);
    expect([...ny.keys()]).toEqual(["2026-11-06"]);
    expect([...hcm.keys()]).toEqual(["2026-11-07"]);
    // Changing the viewer's zone re-labels the day; the stored deadline is untouched.
    expect(ny.get("2026-11-06")![0].start).toBe(dueAfterDst);
    expect(hcm.get("2026-11-07")![0].start).toBe(dueAfterDst);
  });

  it("includes the deadline in the right month and week query ranges for each zone", () => {
    const nyWeek = viewRange("week", "2026-11-06", NY);
    const hcmWeek = viewRange("week", "2026-11-07", HCM);
    expect(inRange(assignmentItem({ id: "a", offering_id: "o1", title: "x", status: "published", available_from: null, due_at: dueAfterDst, closes_at: null, late_policy: "accept_flag" }, offering, null)!, nyWeek.startUtc, nyWeek.endUtc)).toBe(true);
    expect(nyWeek.days).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(hcmWeek.days[0]).toBe("2026-11-02");
    expect(new Date(dueAfterDst) >= new Date(hcmWeek.startUtc) && new Date(dueAfterDst) < new Date(hcmWeek.endUtc)).toBe(true);
  });

  it("keeps due_at, available_from and closes_at distinct", () => {
    const opens = "2026-10-20T13:00:00.000Z";
    const due = "2026-10-31T03:59:00.000Z";
    const closes = "2026-11-02T04:59:00.000Z";
    const a = assignmentItem(
      { id: "a1", offering_id: "o1", title: "Project", status: "published", available_from: opens, due_at: due, closes_at: closes, late_policy: "accept_flag" },
      offering,
      "submitted",
    )!;
    expect(a.start).toBe(due);
    expect([a.opens, a.due, a.closes]).toEqual([opens, due, closes]);
    expect(a.submitted).toBe(true);

    const [open, close] = quizItems(
      { id: "q1", offering_id: "o1", title: "Quiz 1", status: "published", available_from: opens, closes_at: closes, time_limit_minutes: 20 },
      offering,
      null,
    );
    expect(open.kind).toBe("quiz_opens");
    expect(open.start).toBe(opens);
    expect(close.kind).toBe("quiz_closes");
    expect(close.start).toBe(closes);
    expect(close.extended).toBe(false);
  });

  it("uses the learner's approved extension as the effective quiz close", () => {
    const closes = "2026-11-02T04:59:00.000Z";
    const extended = "2026-11-04T04:59:00.000Z";
    const items = quizItems(
      { id: "q1", offering_id: "o1", title: "Quiz 1", status: "published", available_from: null, closes_at: closes, time_limit_minutes: null },
      offering,
      { quiz_id: "q1", extended_closes_at: extended },
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "quiz_closes", start: extended, extended: true, originalCloses: closes, closes: extended });
  });

  it("an assignment without a due date is not placed on the calendar", () => {
    expect(
      assignmentItem({ id: "a", offering_id: "o1", title: "x", status: "published", available_from: null, due_at: null, closes_at: null, late_policy: "accept_flag" }, offering, null),
    ).toBeNull();
  });
});

describe("civil dates and view ranges", () => {
  it("validates and does calendar arithmetic", () => {
    expect(isCivilDate("2026-10-05")).toBe(true);
    expect(isCivilDate("2026-02-30")).toBe(false);
    expect(isCivilDate("2026-10-5")).toBe(false);
    expect(isCivilDate(undefined)).toBe(false);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(startOfWeek("2026-11-01")).toBe("2026-10-26"); // Sunday -> Monday before
    expect(startOfWeek("2026-11-02")).toBe("2026-11-02");
  });

  it("builds Monday-first month grids", () => {
    const oct = monthGrid("2026-10-05");
    expect(oct).toHaveLength(5);
    expect(oct[0][0]).toBe("2026-09-28");
    expect(oct[4][6]).toBe("2026-11-01");
    const feb = monthGrid("2027-02-10");
    expect(feb).toHaveLength(4);
    expect(feb[0][0]).toBe("2027-02-01");
    expect(weekOf("2026-10-07")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
  });

  it("computes UTC bounds in the viewer's zone, including the 25-hour New York day", () => {
    const nyMonth = viewRange("month", "2026-10-05", NY);
    expect(nyMonth.startUtc).toBe("2026-09-28T04:00:00.000Z"); // midnight EDT
    expect(nyMonth.endUtc).toBe("2026-11-02T05:00:00.000Z"); // midnight EST after the change
    expect(nyMonth.prev).toBe("2026-09-05");
    expect(nyMonth.next).toBe("2026-11-05");
    const hcmMonth = viewRange("month", "2026-10-05", HCM);
    expect(hcmMonth.startUtc).toBe("2026-09-27T17:00:00.000Z");
    expect(hcmMonth.endUtc).toBe("2026-11-01T17:00:00.000Z");
    const week = viewRange("week", "2026-11-01", NY);
    expect(week.from).toBe("2026-10-26");
    expect(week.toExclusive).toBe("2026-11-02");
    expect(new Date(dayStartUtc("2026-11-02", NY)).getTime() - new Date(dayStartUtc("2026-11-01", NY)).getTime()).toBe(25 * 3_600_000);
    const list = viewRange("list", "2026-10-20", NY);
    expect(list.days[0]).toBe("2026-10-01");
    expect(list.days).toHaveLength(31);
  });

  it("knows today per zone", () => {
    const now = new Date("2026-10-05T02:07:00Z");
    expect(todayIn(NY, now)).toBe("2026-10-04");
    expect(todayIn(HCM, now)).toBe("2026-10-05");
  });

  it("labels civil dates without zone drift", () => {
    expect(dayLabel("2026-11-01")).toBe("Sunday, November 1, 2026");
    expect(monthLabel("2026-10-31")).toBe("October 2026");
  });
});

describe("calendar events", () => {
  it("keeps the event's own zone for the course-time reference and marks cancellation", () => {
    const e = eventItem(
      {
        id: "e1",
        offering_id: "o1",
        cohort_id: null,
        kind: "office_hours",
        title: "Office hours",
        description: "",
        starts_at: "2026-10-10T13:00:00+00:00",
        ends_at: "2026-10-10T14:00:00+00:00",
        timezone: HCM,
        location: "",
        meeting_url: null,
        cancelled_at: "2026-10-05T00:00:00+00:00",
        cancel_reason: "Instructor travelling",
        sequence: 2,
      },
      { offering },
    );
    expect(e).toMatchObject({ type: "office_hours", referenceTz: HCM, cancelled: true, cancelReason: "Instructor travelling", end: "2026-10-10T14:00:00+00:00" });
    expect(formatWithCourseTime(e.start, NY, e.referenceTz)).toBe("Oct 10, 2026, 9:00 AM EDT (course time: Oct 10, 2026, 8:00 PM GMT+7)");
  });
});
