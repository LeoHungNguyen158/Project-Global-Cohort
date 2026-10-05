import { describe, expect, it } from "vitest";
import {
  bytesToMegabytes,
  dayRangeToUtc,
  expiryFromDays,
  isDateOnly,
  isValidCode,
  megabytesToBytes,
  validateCohort,
  validateOffering,
} from "@/lib/admin/validation";

describe("codes and dates", () => {
  it("accepts the database code pattern only", () => {
    expect(isValidCode("GC-FALL-2026")).toBe(true);
    expect(isValidCode("a.b_c-1")).toBe(true);
    expect(isValidCode("x")).toBe(false);
    expect(isValidCode("has space")).toBe(false);
    expect(isValidCode("Đ-01")).toBe(false);
  });

  it("checks real calendar dates", () => {
    expect(isDateOnly("2026-02-28")).toBe(true);
    expect(isDateOnly("2026-02-30")).toBe(false);
    expect(isDateOnly("2026-2-1")).toBe(false);
  });
});

describe("validateCohort", () => {
  const base = { code: "ADM-1", name: "Cohort", description: "", timezone: "Asia/Ho_Chi_Minh", startsOn: "2026-10-01", endsOn: "2026-12-01", status: "active" };
  it("passes a valid cohort", () => {
    expect(validateCohort(base)).toEqual({});
  });
  it("reports each invalid field", () => {
    expect(validateCohort({ ...base, code: "bad code", name: "", timezone: "Mars/Base", endsOn: "2026-09-01", status: "x" })).toEqual({
      code: "code",
      name: "name",
      timezone: "timezone",
      endsOn: "dateOrder",
      status: "status",
    });
  });
});

describe("validateOffering", () => {
  const base = {
    code: "ADM-OFF-1",
    termLabel: "Fall 2026",
    startsLocal: "2026-11-01T09:00",
    endsLocal: "2026-12-15T17:00",
    timezone: "America/New_York",
    status: "draft",
    accentColor: "#1D4ED8",
    catalogState: "not_open",
  };
  it("converts wall times in the offering time zone to UTC (across the DST change)", () => {
    const { errors, times } = validateOffering(base);
    expect(errors).toEqual({});
    // 1 Nov 2026 is the US DST change; 09:00 that morning is EST (UTC-5).
    expect(times.startsAt).toBe("2026-11-01T14:00:00.000Z");
    expect(times.endsAt).toBe("2026-12-15T22:00:00.000Z");
  });
  it("uses Ho Chi Minh time when that is the offering zone", () => {
    const { times } = validateOffering({ ...base, timezone: "Asia/Ho_Chi_Minh" });
    expect(times.startsAt).toBe("2026-11-01T02:00:00.000Z");
  });
  it("rejects an end before the start and bad colors", () => {
    const { errors } = validateOffering({ ...base, endsLocal: "2026-10-01T09:00", accentColor: "blue" });
    expect(errors).toEqual({ endsAt: "dateTimeOrder", accentColor: "color" });
  });
  it("allows open-ended offerings", () => {
    const { errors, times } = validateOffering({ ...base, startsLocal: "", endsLocal: "" });
    expect(errors).toEqual({});
    expect(times).toEqual({ startsAt: null, endsAt: null });
  });
});

describe("sizes, ranges and expiry", () => {
  it("converts megabytes", () => {
    expect(megabytesToBytes("50")).toBe(52_428_800);
    expect(megabytesToBytes("0,5")).toBe(524_288);
    expect(megabytesToBytes("-1")).toBeNull();
    expect(megabytesToBytes("abc")).toBeNull();
    expect(bytesToMegabytes(52_428_800)).toBe("50");
    expect(bytesToMegabytes(1_572_864)).toBe("1.5");
  });

  it("turns an inclusive day range in a zone into UTC bounds", () => {
    expect(dayRangeToUtc("2026-10-05", "2026-10-05", "Asia/Ho_Chi_Minh")).toEqual({
      from: "2026-10-04T17:00:00.000Z",
      to: "2026-10-05T17:00:00.000Z",
    });
    expect(dayRangeToUtc("", "2026-12-31", "UTC")).toEqual({ from: null, to: "2027-01-01T00:00:00.000Z" });
  });

  it("only offers the listed expiry choices", () => {
    const now = new Date("2026-10-05T00:00:00Z");
    expect(expiryFromDays(14, now)).toBe("2026-10-19T00:00:00.000Z");
    expect(expiryFromDays(5, now)).toBeNull();
  });
});
