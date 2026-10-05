import { describe, expect, it } from "vitest";
import {
  checkPosition,
  checkResourceUrl,
  isToolCategory,
  linkHost,
  parseToolScope,
  scopeOfRow,
  scopeValue,
  type ToolScope,
} from "@/components/tools/validation";
import {
  canManageScope,
  filterTools,
  groupByCategory,
  inScope,
  manageableScopes,
  plainText,
  scopeLabel,
  sortTools,
  visibleScopes,
  type ManagerContext,
  type ScopeDirectory,
  type ToolRow,
} from "@/components/tools/scopes";

const FALL = "a72451b0-d983-4cba-be3d-731f9f7e3b7b";
const SPRING = "9982b221-62ab-44a0-8340-c5bd206f1385";
const AAF_F26 = "ec8ca15e-b048-465a-937e-5566284ce071";
const AAF_S27 = "7983009c-0c38-4010-a3de-13a1b41144ca";
const MASS_F26 = "24ed161b-3818-4d17-985c-5ceb8cf67ac5";

const dir: ScopeDirectory = {
  cohorts: [
    { id: SPRING, name: "Global Cohort — Spring 2027" },
    { id: FALL, name: "Global Cohort — Fall 2026" },
  ],
  offerings: [
    { id: MASS_F26, code: "MASS-F26", title: "Multi-Agent Systems Security", cohortId: FALL },
    { id: AAF_S27, code: "AAF-S27", title: "Agentic AI Foundations", cohortId: SPRING },
    { id: AAF_F26, code: "AAF-F26", title: "Agentic AI Foundations", cohortId: FALL },
  ],
};

const learner: ManagerContext = { isPlatformAdmin: false, coordinatorCohorts: [], staffOfferings: [] };
const instructor: ManagerContext = { isPlatformAdmin: false, coordinatorCohorts: [], staffOfferings: [AAF_F26, AAF_S27] };
const coordinator: ManagerContext = { isPlatformAdmin: false, coordinatorCohorts: [FALL], staffOfferings: [] };
const admin: ManagerContext = { isPlatformAdmin: true, coordinatorCohorts: [], staffOfferings: [] };

function tool(over: Partial<ToolRow>): ToolRow {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    offering_id: null,
    cohort_id: null,
    category: "resource",
    title: "Resource",
    description: "",
    body_html: "",
    url: null,
    published: true,
    position: 0,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    archived_at: null,
    ...over,
  };
}

describe("resource fields", () => {
  it("accepts only https links without credentials", () => {
    expect(checkResourceUrl("")).toEqual({ ok: true, url: null });
    expect(checkResourceUrl("  https://example.org/guide  ")).toEqual({ ok: true, url: "https://example.org/guide" });
    expect(checkResourceUrl("HTTPS://Example.org")).toEqual({ ok: true, url: "https://example.org/" });
    expect(checkResourceUrl("http://example.org").ok).toBe(false);
    expect(checkResourceUrl("javascript:alert(1)").ok).toBe(false);
    expect(checkResourceUrl("https://user:secret@example.org").ok).toBe(false);
    expect(checkResourceUrl("https://exa mple.org").ok).toBe(false);
    expect(checkResourceUrl("example.org").ok).toBe(false);
    expect(checkResourceUrl(`https://example.org/${"a".repeat(2000)}`).ok).toBe(false);
  });

  it("reads order as a whole number 0-9999", () => {
    expect(checkPosition("")).toBe(0);
    expect(checkPosition(" 12 ")).toBe(12);
    expect(checkPosition("9999")).toBe(9999);
    expect(checkPosition("10000")).toBeNull();
    expect(checkPosition("-1")).toBeNull();
    expect(checkPosition("1.5")).toBeNull();
    expect(checkPosition(null)).toBe(0);
  });

  it("parses scopes and categories strictly", () => {
    expect(parseToolScope("platform")).toEqual({ kind: "platform" });
    expect(parseToolScope(`cohort:${FALL.toUpperCase()}`)).toEqual({ kind: "cohort", id: FALL });
    expect(parseToolScope(`offering:${AAF_S27}`)).toEqual({ kind: "offering", id: AAF_S27 });
    expect(parseToolScope("offering:not-a-uuid")).toBeNull();
    expect(parseToolScope("course:" + AAF_S27)).toBeNull();
    expect(parseToolScope(undefined)).toBeNull();
    for (const s of [{ kind: "platform" }, { kind: "cohort", id: FALL }, { kind: "offering", id: AAF_S27 }] as ToolScope[]) {
      expect(parseToolScope(scopeValue(s))).toEqual(s);
    }
    expect(scopeOfRow({ offering_id: AAF_S27, cohort_id: null })).toEqual({ kind: "offering", id: AAF_S27 });
    expect(scopeOfRow({ offering_id: null, cohort_id: FALL })).toEqual({ kind: "cohort", id: FALL });
    expect(scopeOfRow({ offering_id: null, cohort_id: null })).toEqual({ kind: "platform" });
    expect(isToolCategory("setup")).toBe(true);
    expect(isToolCategory("misc")).toBe(false);
    expect(linkHost("https://www.example.org/a")).toBe("example.org");
    expect(linkHost(null)).toBeNull();
  });
});

