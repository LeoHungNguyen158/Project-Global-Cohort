import { describe, expect, it } from "vitest";
import { bool, dateTime, int, isHttpsUrl, isUuid, num, optStr, str, uuid, uuids } from "@/lib/forms";

function form(entries: [string, string][]) {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

describe("form readers", () => {
  it("trims and limits strings", () => {
    const fd = form([["title", "  Tuần 1: Giới thiệu  "], ["long", "x".repeat(50)], ["blank", "   "]]);
    expect(str(fd, "title")).toBe("Tuần 1: Giới thiệu");
    expect(str(fd, "long", 10)).toHaveLength(10);
    expect(str(fd, "missing")).toBe("");
    expect(optStr(fd, "blank")).toBeNull();
  });

  it("reads checkboxes, numbers and integers strictly", () => {
    const fd = form([["on", "on"], ["n", "12.5"], ["i", "7"], ["bad", "7abc"], ["inf", "Infinity"]]);
    expect(bool(fd, "on")).toBe(true);
    expect(bool(fd, "missing")).toBe(false);
    expect(num(fd, "n")).toBe(12.5);
    expect(int(fd, "n")).toBeNull();
    expect(int(fd, "i")).toBe(7);
    expect(num(fd, "bad")).toBeNull();
    expect(num(fd, "inf")).toBeNull();
    expect(num(fd, "missing")).toBeNull();
  });

  it("accepts only well-formed UUIDs", () => {
    const id = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
    const fd = form([["id", id], ["ids", id], ["ids", "not-a-uuid"], ["ids", `${id}' or 1=1`]]);
    expect(uuid(fd, "id")).toBe(id);
    expect(uuids(fd, "ids")).toEqual([id]);
    expect(isUuid("123")).toBe(false);
  });

  it("converts a DateTimeField value from the zone it was entered in", () => {
    expect(dateTime(form([["due", "2026-11-02T09:00"], ["due__tz", "Asia/Ho_Chi_Minh"]]), "due")).toBe("2026-11-02T02:00:00.000Z");
    expect(dateTime(form([["due", "2026-11-02T09:00"], ["due__tz", "America/New_York"]]), "due")).toBe("2026-11-02T14:00:00.000Z");
    expect(dateTime(form([["due", ""]]), "due")).toBeNull();
    expect(dateTime(form([["due", "2026-11-02T09:00"], ["due__tz", "Not/A_Zone"]]), "due")).toBe("invalid");
    expect(dateTime(form([["due", "tomorrow"]]), "due")).toBe("invalid");
  });

  it("accepts only https URLs", () => {
    expect(isHttpsUrl("https://example.test/path?q=1")).toBe(true);
    expect(isHttpsUrl("http://example.test")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("not a url")).toBe(false);
  });
});
