import { describe, expect, it } from "vitest";
import { detectDelimiter, isBlankRecord, normalizeHeader, parseCsv } from "@/lib/admin/csv";

const cells = (text: string) => parseCsv(text).records.map((r) => r.cells);

describe("parseCsv", () => {
  it("reads simple comma-separated records", () => {
    expect(cells("email,name\na@x.test,Ann\nb@x.test,Bob\n")).toEqual([
      ["email", "name"],
      ["a@x.test", "Ann"],
      ["b@x.test", "Bob"],
    ]);
  });

  it("handles quoted fields with embedded commas and doubled quotes", () => {
    expect(cells('name,note\n"Carter, Emily","She said ""hi"""\n')).toEqual([
      ["name", "note"],
      ["Carter, Emily", 'She said "hi"'],
    ]);
  });

  it("keeps line breaks inside quotes and reports the starting line of each record", () => {
    const result = parseCsv('email,note\r\na@x.test,"line one\r\nline two"\r\nb@x.test,plain\r\n');
    expect(result.records.map((r) => r.cells)).toEqual([
      ["email", "note"],
      ["a@x.test", "line one\nline two"],
      ["b@x.test", "plain"],
    ]);
    expect(result.records.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it("accepts CRLF, LF and bare CR line endings", () => {
    expect(cells("a,b\r\n1,2\n3,4\r5,6")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
    ]);
  });

  it("strips a UTF-8 byte order mark", () => {
    const result = parseCsv("﻿email,name\na@x.test,An\n");
    expect(result.records[0].cells[0]).toBe("email");
  });

  it("keeps Vietnamese names intact", () => {
    const result = parseCsv("email,display_name\nmai@x.test,Nguyễn Thị Mai\nhuy@x.test,\"Đặng, Quốc Huy\"\n");
    expect(result.records[1].cells[1]).toBe("Nguyễn Thị Mai");
    expect(result.records[2].cells[1]).toBe("Đặng, Quốc Huy");
  });

  it("keeps empty fields and trailing empty fields", () => {
    expect(cells("a,,c,\n")).toEqual([["a", "", "c", ""]]);
    expect(cells('"",x\n')).toEqual([["", "x"]]);
  });

  it("does not add a record for a final newline but keeps blank lines as blank records", () => {
    const result = parseCsv("a\n\nb\n");
    expect(result.records.map((r) => r.cells)).toEqual([["a"], [""], ["b"]]);
    expect(isBlankRecord(result.records[1])).toBe(true);
    expect(result.records[2].line).toBe(3);
  });

  it("reports an unterminated quote with the line where the record started", () => {
    const result = parseCsv('email,name\na@x.test,"Ann\nb@x.test,Bob\n');
    expect(result.error).toEqual({ kind: "unterminated_quote", line: 2 });
  });

  it("keeps a stray quote inside an unquoted field", () => {
    expect(cells('a,O"Brien\n')).toEqual([["a", 'O"Brien']]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(detectDelimiter("email;name\na;b")).toBe(";");
    expect(detectDelimiter("email\tname\n")).toBe("\t");
    expect(detectDelimiter('"a;b",c,d\n')).toBe(",");
    expect(cells("email;name\na@x.test;\"X; Y\"\n")).toEqual([
      ["email", "name"],
      ["a@x.test", "X; Y"],
    ]);
  });

  it("stops at maxRecords and says so", () => {
    const result = parseCsv("a\nb\nc\n", { maxRecords: 2 });
    expect(result.records.map((r) => r.cells[0])).toEqual(["a", "b"]);
    expect(result.truncated).toBe(true);
  });
});

describe("normalizeHeader", () => {
  it("folds case, accents, separators and spacing", () => {
    expect(normalizeHeader("  Display_Name ")).toBe("display name");
    expect(normalizeHeader("Họ và Tên")).toBe("ho va ten");
    expect(normalizeHeader("E-Mail")).toBe("e mail");
    expect(normalizeHeader("Địa chỉ email")).toBe("dia chi email");
  });
});
