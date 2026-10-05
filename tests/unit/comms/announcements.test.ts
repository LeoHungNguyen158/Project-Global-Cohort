import { describe, expect, it } from "vitest";
import {
  allowedOps, announcementDate, announcementState, groupByState, isAllowedOp, parsePublishMode, resolvePublication, sortAnnouncements,
} from "@/lib/comms/announcements";

const now = new Date("2026-10-05T12:00:00Z");

describe("announcementState", () => {
  it("distinguishes draft, scheduled, published and archived by server-set fields", () => {
    expect(announcementState({ status: "draft", publish_at: null }, now)).toBe("draft");
    expect(announcementState({ status: "published", publish_at: null }, now)).toBe("published");
    expect(announcementState({ status: "published", publish_at: "2026-10-05T12:00:01Z" }, now)).toBe("scheduled");
    expect(announcementState({ status: "published", publish_at: "2026-10-05T11:59:59Z" }, now)).toBe("published");
    expect(announcementState({ status: "archived", publish_at: null }, now)).toBe("archived");
  });
});

describe("ordering", () => {
  it("shows pinned first, then newest first by publication time", () => {
    const list = [
      { id: "old", status: "published", publish_at: null, created_at: "2026-10-01T00:00:00Z", pinned: false },
      { id: "new", status: "published", publish_at: "2026-10-04T00:00:00Z", created_at: "2026-09-01T00:00:00Z", pinned: false },
      { id: "pin", status: "published", publish_at: null, created_at: "2026-09-15T00:00:00Z", pinned: true },
    ];
    expect(sortAnnouncements(list).map((a) => a.id)).toEqual(["pin", "new", "old"]);
    expect(announcementDate(list[1])).toBe("2026-10-04T00:00:00Z");
    const groups = groupByState([...list, { id: "s", status: "published", publish_at: "2026-10-06T00:00:00Z", created_at: "2026-10-05T00:00:00Z", pinned: false }], now);
    expect(groups.published.map((a) => a.id)).toEqual(["pin", "new", "old"]);
    expect(groups.scheduled.map((a) => a.id)).toEqual(["s"]);
  });
});

describe("resolvePublication", () => {
  it("lets the database stamp 'publish now' and requires a future time to schedule", () => {
    expect(resolvePublication("now", null, now)).toEqual({ ok: true, status: "published", publish_at: null });
    expect(resolvePublication("draft", "2026-10-06T00:00:00Z", now)).toEqual({ ok: true, status: "draft", publish_at: null });
    expect(resolvePublication("keep", null, now)).toEqual({ ok: true });
    expect(resolvePublication("schedule", "2026-10-06T00:00:00.000Z", now)).toEqual({ ok: true, status: "published", publish_at: "2026-10-06T00:00:00.000Z" });
    expect(resolvePublication("schedule", null, now)).toEqual({ ok: false, error: "scheduleMissing" });
    expect(resolvePublication("schedule", "invalid", now)).toEqual({ ok: false, error: "scheduleInvalid" });
    expect(resolvePublication("schedule", "2026-10-05T12:00:00.000Z", now)).toEqual({ ok: false, error: "schedulePast" });
  });

  it("parses only known modes", () => {
    expect(parsePublishMode("now")).toBe("now");
    expect(parsePublishMode("publish")).toBeNull();
  });
});

describe("allowed list actions", () => {
  it("offers only transitions that make sense for the state", () => {
    expect(allowedOps("draft", false)).toEqual(["publish", "pin", "archive"]);
    expect(allowedOps("scheduled", true)).toEqual(["publish", "unschedule", "unpin", "archive"]);
    expect(allowedOps("published", false)).toEqual(["pin", "archive"]);
    expect(allowedOps("archived", false)).toEqual(["restore"]);
    expect(isAllowedOp("publish", "published", false)).toBe(false);
    expect(isAllowedOp("restore", "archived", false)).toBe(true);
  });
});
