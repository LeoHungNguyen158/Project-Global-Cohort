import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatWithCourseTime,
  isValidTimeZone,
  utcToWallTime,
  wallTimeToUtcIso,
  zoneAbbreviation,
} from "@/lib/time";

const NY = "America/New_York";
const HCM = "Asia/Ho_Chi_Minh";

describe("one deadline, two time zones (stored in UTC)", () => {
  it("shows the same instant correctly in New York (daylight time) and Ho Chi Minh City", () => {
    // Due 11:59 PM New York time on Friday Oct 30, 2026 (EDT, UTC-4).
    const due = wallTimeToUtcIso("2026-10-30T23:59", NY);
    expect(due).toBe("2026-10-31T03:59:00.000Z");
    expect(formatDateTime(due, NY)).toBe("Oct 30, 2026, 11:59 PM EDT");
    expect(formatDateTime(due, HCM)).toBe("Oct 31, 2026, 10:59 AM GMT+7");
  });

  it("shifts the Ho Chi Minh display by one hour after New York leaves daylight time on 2026-11-01", () => {
    // Same wall-clock deadline one week later is now EST (UTC-5).
    const due = wallTimeToUtcIso("2026-11-06T23:59", NY);
    expect(due).toBe("2026-11-07T04:59:00.000Z");
    expect(formatDateTime(due, NY)).toBe("Nov 6, 2026, 11:59 PM EST");
    expect(formatDateTime(due, HCM)).toBe("Nov 7, 2026, 11:59 AM GMT+7");
  });

  it("labels both 1:30 AM hours on the New York fall-back day distinctly", () => {
    expect(formatDateTime("2026-11-01T05:30:00Z", NY)).toBe("Nov 1, 2026, 1:30 AM EDT");
    expect(formatDateTime("2026-11-01T06:30:00Z", NY)).toBe("Nov 1, 2026, 1:30 AM EST");
  });

  it("resolves an ambiguous wall time to the first (daylight) occurrence and a skipped time forward", () => {
    expect(wallTimeToUtcIso("2026-11-01T01:30", NY)).toBe("2026-11-01T05:30:00.000Z");
    // 2:30 AM does not exist on 2026-03-08 in New York; it resolves to 3:30 AM EDT.
    expect(wallTimeToUtcIso("2026-03-08T02:30", NY)).toBe("2026-03-08T07:30:00.000Z");
  });

  it("does not move a deadline when the viewer changes time zone", () => {
    const stored = wallTimeToUtcIso("2026-11-02T09:00", HCM)!;
    expect(stored).toBe("2026-11-02T02:00:00.000Z");
    // Rendering in another zone never changes the stored instant.
    const asSeenInNy = formatDateTime(stored, NY);
    expect(asSeenInNy).toBe("Nov 1, 2026, 9:00 PM EST");
    expect(new Date(stored).toISOString()).toBe("2026-11-02T02:00:00.000Z");
  });

  it("adds the course-time reference only when the zones differ", () => {
    const at = "2026-10-15T13:00:00Z";
    expect(formatWithCourseTime(at, HCM, HCM)).toBe("Oct 15, 2026, 8:00 PM GMT+7");
    expect(formatWithCourseTime(at, NY, HCM)).toBe("Oct 15, 2026, 9:00 AM EDT (course time: Oct 15, 2026, 8:00 PM GMT+7)");
    expect(formatWithCourseTime(null, NY, HCM)).toBe("");
  });
});

describe("wall-time helpers", () => {
  it("round-trips datetime-local values", () => {
    for (const tz of [NY, HCM, "UTC", "Europe/London"]) {
      const iso = wallTimeToUtcIso("2026-12-24T18:45", tz)!;
      expect(utcToWallTime(iso, tz), tz).toBe("2026-12-24T18:45");
    }
  });

  it("rejects malformed wall times", () => {
    expect(wallTimeToUtcIso("2026-12-24 18:45", NY)).toBeNull();
    expect(wallTimeToUtcIso("24/12/2026", NY)).toBeNull();
    expect(utcToWallTime(null, NY)).toBe("");
  });

  it("validates IANA zone names", () => {
    expect(isValidTimeZone(NY)).toBe(true);
    expect(isValidTimeZone(HCM)).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });

  it("formats dates and zone labels in the viewer's zone", () => {
    expect(formatDate("2026-10-31T20:00:00Z", HCM)).toBe("Nov 1, 2026");
    expect(formatDate("2026-10-31T20:00:00Z", NY)).toBe("Oct 31, 2026");
    expect(zoneAbbreviation("2026-07-01T00:00:00Z", NY)).toBe("EDT");
    expect(zoneAbbreviation("2026-12-01T00:00:00Z", NY)).toBe("EST");
  });
});
