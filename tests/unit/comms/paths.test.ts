import { describe, expect, it } from "vitest";
import { announcementAnchor, announcementScope, newTopicPath, threadPath, topicPath, topicScope, topicsPath } from "@/lib/comms/paths";

describe("comms URL contract", () => {
  it("matches the links notifications and other areas use", () => {
    expect(threadPath("t1")).toBe("/messages/t1");
    expect(announcementAnchor({ type: "offering", id: "o1" }, "a1")).toBe("/courses/o1/announcements#a-a1");
    expect(announcementAnchor({ type: "cohort", id: "c1" }, "a1")).toBe("/cohorts/c1#a-a1");
    expect(topicPath({ type: "offering", id: "o1" }, "t1")).toBe("/courses/o1/discussions/t1");
    expect(topicPath({ type: "cohort", id: "c1" }, "t1")).toBe("/cohorts/c1/discussions/t1");
    expect(topicPath({ type: "community", id: "m1" }, "t1")).toBe("/cohorts/communities/m1/topics/t1");
    expect(topicsPath({ type: "community", id: "m1" })).toBe("/cohorts/communities/m1");
    expect(newTopicPath({ type: "community", id: "m1" })).toBe("/cohorts/communities/m1/topics/new");
    expect(newTopicPath({ type: "offering", id: "o1" })).toBe("/courses/o1/discussions/new");
  });

  it("derives a record's scope from its stored ids", () => {
    expect(topicScope({ offering_id: null, cohort_id: null, community_id: "m" })).toEqual({ type: "community", id: "m" });
    expect(topicScope({ offering_id: null, cohort_id: null, community_id: null })).toBeNull();
    expect(announcementScope({ offering_id: null, cohort_id: "c" })).toEqual({ type: "cohort", id: "c" });
  });
});
