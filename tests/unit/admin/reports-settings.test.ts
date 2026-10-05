import { describe, expect, it } from "vitest";
import { completionCsv, completionFilename, progressPercent, summarizeCompletion, type CompletionRow } from "@/lib/admin/reports";
import { isUploadPurpose, mimeLabelKey, typeAllowedFor, validateSettings, VERIFIABLE_TYPES } from "@/lib/admin/settings";

const row = (over: Partial<CompletionRow>): CompletionRow => ({
  user_id: "00000000-0000-4000-8000-000000000001",
  display_name: "Learner",
  enrollment_status: "active",
  required_total: 4,
  required_completed: 0,
  completed_at: null,
  ...over,
});

describe("progressPercent", () => {
  it("rounds down to whole percent and clamps", () => {
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(2, 3)).toBe(66);
    expect(progressPercent(3, 3)).toBe(100);
    expect(progressPercent(5, 3)).toBe(100);
    expect(progressPercent(-1, 3)).toBe(0);
  });

  it("has no value when the course has no required lessons", () => {
    expect(progressPercent(0, 0)).toBeNull();
  });
});

describe("summarizeCompletion", () => {
  it("counts enrollments, active ones, finishers and averages active and completed progress", () => {
    const summary = summarizeCompletion([
      row({ required_completed: 4, enrollment_status: "completed", completed_at: "2026-10-01T10:00:00Z" }),
      row({ required_completed: 2 }),
      row({ required_completed: 0, enrollment_status: "withdrawn" }),
    ]);
    expect(summary).toEqual({ enrollments: 3, active: 1, finished: 1, averagePercent: 75 });
  });

  it("reports no average when nobody counts", () => {
    expect(summarizeCompletion([]).averagePercent).toBeNull();
    expect(summarizeCompletion([row({ required_total: 0 })]).averagePercent).toBeNull();
  });
});

describe("completionCsv", () => {
  it("writes a header, names without emails, UTC times and CRLF line endings", () => {
    const csv = completionCsv([
      row({ display_name: "Nguyễn Văn An", required_completed: 4, completed_at: "2026-10-01T10:00:00+02:00" }),
      row({ display_name: "Carter, Emily", required_completed: 1 }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Learner,Enrollment status,Required lessons completed,Required lessons,Progress (%),Finished all required lessons (UTC)");
    expect(lines[1]).toBe("Nguyễn Văn An,active,4,4,100,2026-10-01T08:00:00.000Z");
    expect(lines[2]).toBe('"Carter, Emily",active,1,4,25,');
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).not.toContain("@");
  });

  it("neutralizes names that a spreadsheet would run as formulas", () => {
    const csv = completionCsv([row({ display_name: "=HYPERLINK(\"http://x\")" }), row({ display_name: "+1 test" }), row({ display_name: "@SUM(A1)" })]);
    const lines = csv.trim().split("\r\n");
    expect(lines[1].startsWith(`"'=HYPERLINK(`)).toBe(true);
    expect(lines[2].startsWith("'+1 test")).toBe(true);
    expect(lines[3].startsWith("'@SUM(A1)")).toBe(true);
  });
});

describe("completionFilename", () => {
  it("keeps only safe characters", () => {
    expect(completionFilename("AAF-F26", new Date("2026-10-05T12:00:00Z"))).toBe("completion-AAF-F26-2026-10-05.csv");
    expect(completionFilename('a"b/c', new Date("2026-10-05T12:00:00Z"))).toBe("completion-a_b_c-2026-10-05.csv");
  });
});

describe("validateSettings", () => {
  it("accepts empty optional fields and valid values", () => {
    expect(validateSettings({ programName: "", supportEmail: "", supportUrl: "" })).toEqual({});
    expect(validateSettings({ programName: "Global Cohort", supportEmail: "help@example.org", supportUrl: "https://example.org/help" })).toEqual({});
  });

  it("rejects long names, bad emails and non-https or credentialed links", () => {
    expect(validateSettings({ programName: "x".repeat(121), supportEmail: "", supportUrl: "" })).toEqual({ program_name: "programName" });
    expect(validateSettings({ programName: "", supportEmail: "not an email", supportUrl: "" })).toEqual({ support_email: "supportEmail" });
    expect(validateSettings({ programName: "", supportEmail: "", supportUrl: "http://example.org" })).toEqual({ support_url: "supportUrl" });
    expect(validateSettings({ programName: "", supportEmail: "", supportUrl: "javascript:alert(1)" })).toEqual({ support_url: "supportUrl" });
    expect(validateSettings({ programName: "", supportEmail: "", supportUrl: "https://user:pw@example.org" })).toEqual({ support_url: "supportUrl" });
  });
});

describe("upload types", () => {
  it("allows only verifiable types, and still images for profile photos", () => {
    expect(typeAllowedFor("lesson", "video/mp4")).toBe(true);
    expect(typeAllowedFor("lesson", "text/html")).toBe(false);
    expect(typeAllowedFor("avatar", "image/png")).toBe(true);
    expect(typeAllowedFor("avatar", "image/gif")).toBe(false);
    expect(typeAllowedFor("avatar", "application/pdf")).toBe(false);
  });

  it("knows the purposes and labels every verifiable type", () => {
    expect(isUploadPurpose("submission")).toBe(true);
    expect(isUploadPurpose("resource")).toBe(false);
    for (const v of VERIFIABLE_TYPES) expect(mimeLabelKey(v.mime)).toMatch(/^admin\.settings\.type\./);
    expect(mimeLabelKey("text/html")).toBeNull();
  });
});
