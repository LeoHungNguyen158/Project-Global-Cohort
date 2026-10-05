import { describe, expect, it } from "vitest";
import { BIO_MAX, DISPLAY_NAME_MAX, checkBio, checkDisplayName, checkNewPassword, isProfileLocale } from "@/components/profile/validation";
import {
  buildTimeZoneOptions,
  canonicalTimeZone,
  filterTimeZones,
  formatUtcOffset,
  isValidTimeZoneId,
  listTimeZones,
  offsetMinutes,
  timeZoneLabel,
} from "@/components/profile/timezones";

describe("display name", () => {
  it("keeps Vietnamese names exactly (as NFC) and collapses spacing", () => {
    expect(checkDisplayName("  Nguyễn   Thị Hồng Nhung ")).toEqual({ ok: true, value: "Nguyễn Thị Hồng Nhung" });
    const nfd = "Võ Thanh Hà".normalize("NFD");
    const checked = checkDisplayName(nfd);
    expect(checked.ok && checked.value).toBe("Võ Thanh Hà".normalize("NFC"));
  });

  it("requires a name and counts characters, not UTF-16 units", () => {
    expect(checkDisplayName("   ")).toEqual({ ok: false, error: "required" });
    expect(checkDisplayName(undefined)).toEqual({ ok: false, error: "required" });
    expect(checkDisplayName("ễ".repeat(DISPLAY_NAME_MAX)).ok).toBe(true);
    expect(checkDisplayName("😀".repeat(DISPLAY_NAME_MAX)).ok).toBe(true);
    expect(checkDisplayName("a".repeat(DISPLAY_NAME_MAX + 1))).toEqual({ ok: false, error: "tooLong" });
  });

  it("limits the bio and keeps its line breaks", () => {
    expect(checkBio("Line one\r\nLine two")).toEqual({ ok: true, value: "Line one\nLine two" });
    expect(checkBio("x".repeat(BIO_MAX + 1))).toEqual({ ok: false, error: "tooLong" });
    expect(checkBio(null)).toEqual({ ok: true, value: "" });
  });

  it("accepts only supported locales", () => {
    expect(isProfileLocale("en")).toBe(true);
    expect(isProfileLocale("vi")).toBe(true);
    expect(isProfileLocale("fr")).toBe(false);
    expect(isProfileLocale(undefined)).toBe(false);
  });
});

describe("new password rules", () => {
  it("matches the sign-up/reset rules", () => {
    expect(checkNewPassword("short1", "short1")).toBe("tooShort");
    expect(checkNewPassword("a1".repeat(101), "a1".repeat(101))).toBe("tooLong");
    expect(checkNewPassword("1234567890", "1234567890")).toBe("letter");
    expect(checkNewPassword("abcdefghij", "abcdefghij")).toBe("number");
    expect(checkNewPassword("abcdefghi1", "abcdefghi2")).toBe("mismatch");
    expect(checkNewPassword("Mật khẩu mới 2026", "Mật khẩu mới 2026")).toBeNull();
    expect(checkNewPassword(undefined, undefined)).toBe("tooShort");
  });
});

describe("time zones", () => {
  it("stores current IANA names for renamed zones", () => {
    expect(canonicalTimeZone("Asia/Saigon")).toBe("Asia/Ho_Chi_Minh");
    expect(canonicalTimeZone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(canonicalTimeZone("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(canonicalTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("lists valid, de-duplicated zones including UTC", () => {
    const zones = listTimeZones(["Asia/Saigon", "Asia/Ho_Chi_Minh", "America/New_York", "Not/AZone"]);
    expect(zones).toEqual(["America/New_York", "Asia/Ho_Chi_Minh", "UTC"]);
    const all = listTimeZones();
    expect(all).toContain("Asia/Ho_Chi_Minh");
    expect(all).toContain("UTC");
    expect(all).not.toContain("Asia/Saigon");
    expect(isValidTimeZoneId("Asia/Ho_Chi_Minh")).toBe(true);
    expect(isValidTimeZoneId("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZoneId("")).toBe(false);
  });

  it("computes DST-aware offsets and formats them", () => {
    const october = new Date("2026-10-05T12:00:00Z");
    const january = new Date("2027-01-15T12:00:00Z");
    expect(offsetMinutes("Asia/Ho_Chi_Minh", october)).toBe(420);
    expect(offsetMinutes("America/New_York", october)).toBe(-240);
    expect(offsetMinutes("America/New_York", january)).toBe(-300);
    expect(offsetMinutes("Asia/Kathmandu", october)).toBe(345);
    expect(offsetMinutes("UTC", october)).toBe(0);
    expect(formatUtcOffset(420)).toBe("UTC+07:00");
    expect(formatUtcOffset(-240)).toBe("UTC-04:00");
    expect(formatUtcOffset(345)).toBe("UTC+05:45");
    expect(formatUtcOffset(0)).toBe("UTC+00:00");
    expect(timeZoneLabel({ value: "Asia/Ho_Chi_Minh", offset: 420 })).toBe("(UTC+07:00) Asia/Ho Chi Minh");
  });

  it("orders options by offset and keeps a stored zone that is not listed", () => {
    const at = new Date("2026-10-05T12:00:00Z");
    const options = buildTimeZoneOptions(at, "Asia/Saigon", ["UTC", "Asia/Ho_Chi_Minh", "America/New_York"]);
    expect(options.map((o) => o.value)).toEqual(["America/New_York", "UTC", "Asia/Ho_Chi_Minh", "Asia/Saigon"]);
    expect(buildTimeZoneOptions(at, "Bad/Zone", ["UTC"]).map((o) => o.value)).toEqual(["UTC"]);
  });

  it("finds zones by city, Vietnamese spelling, former name and offset", () => {
    const options = buildTimeZoneOptions(new Date("2026-10-05T12:00:00Z"));
    const values = (q: string) => filterTimeZones(options, q).map((o) => o.value);
    expect(values("Hanoi")).toContain("Asia/Ho_Chi_Minh");
    expect(values("Hà Nội")).toContain("Asia/Ho_Chi_Minh");
    expect(values("sai gon")).toContain("Asia/Ho_Chi_Minh");
    expect(values("+7")).toContain("Asia/Ho_Chi_Minh");
    expect(values("+7")).not.toContain("America/New_York");
    expect(values("new york")).toEqual(["America/New_York"]);
    expect(values("calcutta")).toContain("Asia/Kolkata");
    expect(values("")).toHaveLength(options.length);
  });
});
