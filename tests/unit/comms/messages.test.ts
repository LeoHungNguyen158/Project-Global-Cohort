import { describe, expect, it } from "vitest";
import { countUnread, isClientKey, isValidCursor, latestCursor, mergeMessages, newClientKey, pollAfter, pollDelay, summarizeNames, type ThreadMessage } from "@/lib/comms/messages";
import { compareTimestamps, timestampMicros } from "@/lib/comms/timestamps";

const msg = (id: string, createdAt: string, senderId = "u1"): ThreadMessage => ({ id, senderId, senderName: "N", body: id, createdAt, attachments: [] });

describe("timestamps", () => {
  it("keeps microsecond precision from the database", () => {
    const a = timestampMicros("2026-10-05T01:16:45.31+00:00")!;
    const b = timestampMicros("2026-10-05T01:16:45.316865+00:00")!;
    expect(b - a).toBe(6865);
    expect(timestampMicros("2026-10-05T01:16:45Z")).toBe(Date.parse("2026-10-05T01:16:45Z") * 1000);
    expect(timestampMicros("2026-10-05 08:16:45+07")).toBe(Date.parse("2026-10-05T01:16:45Z") * 1000);
    expect(timestampMicros("yesterday")).toBeNull();
    expect(compareTimestamps("2026-10-05T01:16:45.5Z", "2026-10-05T01:16:45.316865+00:00")).toBeGreaterThan(0);
  });

  it("accepts only timestamps as poll cursors", () => {
    expect(isValidCursor("2026-10-05T01:16:45.316865+00:00")).toBe(true);
    expect(isValidCursor("2026-10-05T01:16:45.316865+00:00,created_at.lt.now")).toBe(false);
    expect(isValidCursor("")).toBe(false);
    expect(isValidCursor(null)).toBe(false);
  });
});

describe("mergeMessages", () => {
  it("dedupes by id and orders oldest first, including same-millisecond messages", () => {
    const current = [msg("b", "2026-10-05T01:00:00.000200+00:00"), msg("a", "2026-10-05T01:00:00.000100+00:00")];
    const merged = mergeMessages(current, [msg("c", "2026-10-05T01:00:00.000300+00:00"), msg("a", "2026-10-05T01:00:00.000100+00:00")]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(latestCursor(merged)).toBe("2026-10-05T01:00:00.000300+00:00");
    expect(mergeMessages(current, [])).toBe(current);
    expect(latestCursor([])).toBeNull();
  });
});

describe("countUnread", () => {
  it("counts other people's messages after the last read time", () => {
    const list = [msg("1", "2026-10-05T01:00:00Z", "me"), msg("2", "2026-10-05T01:01:00Z", "x"), msg("3", "2026-10-05T01:02:00Z", "x")];
    expect(countUnread(list, "me", null)).toBe(2);
    expect(countUnread(list, "me", "2026-10-05T01:01:00Z")).toBe(1);
    expect(countUnread(list, "x", null)).toBe(1);
  });
});

describe("polling and helpers", () => {
  it("backs off exponentially and caps the delay", () => {
    expect(pollDelay(0, 10_000, 120_000)).toBe(10_000);
    expect(pollDelay(1, 10_000, 120_000)).toBe(20_000);
    expect(pollDelay(3, 10_000, 120_000)).toBe(80_000);
    expect(pollDelay(50, 10_000, 120_000)).toBe(120_000);
  });

  it("summarizes participant names", () => {
    expect(summarizeNames(["A", "B", "C", "D"], 6)).toEqual({ shown: ["A", "B", "C"], more: 3 });
    expect(summarizeNames(["A"], 1)).toEqual({ shown: ["A"], more: 0 });
  });

  it("accepts only safe client keys", () => {
    expect(isClientKey("0b1f0a7e-1c55-4c43-9a43-5a1b8a0c3a11")).toBe(true);
    expect(isClientKey("short")).toBe(false);
    expect(isClientKey("bad key with spaces")).toBe(false);
  });

  it("polls with a small overlap before the newest message", () => {
    expect(pollAfter("2026-10-05T01:16:45.316865+00:00", 5000)).toBe("2026-10-05T01:16:40.316Z");
    expect(isValidCursor(pollAfter("2026-10-05T01:16:45Z"))).toBe(true);
    expect(pollAfter(null)).toBeNull();
    expect(pollAfter("not a time")).toBeNull();
  });

  it("creates distinct client keys the server accepts", () => {
    const a = newClientKey();
    const b = newClientKey();
    expect(isClientKey(a)).toBe(true);
    expect(isClientKey(b)).toBe(true);
    expect(a).not.toBe(b);
  });
});
