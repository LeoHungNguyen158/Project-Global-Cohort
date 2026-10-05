import { t } from "@/i18n";
import { formatDateTime, formatWithCourseTime } from "@/lib/time";

// Pure helpers for lesson prerequisites and release rules. The database is
// authoritative (private.lesson_lock_reasons decides access, and a trigger rejects
// cycles); these mirror its rules to explain them in the interface and to warn
// authors before they submit.

export type LessonRule = { target: string; required: string };

/** True if adding target -> required would create a dependency cycle. */
export function wouldCreateCycle(rules: LessonRule[], candidate: LessonRule): boolean {
  if (candidate.target === candidate.required) return true;
  const deps = new Map<string, string[]>();
  for (const r of rules) deps.set(r.target, [...(deps.get(r.target) ?? []), r.required]);
  const seen = new Set<string>();
  const stack = [candidate.required];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === candidate.target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(deps.get(cur) ?? []));
  }
  return false;
}

export type LockReason =
  | { kind: "offering_start"; starts_at: string }
  | { kind: "release_at"; release_at: string }
  | { kind: "lesson_complete"; lesson_id: string | null; lesson_title: string }
  | { kind: "quiz_min_score"; quiz_id: string; quiz_title: string; quiz_open: boolean; min_score_pct: number; current_pct: number | null };

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Reads the JSON array returned by the database; unknown entries are kept as a generic lock. */
export function parseLockReasons(value: unknown): LockReason[] {
  if (!Array.isArray(value)) return [];
  const out: LockReason[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    switch (r.kind) {
      case "offering_start":
        if (typeof r.starts_at === "string") out.push({ kind: "offering_start", starts_at: r.starts_at });
        break;
      case "release_at":
        if (typeof r.release_at === "string") out.push({ kind: "release_at", release_at: r.release_at });
        break;
      case "lesson_complete":
        out.push({
          kind: "lesson_complete",
          lesson_id: typeof r.lesson_id === "string" ? r.lesson_id : null,
          lesson_title: typeof r.lesson_title === "string" ? r.lesson_title : "",
        });
        break;
      case "quiz_min_score":
        out.push({
          kind: "quiz_min_score",
          quiz_id: typeof r.quiz_id === "string" ? r.quiz_id : "",
          quiz_title: typeof r.quiz_title === "string" ? r.quiz_title : "",
          // The database leaves out the id and title of a quiz learners cannot open yet.
          quiz_open: r.quiz_open !== false && typeof r.quiz_id === "string",
          min_score_pct: asNumber(r.min_score_pct) ?? 0,
          current_pct: asNumber(r.current_pct),
        });
        break;
      default:
        // A condition this interface does not know yet: still locked, described generically.
        out.push({ kind: "release_at", release_at: "" });
    }
  }
  return out;
}

export type LockReasonView = {
  /** Precise unmet condition, e.g. "Complete “Lecture 1” first." */
  text: string;
  /** Where the learner can resolve it, when there is such a place. */
  href?: string;
  /** Label for that link. */
  action?: string;
};

function pct(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/**
 * Explains one unmet condition and links to where it can be resolved. Times are shown in
 * the viewer's zone, with the course time zone as a reference when it differs.
 */
export function describeLockReason(reason: LockReason, ctx: { offeringId: string; tz: string; courseTz?: string }): LockReasonView {
  const when = (iso: string) => (ctx.courseTz ? formatWithCourseTime(iso, ctx.tz, ctx.courseTz) : formatDateTime(iso, ctx.tz));
  switch (reason.kind) {
    case "offering_start":
      return { text: t("learn.lock.courseStart", { date: when(reason.starts_at) }) };
    case "release_at":
      if (!reason.release_at) return { text: t("learn.lock.unknown") };
      return { text: t("learn.lock.releaseAt", { date: when(reason.release_at) }) };
    case "lesson_complete": {
      const title = reason.lesson_title || t("learn.lock.previousLesson");
      if (!reason.lesson_id) return { text: t("learn.lock.lessonMissing", { title }) };
      return {
        text: t("learn.lock.completeLesson", { title }),
        href: `/courses/${ctx.offeringId}/content/${reason.lesson_id}`,
        action: t("learn.lock.goToLesson", { title }),
      };
    }
    case "quiz_min_score": {
      if (!reason.quiz_open) return { text: t("learn.lock.quizNotOpen", { min: pct(reason.min_score_pct) }) };
      const score =
        reason.current_pct === null ? t("learn.lock.noReleasedScore") : t("learn.lock.yourScore", { score: pct(reason.current_pct) });
      return {
        text: t("learn.lock.quizScore", { min: pct(reason.min_score_pct), quiz: reason.quiz_title || t("learn.lock.aQuiz"), score }),
        href: reason.quiz_id ? `/courses/${ctx.offeringId}/quizzes/${reason.quiz_id}` : undefined,
        action: reason.quiz_id ? t("learn.lock.openQuiz", { quiz: reason.quiz_title || t("learn.lock.aQuiz") }) : undefined,
      };
    }
  }
}

/** True when every unmet condition is only the offering's start date. */
export function onlyWaitingForStart(reasons: LockReason[]): boolean {
  return reasons.length > 0 && reasons.every((r) => r.kind === "offering_start");
}

export type RuleRow = {
  id: string;
  target_lesson_lineage: string;
  kind: "lesson_complete" | "quiz_min_score" | "release_at";
  required_lesson_lineage: string | null;
  quiz_id: string | null;
  min_score_pct: number | string | null;
  release_at: string | null;
};

/** Lesson-completion edges of an offering's rules, for cycle checks. */
export function completionEdges(rules: RuleRow[]): LessonRule[] {
  return rules
    .filter((r) => r.kind === "lesson_complete" && r.required_lesson_lineage)
    .map((r) => ({ target: r.target_lesson_lineage, required: r.required_lesson_lineage as string }));
}

/** Staff-facing summary of a configured rule (not evaluated for any learner). */
export function describeRule(
  rule: RuleRow,
  ctx: { tz: string; courseTz?: string; lessonTitle: (lineage: string) => string | null; quizTitle: (id: string) => string | null },
): string {
  switch (rule.kind) {
    case "lesson_complete": {
      const title = rule.required_lesson_lineage ? ctx.lessonTitle(rule.required_lesson_lineage) : null;
      return title ? t("learn.rule.requiresLesson", { title }) : t("learn.rule.requiresMissingLesson");
    }
    case "quiz_min_score": {
      const quiz = (rule.quiz_id && ctx.quizTitle(rule.quiz_id)) || t("learn.lock.aQuiz");
      return t("learn.rule.requiresQuiz", { min: pct(asNumber(rule.min_score_pct) ?? 0), quiz });
    }
    case "release_at":
      return t("learn.rule.releasesAt", {
        date: rule.release_at ? (ctx.courseTz ? formatWithCourseTime(rule.release_at, ctx.tz, ctx.courseTz) : formatDateTime(rule.release_at, ctx.tz)) : "",
      });
  }
}
