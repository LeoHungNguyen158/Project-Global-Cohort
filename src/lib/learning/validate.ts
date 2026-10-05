import type { CompletionRule, LessonContentType } from "./outline";

// Input rules for the authoring forms. Server actions call these before writing, and
// the database constraints re-check the same limits.

export const LESSON_CONTENT_TYPES: LessonContentType[] = ["text", "pdf", "video", "file", "link", "embed"];
export const COMPLETION_RULES: CompletionRule[] = ["acknowledge", "video_watched"];

export const LIMITS = {
  title: 300,
  moduleDescription: 2000,
  summary: 2000,
  objective: 300,
  objectives: 20,
  shortText: 500,
  longText: 5000,
  transcript: 100_000,
  body: 50_000,
  durationMax: 10_000,
  reason: 1000,
  assetTitle: 300,
  assetDescription: 2000,
  assetAlt: 1000,
} as const;

export function isLessonContentType(v: string): v is LessonContentType {
  return (LESSON_CONTENT_TYPES as string[]).includes(v);
}

export function isCompletionRule(v: string): v is CompletionRule {
  return (COMPLETION_RULES as string[]).includes(v);
}

/** One objective per line; blank lines and list markers are dropped. */
export function parseObjectives(text: string): { ok: true; value: string[] } | { ok: false; reason: "too_many" | "too_long" } {
  const items = (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  if (items.length > LIMITS.objectives) return { ok: false, reason: "too_many" };
  if (items.some((i) => i.length > LIMITS.objective)) return { ok: false, reason: "too_long" };
  return { ok: true, value: items };
}

/** Whole minutes between 0 and 10000, or null when left empty. "invalid" otherwise. */
export function parseDurationMinutes(raw: string): number | null | "invalid" {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (!/^\d+$/.test(v)) return "invalid";
  const n = Number(v);
  return n <= LIMITS.durationMax ? n : "invalid";
}

/** A minimum quiz score between 0 and 100 with at most two decimals. */
export function parseScorePercent(raw: string): number | "invalid" {
  const v = (raw ?? "").trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(v)) return "invalid";
  const n = Number(v);
  return n >= 0 && n <= 100 ? n : "invalid";
}
