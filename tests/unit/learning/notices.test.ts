import { describe, expect, it } from "vitest";
import { parseNotice, withNotice } from "@/lib/learning/notices";

describe("action notices", () => {
  it("accepts only known notice codes", () => {
    expect(parseNotice("published")).toBe("published");
    expect(parseNotice(["overrideRevoked", "published"])).toBe("overrideRevoked");
    expect(parseNotice("Published")).toBeNull();
    expect(parseNotice("<script>")).toBeNull();
    expect(parseNotice("")).toBeNull();
    expect(parseNotice(undefined)).toBeNull();
    expect(parseNotice(null)).toBeNull();
  });

  it("adds the notice to a path, keeping its query and fragment", () => {
    expect(withNotice("/courses/a/content/manage", "released")).toBe("/courses/a/content/manage?notice=released");
    expect(withNotice("/courses/a/people/b?x=1", "overrideRevoked")).toBe("/courses/a/people/b?x=1&notice=overrideRevoked");
    expect(withNotice("/courses/a/people/b#grant-override", "overrideRevoked")).toBe("/courses/a/people/b?notice=overrideRevoked#grant-override");
  });
});
