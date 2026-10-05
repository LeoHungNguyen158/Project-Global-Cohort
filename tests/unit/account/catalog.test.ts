import { describe, expect, it } from "vitest";
import { catalogFacets, entryState, filterCatalog, isAvailability, type CatalogRow } from "@/components/catalog/catalog";

function row(over: Partial<CatalogRow>): CatalogRow {
  return {
    offering_id: "00000000-0000-4000-8000-000000000001",
    offering_code: "AAF-S27",
    course_code: "AAF",
    title: "Agentic AI Foundations",
    summary: "Build and evaluate agents.",
    audience: "Engineers",
    expected_effort: "4 hours a week",
    cohort_name: "Global Cohort — Spring 2027",
    term_label: "Spring 2027",
    starts_at: null,
    ends_at: null,
    timezone: "America/New_York",
    catalog_state: "open_for_requests",
    my_state: "can_request",
    ...over,
  };
}

describe("catalog entry state", () => {
  it("follows the database's view of the viewer", () => {
    expect(entryState(row({ my_state: "enrolled" }), "active")).toBe("enrolled");
    expect(entryState(row({ my_state: "enrolled" }), "completed")).toBe("completed");
    expect(entryState(row({ my_state: "staff" }))).toBe("staff");
    expect(entryState(row({ my_state: "requested" }))).toBe("requested");
    expect(entryState(row({ my_state: "can_request" }))).toBe("can_request");
    expect(entryState(row({ my_state: "not_open", catalog_state: "not_open" }))).toBe("not_open");
  });

  it("does not offer a request when an inactive enrollment record exists", () => {
    expect(entryState(row({ my_state: "can_request" }), "withdrawn")).toBe("inactive");
    expect(entryState(row({ my_state: "not_open" }), "suspended")).toBe("inactive");
  });

  it("asks signed-out visitors to sign in only for open entries", () => {
    expect(entryState(row({ my_state: "signed_out", catalog_state: "open_for_requests" }))).toBe("signed_out_open");
    expect(entryState(row({ my_state: "signed_out", catalog_state: "not_open" }))).toBe("signed_out_closed");
  });
});

describe("catalog filters", () => {
  const rows = [
    row({ offering_id: "1", offering_code: "AAF-S27", my_state: "can_request" }),
    row({ offering_id: "2", offering_code: "MASS-F26", title: "Multi-Agent Systems Security", cohort_name: "Global Cohort — Fall 2026", term_label: "Fall 2026", my_state: "enrolled" }),
    row({ offering_id: "3", offering_code: "AIGE-SUM26", title: "Quản trị AI", term_label: "Summer 2026", catalog_state: "not_open", my_state: "not_open" }),
    row({ offering_id: "4", offering_code: "REQ-1", title: "Requested course", my_state: "requested" }),
  ];
  const stateOf = (r: CatalogRow) => entryState(r, r.my_state === "enrolled" ? "active" : null);
  const codes = (f: Partial<Parameters<typeof filterCatalog>[1]>) =>
    filterCatalog(rows, { q: "", cohort: "", term: "", availability: "all", ...f }, stateOf).map((r) => r.offering_code);

  it("searches text without accents or case", () => {
    expect(codes({ q: "quan tri" })).toEqual(["AIGE-SUM26"]);
    expect(codes({ q: "mass-f26" })).toEqual(["MASS-F26"]);
    expect(codes({ q: "nothing matches" })).toEqual([]);
  });

  it("filters by cohort, term and availability", () => {
    expect(codes({ cohort: "Global Cohort — Fall 2026" })).toEqual(["MASS-F26"]);
    expect(codes({ term: "Summer 2026" })).toEqual(["AIGE-SUM26"]);
    expect(codes({ availability: "open" })).toEqual(["AAF-S27"]);
    expect(codes({ availability: "pending" })).toEqual(["REQ-1"]);
    expect(codes({ availability: "mine" })).toEqual(["MASS-F26"]);
    expect(codes({ availability: "not_open" })).toEqual(["AIGE-SUM26"]);
  });

  it("lists distinct facets and validates availability values", () => {
    expect(catalogFacets(rows)).toEqual({
      cohorts: ["Global Cohort — Fall 2026", "Global Cohort — Spring 2027"],
      terms: ["Fall 2026", "Spring 2027", "Summer 2026"],
    });
    expect(isAvailability("pending")).toBe(true);
    expect(isAvailability("paid")).toBe(false);
  });
});