describe("who manages which scope (mirrors tools_write)", () => {
  const platform: ToolScope = { kind: "platform" };
  const fall: ToolScope = { kind: "cohort", id: FALL };
  const aafF26: ToolScope = { kind: "offering", id: AAF_F26 };
  const mass: ToolScope = { kind: "offering", id: MASS_F26 };

  it("learners manage nothing", () => {
    expect([platform, fall, aafF26].some((s) => canManageScope(learner, s, dir))).toBe(false);
    expect(manageableScopes(learner, dir)).toEqual([]);
  });

  it("course staff manage only their offerings", () => {
    expect(canManageScope(instructor, aafF26, dir)).toBe(true);
    expect(canManageScope(instructor, mass, dir)).toBe(false);
    expect(canManageScope(instructor, fall, dir)).toBe(false);
    expect(canManageScope(instructor, platform, dir)).toBe(false);
    expect(manageableScopes(instructor, dir).map(scopeValue)).toEqual([`offering:${AAF_F26}`, `offering:${AAF_S27}`]);
  });

  it("coordinators manage their cohort and its offerings", () => {
    expect(manageableScopes(coordinator, dir).map(scopeValue)).toEqual([`cohort:${FALL}`, `offering:${AAF_F26}`, `offering:${MASS_F26}`]);
    expect(canManageScope(coordinator, { kind: "offering", id: AAF_S27 }, dir)).toBe(false);
  });

  it("platform admins manage every scope, platform-wide first", () => {
    expect(manageableScopes(admin, dir).map(scopeValue)).toEqual([
      "platform",
      `cohort:${FALL}`,
      `cohort:${SPRING}`,
      `offering:${AAF_F26}`,
      `offering:${AAF_S27}`,
      `offering:${MASS_F26}`,
    ]);
    expect(visibleScopes(dir)).toHaveLength(6);
  });
});

describe("directory listing", () => {
  const rows = [
    tool({ id: "1", title: "Getting help", category: "support", position: 2 }),
    tool({ id: "2", title: "Orientation recording", cohort_id: FALL }),
    tool({ id: "3", title: "Sample repository", offering_id: AAF_F26, body_html: "<p>Clone with <strong>git</strong> &amp; run tests</p>" }),
    tool({ id: "4", title: "Spring syllabus", offering_id: AAF_S27, description: "Lịch học mùa xuân" }),
    tool({ id: "5", title: "Browser checklist", category: "setup", position: 0 }),
    tool({ id: "6", title: "Audio checklist", category: "setup", position: 0, cohort_id: SPRING }),
  ];
  const ids = (list: ToolRow[]) => list.map((r) => r.id);

  it("treats a cohort as including the courses in it", () => {
    expect(inScope(rows[2], { kind: "cohort", id: FALL }, dir)).toBe(true);
    expect(inScope(rows[3], { kind: "cohort", id: FALL }, dir)).toBe(false);
    expect(inScope(rows[1], { kind: "cohort", id: FALL }, dir)).toBe(true);
    expect(inScope(rows[0], { kind: "cohort", id: FALL }, dir)).toBe(false);
    expect(inScope(rows[0], { kind: "platform" }, dir)).toBe(true);
    expect(inScope(rows[2], { kind: "offering", id: AAF_F26 }, dir)).toBe(true);
    expect(inScope(rows[1], { kind: "offering", id: AAF_F26 }, dir)).toBe(false);
    expect(inScope(rows[1], null, dir)).toBe(true);
  });

  it("searches titles, descriptions, details and scope names without accents", () => {
    const f = (q: string) => ids(filterTools(rows, { q, category: "all", scope: null }, dir));
    expect(f("lich hoc")).toEqual(["4"]);
    expect(f("git run")).toEqual(["3"]);
    expect(f("fall 2026")).toEqual(["2"]);
    expect(f("aaf-f26")).toEqual(["3"]);
    expect(ids(filterTools(rows, { q: "", category: "setup", scope: null }, dir))).toEqual(["5", "6"]);
    expect(ids(filterTools(rows, { q: "", category: "all", scope: { kind: "cohort", id: FALL } }, dir))).toEqual(["2", "3"]);
  });

  it("orders by position, then platform before cohort before course, then title", () => {
    expect(ids(sortTools(rows))).toEqual(["5", "6", "2", "3", "4", "1"]);
    expect(groupByCategory(rows).map((g) => [g.category, ids(g.rows)])).toEqual([
      ["setup", ["5", "6"]],
      ["support", ["1"]],
      ["resource", ["2", "3", "4"]],
    ]);
  });

  it("labels scopes and extracts plain text for search", () => {
    expect(scopeLabel({ kind: "platform" }, dir)).toBe("Platform-wide");
    expect(scopeLabel({ kind: "cohort", id: FALL }, dir)).toBe("Cohort: Global Cohort — Fall 2026");
    expect(scopeLabel({ kind: "offering", id: AAF_S27 }, dir)).toBe("Course: AAF-S27 — Agentic AI Foundations");
    expect(plainText("<p>A &amp; B</p><ul><li>C</li></ul>")).toBe("A & B C");
  });
});
