import { matchesSearch } from "@/components/public/text";

// Course catalog: the limited metadata projection returned by the catalog_list()
// database function, plus how each entry presents to the viewer.

export type CatalogRow = {
  offering_id: string;
  offering_code: string;
  course_code: string;
  title: string;
  summary: string;
  audience: string;
  expected_effort: string;
  cohort_name: string;
  term_label: string;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  catalog_state: "open_for_requests" | "not_open";
  my_state: "signed_out" | "enrolled" | "staff" | "requested" | "can_request" | "not_open";
};

/** What the viewer sees and can do for one entry. */
export type EntryState =
  | "enrolled"
  | "completed"
  | "staff"
  | "requested"
  | "can_request"
  | "not_open"
  | "inactive"
  | "signed_out_open"
  | "signed_out_closed";

/**
 * Combines the database's view of the entry with the viewer's own enrollment record.
 * A withdrawn or suspended enrollment blocks new requests (request_access refuses any
 * existing enrollment record), so it is shown as inactive instead of offering a request.
 */
export function entryState(row: Pick<CatalogRow, "my_state" | "catalog_state">, enrollmentStatus?: string | null): EntryState {
  switch (row.my_state) {
    case "signed_out":
      return row.catalog_state === "open_for_requests" ? "signed_out_open" : "signed_out_closed";
    case "enrolled":
      return enrollmentStatus === "completed" ? "completed" : "enrolled";
    case "staff":
      return "staff";
    case "requested":
      return "requested";
    default:
      if (enrollmentStatus && enrollmentStatus !== "active" && enrollmentStatus !== "completed") return "inactive";
      return row.my_state === "can_request" ? "can_request" : "not_open";
  }
}

export const AVAILABILITY = ["all", "open", "pending", "mine", "not_open"] as const;
export type Availability = (typeof AVAILABILITY)[number];

export function isAvailability(value: unknown): value is Availability {
  return typeof value === "string" && (AVAILABILITY as readonly string[]).includes(value);
}

function availabilityOf(state: EntryState): Exclude<Availability, "all"> {
  switch (state) {
    case "can_request":
    case "signed_out_open":
      return "open";
    case "requested":
      return "pending";
    case "enrolled":
    case "completed":
    case "staff":
    case "inactive":
      return "mine";
    default:
      return "not_open";
  }
}

export type CatalogFilters = { q: string; cohort: string; term: string; availability: Availability };

export function filterCatalog<T extends CatalogRow>(rows: T[], filters: CatalogFilters, stateOf: (row: T) => EntryState): T[] {
  return rows.filter((row) => {
    if (filters.cohort && row.cohort_name !== filters.cohort) return false;
    if (filters.term && row.term_label !== filters.term) return false;
    if (filters.availability !== "all" && availabilityOf(stateOf(row)) !== filters.availability) return false;
    return matchesSearch(filters.q, [row.title, row.course_code, row.offering_code, row.summary, row.audience, row.cohort_name, row.term_label]);
  });
}

/** Distinct cohort names and term labels for the filter menus, in locale order. */
export function catalogFacets(rows: CatalogRow[]): { cohorts: string[]; terms: string[] } {
  const sort = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "en"));
  return { cohorts: sort(rows.map((r) => r.cohort_name)), terms: sort(rows.map((r) => r.term_label)) };
}
