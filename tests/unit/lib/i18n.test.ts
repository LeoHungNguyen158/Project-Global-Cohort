import { describe, expect, it } from "vitest";
import { dictionaries, en } from "@/i18n/en";
import { t } from "@/i18n";

// Each dictionary file owns these key namespaces (see src/i18n/en.ts).
const OWNED: Record<keyof typeof dictionaries, string[]> = {
  core: ["app", "nav", "common", "auth", "activity", "courses", "course"],
  learning: ["learn", "author", "people"],
  assessment: ["quiz", "assign"],
  grades: ["grades", "gradebook", "cal"],
  comms: ["msg", "ann", "disc", "cohort", "community"],
  admin: ["admin"],
  account: ["catalog", "tools", "profile", "invite", "help", "legal"],
};

describe("interface dictionaries", () => {
  it("keeps every key inside its file's namespaces", () => {
    const misplaced: string[] = [];
    for (const [file, dict] of Object.entries(dictionaries) as [keyof typeof dictionaries, Record<string, string>][]) {
      for (const key of Object.keys(dict)) {
        const ns = key.split(".")[0];
        if (!OWNED[file].includes(ns)) misplaced.push(`${file}: ${key}`);
      }
    }
    expect(misplaced).toEqual([]);
  });

  it("never defines the same key in two files", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [file, dict] of Object.entries(dictionaries)) {
      for (const key of Object.keys(dict)) {
        if (seen.has(key)) duplicates.push(`${key} (${seen.get(key)} and ${file})`);
        seen.set(key, file);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it("has no empty, untrimmed or malformed strings", () => {
    const bad: string[] = [];
    for (const [key, value] of Object.entries(en as Record<string, string>)) {
      // Later segments may mirror database values such as "access_request".
      if (!/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(key)) bad.push(`key format: ${key}`);
      if (typeof value !== "string" || value.trim() === "") bad.push(`empty: ${key}`);
      else if (value !== value.trim()) bad.push(`whitespace: ${key}`);
      // Placeholders look like {name}; braces must balance.
      const stripped = value.replace(/\{[A-Za-z][A-Za-z0-9]*\}/g, "");
      if (/[{}]/.test(stripped)) bad.push(`placeholder: ${key}`);
    }
    expect(bad).toEqual([]);
  });

  it("never names an account relationship or tier 'Membership'", () => {
    const offending = Object.entries(en as Record<string, string>).filter(([, v]) => /\bmembership\b/i.test(v)).map(([k]) => k);
    expect(offending).toEqual([]);
  });
});

describe("t()", () => {
  it("fills placeholders and leaves unknown ones visible", () => {
    expect(t("common.results", { count: 3 })).toBe(en["common.results"].replaceAll("{count}", "3"));
    expect(t("common.results")).toBe(en["common.results"]);
  });
});
