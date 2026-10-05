import { parseLockReasons, type LockReason } from "@/lib/domain/prerequisites";

// Course outline as returned by the offering_outline / learner_outline RPCs, plus pure
// helpers for navigation, status and the learner's next action. Lock reasons and
// progress come from the database; nothing here grants access.

export type LessonContentType = "text" | "pdf" | "video" | "file" | "link" | "embed";
export type CompletionRule = "acknowledge" | "video_watched";

export type OutlineLesson = {
  id: string;
  lineage_id: string;
  title: string;
  content_type: LessonContentType;
  required: boolean;
  duration_minutes: number | null;
  completion_rule: CompletionRule;
  position: number;
  lock_reasons: LockReason[];
  completed_at: string | null;
  /** null when the learner has no progress record for this lesson yet. */
  last_position_seconds: number | null;
};

export type OutlineModule = {
  id: string;
  lineage_id: string;
  title: string;
  description: string;
  position: number;
  lessons: OutlineLesson[];
};

export type Outline = { courseVersionId: string | null; isStaff: boolean; modules: OutlineModule[] };

const CONTENT_TYPES: LessonContentType[] = ["text", "pdf", "video", "file", "link", "embed"];

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseLesson(raw: Record<string, unknown>): OutlineLesson {
  const type = str(raw.content_type) as LessonContentType;
  return {
    id: str(raw.id),
    lineage_id: str(raw.lineage_id),
    title: str(raw.title),
    content_type: CONTENT_TYPES.includes(type) ? type : "text",
    required: raw.required !== false,
    duration_minutes: numOrNull(raw.duration_minutes),
    completion_rule: raw.completion_rule === "video_watched" ? "video_watched" : "acknowledge",
    position: numOrNull(raw.position) ?? 0,
    lock_reasons: parseLockReasons(raw.lock_reasons),
    completed_at: typeof raw.completed_at === "string" ? raw.completed_at : null,
    last_position_seconds: numOrNull(raw.last_position_seconds),
  };
}

/** Parses the RPC JSON defensively (unknown shapes become an empty outline). */
export function parseOutline(value: unknown): Outline {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const modules = Array.isArray(v.modules) ? v.modules : [];
  return {
    courseVersionId: typeof v.course_version_id === "string" ? v.course_version_id : null,
    isStaff: v.is_staff === true,
    modules: modules
      .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
      .map((m) => ({
        id: str(m.id),
        lineage_id: str(m.lineage_id),
        title: str(m.title),
        description: str(m.description),
        position: numOrNull(m.position) ?? 0,
        lessons: (Array.isArray(m.lessons) ? m.lessons : [])
          .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === "object")
          .map(parseLesson),
      })),
  };
}

export function flattenLessons(modules: OutlineModule[]): { lesson: OutlineLesson; module: OutlineModule }[] {
  return modules.flatMap((module) => module.lessons.map((lesson) => ({ lesson, module })));
}

export type LessonContext = {
  lesson: OutlineLesson;
  module: OutlineModule;
  moduleIndex: number;
  /** 1-based position in the whole course, and the course's lesson count. */
  number: number;
  total: number;
  prev: OutlineLesson | null;
  next: OutlineLesson | null;
};

export function findLessonContext(modules: OutlineModule[], lessonId: string): LessonContext | null {
  const flat = flattenLessons(modules);
  const i = flat.findIndex((x) => x.lesson.id === lessonId);
  if (i < 0) return null;
  const { lesson, module } = flat[i];
  return {
    lesson,
    module,
    moduleIndex: modules.indexOf(module),
    number: i + 1,
    total: flat.length,
    prev: i > 0 ? flat[i - 1].lesson : null,
    next: i < flat.length - 1 ? flat[i + 1].lesson : null,
  };
}

export type LessonStatus = "completed" | "in_progress" | "not_started" | "locked";

/**
 * A completed lesson stays "completed" even if a rule added later would lock it now:
 * rule changes never revoke recorded progress.
 */
export function lessonStatus(lesson: OutlineLesson): LessonStatus {
  if (lesson.completed_at) return "completed";
  if (lesson.lock_reasons.length > 0) return "locked";
  if (lesson.last_position_seconds !== null) return "in_progress";
  return "not_started";
}

export function requiredCounts(lessons: OutlineLesson[]): { total: number; done: number } {
  const required = lessons.filter((l) => l.required);
  return { total: required.length, done: required.filter((l) => l.completed_at).length };
}

export type NextAction =
  | { kind: "empty" }
  | { kind: "done"; total: number }
  | { kind: "optional"; lesson: OutlineLesson | null }
  | { kind: "start"; lesson: OutlineLesson }
  | { kind: "continue"; lesson: OutlineLesson }
  | { kind: "locked"; lesson: OutlineLesson };

/**
 * The learner's next step: the first required lesson (in course order) that is not
 * complete and not locked. "Start" when the learner has no progress at all yet. When
 * every remaining required lesson is locked, the first of them is returned with its
 * reasons so the page can say exactly what to do. Optional lessons never block.
 */
export function nextAction(modules: OutlineModule[]): NextAction {
  const flat = flattenLessons(modules).map((x) => x.lesson);
  if (flat.length === 0) return { kind: "empty" };
  const required = flat.filter((l) => l.required);
  if (required.length === 0) {
    return { kind: "optional", lesson: flat.find((l) => l.lock_reasons.length === 0 && !l.completed_at) ?? null };
  }
  const remaining = required.filter((l) => !l.completed_at);
  if (remaining.length === 0) return { kind: "done", total: required.length };
  const open = remaining.find((l) => l.lock_reasons.length === 0);
  if (!open) return { kind: "locked", lesson: remaining[0] };
  const started = flat.some((l) => l.completed_at || l.last_position_seconds !== null);
  return started ? { kind: "continue", lesson: open } : { kind: "start", lesson: open };
}

export type LearnerLessonState = OutlineLesson & {
  /** Conditions configured for the lesson that this learner has not met (ignoring overrides). */
  rule_reasons: LockReason[];
  /** Active override for this learner and lesson, if any. */
  override_id: string | null;
  started_at: string | null;
  updated_at: string | null;
  max_position_seconds: number | null;
  duration_seconds: number | null;
};

export type LearnerOutline = {
  enrollmentStatus: string;
  modules: (Omit<OutlineModule, "lessons"> & { lessons: LearnerLessonState[] })[];
};

/** Parses public.learner_outline (staff view of one learner's lesson states). */
export function parseLearnerOutline(value: unknown): LearnerOutline {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const modules = Array.isArray(v.modules) ? v.modules : [];
  return {
    enrollmentStatus: str(v.enrollment_status),
    modules: modules
      .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
      .map((m) => ({
        id: str(m.id),
        lineage_id: str(m.lineage_id),
        title: str(m.title),
        description: str(m.description),
        position: numOrNull(m.position) ?? 0,
        lessons: (Array.isArray(m.lessons) ? m.lessons : [])
          .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === "object")
          .map((l) => ({
            ...parseLesson(l),
            rule_reasons: parseLockReasons(l.rule_reasons),
            override_id: typeof l.override_id === "string" ? l.override_id : null,
            started_at: typeof l.started_at === "string" ? l.started_at : null,
            updated_at: typeof l.updated_at === "string" ? l.updated_at : null,
            max_position_seconds: numOrNull(l.max_position_seconds),
            duration_seconds: numOrNull(l.duration_seconds),
          })),
      })),
  };
}
