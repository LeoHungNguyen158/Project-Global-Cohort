import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

describe("safeNextPath", () => {
  it("keeps same-origin relative paths with query and hash", () => {
    expect(safeNextPath("/courses?filter=favorites#top")).toBe("/courses?filter=favorites#top");
    expect(safeNextPath("/grades/abc#item-1")).toBe("/grades/abc#item-1");
  });

  it("falls back for empty values", () => {
    expect(safeNextPath(null)).toBe("/activity");
    expect(safeNextPath(undefined)).toBe("/activity");
    expect(safeNextPath("")).toBe("/activity");
    expect(safeNextPath("", "/login")).toBe("/login");
  });

  it("rejects absolute, protocol-relative and scheme URLs", () => {
    for (const raw of [
      "https://evil.test/x",
      "//evil.test/x",
      "/\\evil.test",
      "\\\\evil.test",
      "javascript:alert(1)",
      "data:text/html,hi",
      "courses",
    ]) {
      expect(safeNextPath(raw), raw).toBe("/activity");
    }
  });

  it("rejects control characters that browsers strip into protocol-relative URLs", () => {
    expect(safeNextPath("/\t/evil.test")).toBe("/activity");
    expect(safeNextPath("/a\n/b")).toBe("/activity");
    expect(safeNextPath("/a\r\nSet-Cookie: x=1")).toBe("/activity");
  });

  it("normalizes dot segments without leaving the site", () => {
    expect(safeNextPath("/courses/../../etc")).toBe("/etc");
  });
});
