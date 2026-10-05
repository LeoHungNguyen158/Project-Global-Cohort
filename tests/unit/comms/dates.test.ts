import { describe, expect, it } from "vitest";
import { formatDay } from "@/lib/comms/dates";

describe("formatDay", () => {
  it("formats calendar dates without shifting them by time zone", () => {
    expect(formatDay("2026-08-26")).toBe("Aug 26, 2026");
    expect(formatDay("2027-01-03")).toBe("Jan 3, 2027");
    expect(formatDay(null)).toBe("");
    expect(formatDay("soon")).toBe("soon");
  });
});
