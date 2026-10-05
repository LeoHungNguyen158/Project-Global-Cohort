// Enrollment import: column mapping and row validation that needs no database.
// The server re-runs all of this (plus database checks) on every preview and again
// on confirmation, so nothing computed in the browser is trusted.
import { isBlankRecord, normalizeHeader, type CsvRecord } from "./csv";

export const IMPORT_FIELDS = ["email", "display_name", "role", "cohort_code", "offering_code"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Column index for each field; -1 or missing means "not in the file". */
export type ColumnMapping = Partial<Record<ImportField, number>>;

export type InviteRole = "participant" | "instructor" | "ta";
export const INVITE_ROLES: InviteRole[] = ["participant", "instructor", "ta"];

/** Values used for rows whose file has no such column (or an empty cell). */
export type ImportDefaults = { role: InviteRole | null; cohortCode: string; offeringCode: string };

export const MAX_IMPORT_ROWS = 200;
// Characters, not bytes; keeps the request well under the server action body limit.
export const MAX_IMPORT_CHARS = 300_000;
export const MAX_NAME_LENGTH = 120;

/** Problems found without the database. Database checks add more codes. */
export type LocalIssue =
  | "missing_email"
  | "invalid_email"
  | "example_address"
  | "duplicate_email"
  | "invalid_role"
  | "name_too_long"
  | "code_too_long";

export const DB_ISSUES = [
  "unknown_cohort",
  "unknown_offering",
  "offering_not_in_cohort",
  "offering_archived",
  "cohort_archived",
  "missing_scope",
  "staff_needs_offering",
  "account_suspended",
  "already_enrolled",
  "already_participant",
  "already_staff",
  "already_invited",
] as const;
export type DbIssue = (typeof DB_ISSUES)[number];
export type ImportIssue = LocalIssue | DbIssue;

export type PreparedRow = {
  /** CSV line where the record starts (what a spreadsheet user can find). */
  line: number;
  email: string;
  displayName: string;
  role: InviteRole | null;
  rawRole: string;
  cohortCode: string;
  offeringCode: string;
  issues: ImportIssue[];
  /** For duplicates: the line of the first occurrence. */
  duplicateOfLine?: number;
};

const HEADER_ALIASES: Record<ImportField, string[]> = {
  email: ["email", "e mail", "email address", "e mail address", "mail", "dia chi email", "thu dien tu"],
  display_name: ["display name", "name", "full name", "participant name", "learner name", "ho va ten", "ho ten", "ten"],
  role: ["role", "invite role", "vai tro"],
  cohort_code: ["cohort", "cohort code", "cohort id", "ma cohort", "khoa"],
  offering_code: ["offering", "offering code", "course offering", "course offering code", "course code", "class code", "ma lop"],
};

/** Suggests which column holds each field, from the header row. */
export function guessMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    const idx = normalized.findIndex((h, i) => !used.has(i) && HEADER_ALIASES[field].includes(h));
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  }
  return mapping;
}

// Practical address check: one @, no spaces, a dot in the domain, sane lengths.
const EMAIL = /^[^\s@"<>(),;:\\[\]]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function isValidEmail(value: string): boolean {
  if (value.length < 3 || value.length > 320) return false;
  if (!EMAIL.test(value)) return false;
  const [local, domain] = value.split("@");
  return local.length <= 64 && domain.length <= 255 && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..");
}

