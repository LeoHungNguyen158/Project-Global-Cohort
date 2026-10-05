import { describe, expect, it } from "vitest";
import { cleanText, foldForSearch, matchesSearch, normalizeSupportEmail, normalizeSupportUrl, splitTemplate } from "@/components/public/text";
import { fileTypeLabelKey, sortByFileType } from "@/components/public/file-types";

describe("accent- and case-insensitive search", () => {
  it("folds Vietnamese diacritics, including đ/Đ", () => {
    expect(foldForSearch("  Nguyễn   Thị Hồng  ")).toBe("nguyen thi hong");
    expect(foldForSearch("Đặng Quốc Huy")).toBe("dang quoc huy");
    expect(foldForSearch("Hà Nội")).toBe(foldForSearch("ha noi"));
    expect(foldForSearch(null)).toBe("");
  });

  it("requires every term to appear in some field", () => {
    expect(matchesSearch("nguyen nhung", ["Nguyễn Thị Hồng Nhung"])).toBe(true);
    expect(matchesSearch("ho chi minh", ["Asia/Ho Chi Minh", "Sài Gòn"])).toBe(true);
    expect(matchesSearch("sai gon", ["Asia/Ho Chi Minh", "Sài Gòn"])).toBe(true);
    expect(matchesSearch("nguyen tran", ["Nguyễn Thị Hồng Nhung"])).toBe(false);
    expect(matchesSearch("   ", ["anything"])).toBe(true);
    expect(matchesSearch("x", [null, undefined])).toBe(false);
  });
});

describe("sentence templates with slots", () => {
  it("splits text and named slots in order", () => {
    expect(splitTemplate("Use {link} to reset {what}.")).toEqual([
      { kind: "text", value: "Use " },
      { kind: "slot", name: "link" },
      { kind: "text", value: " to reset " },
      { kind: "slot", name: "what" },
      { kind: "text", value: "." },
    ]);
    expect(splitTemplate("{a}")).toEqual([{ kind: "slot", name: "a" }]);
    expect(splitTemplate("No slots { here }")).toEqual([{ kind: "text", value: "No slots { here }" }]);
  });
});

describe("support contact settings", () => {
  it("accepts plausible emails only", () => {
    expect(normalizeSupportEmail(" help@example.org ")).toBe("help@example.org");
    expect(normalizeSupportEmail("not-an-email")).toBeNull();
    expect(normalizeSupportEmail("a@b")).toBeNull();
    expect(normalizeSupportEmail("")).toBeNull();
    expect(normalizeSupportEmail(42)).toBeNull();
  });

  it("accepts https pages without credentials only", () => {
    expect(normalizeSupportUrl("https://example.org/help")).toBe("https://example.org/help");
    expect(normalizeSupportUrl("http://example.org/help")).toBeNull();
    expect(normalizeSupportUrl("https://user:pw@example.org/")).toBeNull();
    expect(normalizeSupportUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeSupportUrl(`https://example.org/${"a".repeat(2000)}`)).toBeNull();
    expect(normalizeSupportUrl(null)).toBeNull();
  });
});

describe("cleanText", () => {
  it("normalizes to NFC and removes control characters", () => {
    const decomposed = "Nguyễn";
    expect(cleanText(decomposed)).toBe("Nguyễn");
    expect(cleanText(decomposed).length).toBe("Nguyễn".length);
    expect(cleanText("a\u0000b\u0007c")).toBe("a b c");
  });

  it("keeps line breaks only in multiline text", () => {
    expect(cleanText("one\r\ntwo\rthree", { multiline: true })).toBe("one\ntwo\nthree");
    expect(cleanText("one\ntwo")).toBe("one two");
    expect(cleanText("  tab\there  ", { multiline: true })).toBe("tab\there");
  });
});

describe("upload type names", () => {
  it("names known types and orders documents before images and text", () => {
    expect(fileTypeLabelKey("application/pdf")).toBe("help.fileType.pdf");
    expect(fileTypeLabelKey("application/x-msdownload")).toBeNull();
    const sorted = sortByFileType([{ mime: "text/csv" }, { mime: "zzz/unknown" }, { mime: "image/png" }, { mime: "application/pdf" }]);
    expect(sorted.map((r) => r.mime)).toEqual(["application/pdf", "image/png", "text/csv", "zzz/unknown"]);
  });
});
