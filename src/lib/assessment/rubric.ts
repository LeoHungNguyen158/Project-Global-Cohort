// Rubrics: criteria with optional performance levels. Stored on assignments.rubric as JSON:
//   [{ id, criterion, description?, points, levels?: [{ id, label, points, description? }] }]
// A grade's rubric_scores maps criterion id -> points awarded. With a rubric, the grade is the
// sum of the criterion scores, and the rubric total must equal the assignment's points.
import Decimal from "decimal.js";

export type RubricLevel = { id: string; label: string; points: number; description: string };
export type RubricCriterion = { id: string; criterion: string; description: string; points: number; levels: RubricLevel[] };

export const RUBRIC_MAX_CRITERIA = 20;
export const RUBRIC_MAX_LEVELS = 8;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

function toNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Tolerant reader for stored rubric JSON (older rows have no levels or descriptions). Invalid entries are dropped. */
export function parseRubric(value: unknown): RubricCriterion[] {
  if (!Array.isArray(value)) return [];
  const out: RubricCriterion[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const id = typeof c.id === "string" ? c.id : "";
    const points = toNumber(c.points);
    if (!ID.test(id) || points === null || points <= 0) continue;
    const levels: RubricLevel[] = [];
    if (Array.isArray(c.levels)) {
      for (const l of c.levels) {
        if (!l || typeof l !== "object") continue;
        const lv = l as Record<string, unknown>;
        const lp = toNumber(lv.points);
        if (typeof lv.id !== "string" || !ID.test(lv.id) || lp === null) continue;
        levels.push({ id: lv.id, label: String(lv.label ?? "").slice(0, 120), points: lp, description: String(lv.description ?? "").slice(0, 1000) });
      }
    }
    out.push({
      id,
      criterion: String(c.criterion ?? c.title ?? "").slice(0, 300),
      description: String(c.description ?? "").slice(0, 2000),
      points,
      levels,
    });
  }
  return out;
}

/** Sum of criterion points, decimal-safe. */
export function rubricTotal(rubric: RubricCriterion[]): number {
  return rubric.reduce((sum, c) => sum.plus(new Decimal(c.points)), new Decimal(0)).toDecimalPlaces(2).toNumber();
}

export type RubricProblem =
  | { code: "tooMany" }
  | { code: "criterionText"; index: number }
  | { code: "criterionPoints"; index: number }
  | { code: "levelLabel"; index: number; level: number }
  | { code: "levelPoints"; index: number; level: number }
  | { code: "tooManyLevels"; index: number }
  | { code: "duplicateId" }
  | { code: "totalMismatch"; total: number; points: number };

/** Validates an authored rubric against the assignment's points. An empty rubric is valid (points-only grading). */
export function validateRubric(rubric: RubricCriterion[], assignmentPoints: number): RubricProblem | null {
  if (rubric.length === 0) return null;
  if (rubric.length > RUBRIC_MAX_CRITERIA) return { code: "tooMany" };
  const ids = new Set<string>();
  for (const [i, c] of rubric.entries()) {
    if (ids.has(c.id)) return { code: "duplicateId" };
    ids.add(c.id);
    if (!c.criterion.trim()) return { code: "criterionText", index: i };
    if (!(c.points > 0) || c.points > 10000) return { code: "criterionPoints", index: i };
    if (c.levels.length > RUBRIC_MAX_LEVELS) return { code: "tooManyLevels", index: i };
    const levelIds = new Set<string>();
    for (const [j, l] of c.levels.entries()) {
      if (levelIds.has(l.id)) return { code: "duplicateId" };
      levelIds.add(l.id);
      if (!l.label.trim()) return { code: "levelLabel", index: i, level: j };
      if (!(l.points >= 0) || l.points > c.points) return { code: "levelPoints", index: i, level: j };
    }
  }
  const total = rubricTotal(rubric);
  if (!new Decimal(total).eq(new Decimal(assignmentPoints))) return { code: "totalMismatch", total, points: assignmentPoints };
  return null;
}

export type RubricScoreResult =
  | { ok: true; total: number; scores: Record<string, number> }
  | { ok: false; missing: string[]; invalid: string[] };

/**
 * Totals criterion scores. Every criterion must be scored, each between 0 and its points.
 * Scores are rounded to 2 decimals like the database columns.
 */
export function scoreRubric(rubric: RubricCriterion[], input: Record<string, number | null | undefined>): RubricScoreResult {
  const missing: string[] = [];
  const invalid: string[] = [];
  const scores: Record<string, number> = {};
  let total = new Decimal(0);
  for (const c of rubric) {
    const v = input[c.id];
    if (v === null || v === undefined || Number.isNaN(v)) {
      missing.push(c.id);
      continue;
    }
    const d = new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (d.lt(0) || d.gt(c.points)) {
      invalid.push(c.id);
      continue;
    }
    scores[c.id] = d.toNumber();
    total = total.plus(d);
  }
  if (missing.length || invalid.length) return { ok: false, missing, invalid };
  return { ok: true, total: total.toDecimalPlaces(2).toNumber(), scores };
}

/** The level whose points match a score, if any (levels are optional). */
export function levelForScore(criterion: RubricCriterion, score: number | null | undefined): RubricLevel | null {
  if (score === null || score === undefined) return null;
  return criterion.levels.find((l) => new Decimal(l.points).eq(new Decimal(score))) ?? null;
}

/** Reads stored rubric_scores JSON into numbers keyed by criterion id. */
export function parseRubricScores(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = toNumber(v);
    if (n !== null) out[k] = n;
  }
  return out;
}

/** Short random id for criteria, levels and choices (letters and digits, URL-safe). */
export function shortId(prefix: string, length = 8): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let s = prefix;
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}