/** Reserved documentation domains (RFC 2606); the import template uses them as placeholders. */
export function isExampleAddress(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return ["example.com", "example.org", "example.net"].some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Accepts the stored role names and common spellings. */
export function normalizeRole(value: string): InviteRole | null {
  const v = normalizeHeader(value);
  if (["participant", "learner", "student", "hoc vien"].includes(v)) return "participant";
  if (["instructor", "teacher", "giang vien"].includes(v)) return "instructor";
  if (["ta", "teaching assistant", "assistant", "tro giang"].includes(v)) return "ta";
  return null;
}

/** Display names keep their letters (Vietnamese included) in composed form. */
export function normalizeName(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function cell(record: CsvRecord, index: number | undefined): string {
  if (index === undefined || index < 0) return "";
  return record.cells[index] ?? "";
}

/**
 * Turns parsed records into import rows with local validation. The first record is
 * the header when `hasHeader` is set. Blank records are skipped.
 */
export function prepareImportRows(
  records: CsvRecord[],
  mapping: ColumnMapping,
  defaults: ImportDefaults,
  options: { hasHeader: boolean },
): { rows: PreparedRow[]; dataRowCount: number } {
  const data = (options.hasHeader ? records.slice(1) : records).filter((r) => !isBlankRecord(r));
  const firstLineByEmail = new Map<string, number>();
  const rows: PreparedRow[] = data.map((record) => {
    const issues: ImportIssue[] = [];
    const email = normalizeEmail(cell(record, mapping.email));
    const displayName = normalizeName(cell(record, mapping.display_name));
    const rawRole = cell(record, mapping.role).trim();
    const role = rawRole ? normalizeRole(rawRole) : defaults.role;
    const cohortCode = cell(record, mapping.cohort_code).trim() || defaults.cohortCode.trim();
    const offeringCode = cell(record, mapping.offering_code).trim() || defaults.offeringCode.trim();

    let duplicateOfLine: number | undefined;
    if (!email) issues.push("missing_email");
    else if (!isValidEmail(email)) issues.push("invalid_email");
    else {
      if (isExampleAddress(email)) issues.push("example_address");
      const first = firstLineByEmail.get(email);
      if (first !== undefined) {
        issues.push("duplicate_email");
        duplicateOfLine = first;
      } else firstLineByEmail.set(email, record.line);
    }
    if (!role) issues.push("invalid_role");
    if (displayName.length > MAX_NAME_LENGTH) issues.push("name_too_long");
    if (cohortCode.length > 64 || offeringCode.length > 64) issues.push("code_too_long");
    return { line: record.line, email, displayName, role, rawRole, cohortCode, offeringCode, issues, duplicateOfLine };
  });
  return { rows, dataRowCount: data.length };
}

/** Merges database findings (by line) into prepared rows, without duplicates. */
export function mergeIssues(rows: PreparedRow[], dbIssues: Map<number, string[]>): PreparedRow[] {
  return rows.map((row) => {
    const extra = (dbIssues.get(row.line) ?? []).filter((c): c is DbIssue => (DB_ISSUES as readonly string[]).includes(c));
    const issues = Array.from(new Set<ImportIssue>([...row.issues, ...extra]));
    return { ...row, issues };
  });
}

/** Rows the database still needs to check (locally valid, with a usable role). */
export function rowsForDatabaseCheck(rows: PreparedRow[]) {
  return rows
    .filter((r) => r.issues.length === 0 && r.role)
    .map((r) => ({ row: r.line, email: r.email, role: r.role, cohort_code: r.cohortCode, offering_code: r.offeringCode }));
}

export type ImportSummary = { total: number; valid: number; invalid: number };

export function summarize(rows: PreparedRow[]): ImportSummary {
  const invalid = rows.filter((r) => r.issues.length > 0).length;
  return { total: rows.length, valid: rows.length - invalid, invalid };
}

/** Documented template (UTF-8 with header). Example addresses must be replaced before importing. */
export const IMPORT_TEMPLATE_CSV =
  "email,display_name,role,cohort_code,offering_code\r\n" +
  "learner.one@example.org,Nguyễn Thị Mai,participant,GC-FALL-2026,AAF-F26\r\n" +
  "learner.two@example.org,\"Carter, Emily\",participant,GC-FALL-2026,\r\n" +
  "assistant@example.org,Trần Văn Bình,ta,,AAF-F26\r\n";
