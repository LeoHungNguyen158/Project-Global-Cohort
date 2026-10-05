import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/admin/csv";
import {
  IMPORT_TEMPLATE_CSV,
  guessMapping,
  isExampleAddress,
  isValidEmail,
  mergeIssues,
  normalizeName,
  normalizeRole,
  prepareImportRows,
  rowsForDatabaseCheck,
  summarize,
  type ImportDefaults,
} from "@/lib/admin/import";

const NO_DEFAULTS: ImportDefaults = { role: null, cohortCode: "", offeringCode: "" };

function prepare(text: string, defaults: ImportDefaults = NO_DEFAULTS) {
  const { records } = parseCsv(text);
  const mapping = guessMapping(records[0].cells);
  return prepareImportRows(records, mapping, defaults, { hasHeader: true }).rows;
}

describe("guessMapping", () => {
  it("maps common English and Vietnamese headers", () => {
    expect(guessMapping(["Email", "Display name", "Role", "Cohort code", "Offering code"])).toEqual({
      email: 0,
      display_name: 1,
      role: 2,
      cohort_code: 3,
      offering_code: 4,
    });
    expect(guessMapping(["Họ và tên", "Địa chỉ email"])).toEqual({ display_name: 0, email: 1 });
  });

  it("leaves unknown columns unmapped", () => {
    expect(guessMapping(["Notes", "Phone"])).toEqual({});
  });
});

describe("email and role rules", () => {
  it("accepts ordinary addresses and rejects malformed ones", () => {
    expect(isValidEmail("learner.one@sample.crewscaler.test")).toBe(true);
    expect(isValidEmail("a+tag@sub.example.org")).toBe(true);
    for (const bad of ["", "plain", "a@b", "a@@b.test", "a b@c.test", "a@-b.test", ".a@b.test", "a..b@c.test", "a@b.test,"]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  it("recognizes reserved example domains", () => {
    expect(isExampleAddress("x@example.org")).toBe(true);
    expect(isExampleAddress("x@mail.example.com")).toBe(true);
    expect(isExampleAddress("x@sample.crewscaler.test")).toBe(false);
  });

  it("normalizes role spellings", () => {
    expect(normalizeRole("Participant")).toBe("participant");
    expect(normalizeRole("learner")).toBe("participant");
    expect(normalizeRole("Teaching Assistant")).toBe("ta");
    expect(normalizeRole("TA")).toBe("ta");
    expect(normalizeRole("Giảng viên")).toBe("instructor");
    expect(normalizeRole("admin")).toBeNull();
  });

  it("composes decomposed Vietnamese names", () => {
    const decomposed = "Nguyễn  Thị Mai";
    expect(normalizeName(decomposed)).toBe("Nguyễn Thị Mai");
  });
});

describe("prepareImportRows", () => {
  it("flags invalid emails, duplicates in the file and invalid roles", () => {
    const rows = prepare(
      [
        "email,display_name,role,cohort_code,offering_code",
        "ok.one@sample.crewscaler.test,Võ Thanh Hà,participant,GC-FALL-2026,AAF-F26",
        "not-an-email,Bad Email,participant,GC-FALL-2026,",
        "OK.ONE@sample.crewscaler.test,Duplicate,participant,GC-FALL-2026,",
        "two@sample.crewscaler.test,Bad Role,admin,GC-FALL-2026,",
        ",No Email,participant,GC-FALL-2026,",
      ].join("\n"),
    );
    expect(rows.map((r) => [r.line, r.issues])).toEqual([
      [2, []],
      [3, ["invalid_email"]],
      [4, ["duplicate_email"]],
      [5, ["invalid_role"]],
      [6, ["missing_email"]],
    ]);
    expect(rows[2].duplicateOfLine).toBe(2);
    expect(rows[0].displayName).toBe("Võ Thanh Hà");
    expect(rows[2].email).toBe("ok.one@sample.crewscaler.test");
  });

  it("applies defaults for missing columns and empty cells", () => {
    const rows = prepare("email,name\na@sample.crewscaler.test,Ann\n", { role: "participant", cohortCode: "", offeringCode: "AAF-F26" });
    expect(rows[0]).toMatchObject({ role: "participant", offeringCode: "AAF-F26", cohortCode: "", issues: [] });
  });

  it("skips blank lines and keeps the original line numbers", () => {
    const rows = prepare("email,role\n\na@sample.crewscaler.test,participant\n\n");
    expect(rows).toHaveLength(1);
    expect(rows[0].line).toBe(3);
  });

  it("flags names over 120 characters and the template's example addresses", () => {
    const longName = "A".repeat(121);
    const rows = prepare(`email,name,role\nx@example.org,${longName},participant\n`);
    expect(rows[0].issues).toEqual(["example_address", "name_too_long"]);
  });

  it("parses the documented template and flags its placeholder addresses", () => {
    const rows = prepare(IMPORT_TEMPLATE_CSV);
    expect(rows).toHaveLength(3);
    expect(rows[1].displayName).toBe("Carter, Emily");
    expect(rows[2].role).toBe("ta");
    expect(rows.every((r) => r.issues.includes("example_address"))).toBe(true);
  });
});

describe("database merge and summary", () => {
  it("sends only locally valid rows for database checks and merges the findings", () => {
    const rows = prepare(
      "email,role,offering_code\na@sample.crewscaler.test,participant,AAF-F26\nbad,participant,AAF-F26\nb@sample.crewscaler.test,participant,NOPE\n",
    );
    expect(rowsForDatabaseCheck(rows)).toEqual([
      { row: 2, email: "a@sample.crewscaler.test", role: "participant", cohort_code: "", offering_code: "AAF-F26" },
      { row: 4, email: "b@sample.crewscaler.test", role: "participant", cohort_code: "", offering_code: "NOPE" },
    ]);
    const merged = mergeIssues(rows, new Map([[4, ["unknown_offering", "not_a_real_code"]], [2, []]]));
    expect(merged.map((r) => r.issues)).toEqual([[], ["invalid_email"], ["unknown_offering"]]);
    expect(summarize(merged)).toEqual({ total: 3, valid: 1, invalid: 2 });
  });
});
