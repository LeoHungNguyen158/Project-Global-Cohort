// Recipient picker logic. The list itself comes from comms_recipients(), which only
// returns people the database will accept for the chosen scope; these helpers sort
// and search it and mirror the database's large-group confirmation rule.

/** create_thread() requires explicit confirmation above this many recipients (P0428). */
export const LARGE_GROUP_THRESHOLD = 10;
/** create_thread() rejects more recipients than this. */
export const MAX_RECIPIENTS = 500;
/** How many search matches the picker lists at once. */
export const PICKER_PAGE = 60;

export type RecipientRole = "instructor" | "ta" | "coordinator" | "learner" | "participant";
export type Recipient = { id: string; name: string; role: RecipientRole };

const ROLE_RANK: Record<RecipientRole, number> = { instructor: 0, ta: 1, coordinator: 2, learner: 3, participant: 3 };

export function toRecipientRole(value: string | null | undefined): RecipientRole {
  return value === "instructor" || value === "ta" || value === "coordinator" || value === "learner" ? value : "participant";
}

export function needsGroupConfirmation(count: number): boolean {
  return count > LARGE_GROUP_THRESHOLD;
}

/**
 * Case- and accent-insensitive form for searching names, so "dang quoc huy" finds
 * "Đặng Quốc Huy" and "tran" finds "Trần". Đ/đ do not decompose in Unicode, so they
 * are mapped explicitly.
 */
export function foldForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word of the query must appear somewhere in the name. */
export function matchesQuery(name: string, query: string): boolean {
  const q = foldForSearch(query);
  if (!q) return true;
  const hay = foldForSearch(name);
  return q.split(" ").every((token) => hay.includes(token));
}

/** Staff first (instructors, assistants, coordinators), then everyone else; by name within each group. */
export function sortRecipients<T extends Recipient>(list: T[]): T[] {
  return [...list].sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.name.localeCompare(b.name, "vi") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function filterRecipients<T extends Recipient>(list: T[], query: string, limit = PICKER_PAGE): { shown: T[]; total: number } {
  const matches = list.filter((r) => matchesQuery(r.name, query));
  return { shown: matches.slice(0, limit), total: matches.length };
}

/** Keeps only ids that are in the allowed list, without duplicates, in list order. */
export function allowedSelection(allowed: { id: string }[], requested: Iterable<string>): string[] {
  const wanted = new Set(Array.from(requested, (id) => id.toLowerCase()));
  return allowed.filter((r) => wanted.has(r.id.toLowerCase())).map((r) => r.id);
}

export type RoleFilter = "all" | "staff" | "learners";

export function parseRoleFilter(value: string | null | undefined): RoleFilter {
  return value === "staff" || value === "learners" ? value : "all";
}

/** Staff are instructors, teaching assistants and coordinators; everyone else is a learner or participant. */
export function matchesRoleFilter(role: RecipientRole, filter: RoleFilter): boolean {
  if (filter === "all") return true;
  const staff = role === "instructor" || role === "ta" || role === "coordinator";
  return filter === "staff" ? staff : !staff;
}
