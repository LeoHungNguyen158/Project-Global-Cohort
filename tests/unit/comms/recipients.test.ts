import { describe, expect, it } from "vitest";
import {
  allowedSelection, filterRecipients, foldForSearch, LARGE_GROUP_THRESHOLD, matchesQuery, matchesRoleFilter, needsGroupConfirmation,
  parseRoleFilter, sortRecipients, toRecipientRole, type Recipient,
} from "@/lib/comms/recipients";

const people: Recipient[] = [
  { id: "3", name: "Đặng Quốc Huy", role: "learner" },
  { id: "1", name: "Mai Trần", role: "instructor" },
  { id: "4", name: "Aiko Tanaka", role: "learner" },
  { id: "2", name: "Linh Phạm", role: "ta" },
  { id: "5", name: "Lê Thị Bình", role: "learner" },
];

describe("search folding", () => {
  it("ignores case and Vietnamese diacritics, including Đ/đ", () => {
    expect(foldForSearch("  Đặng   Quốc Huy ")).toBe("dang quoc huy");
    expect(matchesQuery("Mai Trần", "tran")).toBe(true);
    expect(matchesQuery("Đặng Quốc Huy", "dang huy")).toBe(true);
    expect(matchesQuery("Lê Thị Bình", "LE BINH")).toBe(true);
    expect(matchesQuery("Lê Thị Bình", "binh mai")).toBe(false);
    expect(matchesQuery("Anyone", "   ")).toBe(true);
  });
});

describe("sortRecipients", () => {
  it("lists staff first, then everyone else by name", () => {
    expect(sortRecipients(people).map((p) => p.name)).toEqual(["Mai Trần", "Linh Phạm", "Aiko Tanaka", "Đặng Quốc Huy", "Lê Thị Bình"]);
  });
});

describe("filterRecipients", () => {
  it("limits how many matches are listed and reports the total", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `Person ${i}`, role: "learner" as const }));
    const r = filterRecipients(many, "person", 60);
    expect(r.shown).toHaveLength(60);
    expect(r.total).toBe(100);
    expect(filterRecipients(people, "huy").shown.map((p) => p.id)).toEqual(["3"]);
  });
});

describe("selection", () => {
  it("drops ids that are not in the allowed list", () => {
    expect(allowedSelection(people, ["1", "999", "5", "1"])).toEqual(["1", "5"]);
  });

  it("mirrors the database's large-group rule", () => {
    expect(needsGroupConfirmation(LARGE_GROUP_THRESHOLD)).toBe(false);
    expect(needsGroupConfirmation(LARGE_GROUP_THRESHOLD + 1)).toBe(true);
  });

  it("filters by staff or learners", () => {
    expect(people.filter((p) => matchesRoleFilter(p.role, "staff")).map((p) => p.id)).toEqual(["1", "2"]);
    expect(people.filter((p) => matchesRoleFilter(p.role, "learners")).map((p) => p.id)).toEqual(["3", "4", "5"]);
    expect(matchesRoleFilter("coordinator", "staff")).toBe(true);
    expect(matchesRoleFilter("participant", "learners")).toBe(true);
    expect(parseRoleFilter("staff")).toBe("staff");
    expect(parseRoleFilter("everyone")).toBe("all");
  });

  it("maps unknown roles to participant", () => {
    expect(toRecipientRole("ta")).toBe("ta");
    expect(toRecipientRole("staff")).toBe("participant");
    expect(toRecipientRole(null)).toBe("participant");
  });
});
