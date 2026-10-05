import { describe, expect, it } from "vitest";
import { findLessonContext, lessonStatus, nextAction, parseOutline, requiredCounts, type OutlineLesson, type OutlineModule } from "@/lib/learning/outline";

function lesson(id: string, patch: Partial<OutlineLesson> = {}): OutlineLesson {
  return {
    id,
    lineage_id: `lin-${id}`,
    title: `Lesson ${id}`,
    content_type: "text",
    required: true,
    duration_minutes: 10,
    completion_rule: "acknowledge",
    position: 0,
    lock_reasons: [],
    completed_at: null,
    last_position_seconds: null,
    ...patch,
  };
}

function mod(id: string, lessons: OutlineLesson[]): OutlineModule {
  return { id, lineage_id: `lin-${id}`, title: `Module ${id}`, description: "", position: 0, lessons };
}

const locked = [{ kind: "lesson_complete" as const, lesson_id: "a", lesson_title: "Lesson a" }];

describe("next action (next unlocked, incomplete, required lesson)", () => {
  it("starts with the first lesson when there is no progress", () => {
    expect(nextAction([mod("m1", [lesson("a"), lesson("b")])])).toEqual({ kind: "start", lesson: lesson("a") });
  });

  it("continues with the first incomplete required lesson, skipping optional and locked ones", () => {
    const modules = [
      mod("m1", [lesson("a", { completed_at: "2026-10-01T00:00:00Z", last_position_seconds: 0 }), lesson("opt", { required: false })]),
      mod("m2", [lesson("b", { lock_reasons: locked }), lesson("c")]),
    ];
    const action = nextAction(modules);
    expect(action.kind).toBe("continue");
    expect(action.kind === "continue" && action.lesson.id).toBe("c");
  });

  it("reports when every remaining required lesson is locked", () => {
    const modules = [mod("m1", [lesson("a", { completed_at: "x" }), lesson("b", { lock_reasons: locked })])];
    const action = nextAction(modules);
    expect(action.kind).toBe("locked");
    expect(action.kind === "locked" && action.lesson.id).toBe("b");
  });

  it("is done when all required lessons are complete, even if optional ones are not", () => {
    const modules = [mod("m1", [lesson("a", { completed_at: "x" }), lesson("opt", { required: false })])];
    expect(nextAction(modules)).toEqual({ kind: "done", total: 1 });
  });

  it("handles empty courses and courses with only optional lessons", () => {
    expect(nextAction([])).toEqual({ kind: "empty" });
    expect(nextAction([mod("m1", [])])).toEqual({ kind: "empty" });
    const optional = nextAction([mod("m1", [lesson("o", { required: false })])]);
    expect(optional.kind).toBe("optional");
  });
});

describe("lesson status", () => {
  it("keeps completed lessons completed even if a later rule locks them", () => {
    expect(lessonStatus(lesson("a", { completed_at: "x", lock_reasons: locked }))).toBe("completed");
    expect(lessonStatus(lesson("a", { lock_reasons: locked }))).toBe("locked");
    expect(lessonStatus(lesson("a", { last_position_seconds: 12 }))).toBe("in_progress");
    expect(lessonStatus(lesson("a"))).toBe("not_started");
  });

  it("counts required items only", () => {
    expect(requiredCounts([lesson("a", { completed_at: "x" }), lesson("b"), lesson("o", { required: false, completed_at: "x" })])).toEqual({ total: 2, done: 1 });
  });
});

describe("navigation", () => {
  const modules = [mod("m1", [lesson("a"), lesson("b")]), mod("m2", [lesson("c")])];
  it("finds previous and next lessons across modules", () => {
    const ctx = findLessonContext(modules, "b")!;
    expect(ctx.prev?.id).toBe("a");
    expect(ctx.next?.id).toBe("c");
    expect(ctx.number).toBe(2);
    expect(ctx.total).toBe(3);
    expect(ctx.module.id).toBe("m1");
    expect(findLessonContext(modules, "c")!.next).toBeNull();
    expect(findLessonContext(modules, "zzz")).toBeNull();
  });
});

describe("outline parsing", () => {
  it("reads the RPC JSON defensively", () => {
    const parsed = parseOutline({
      course_version_id: "v1",
      is_staff: false,
      modules: [
        {
          id: "m1", lineage_id: "lm1", title: "Getting started", description: "Intro", position: 0,
          lessons: [
            { id: "l1", lineage_id: "ll1", title: "Welcome", content_type: "video", required: false, duration_minutes: 5, completion_rule: "video_watched", position: 0,
              lock_reasons: [{ kind: "release_at", release_at: "2026-10-19T00:00:00Z" }], completed_at: null, last_position_seconds: 8 },
            { id: "l2", content_type: "weird" },
          ],
        },
        "junk",
      ],
    });
    expect(parsed.courseVersionId).toBe("v1");
    expect(parsed.modules).toHaveLength(1);
    expect(parsed.modules[0].lessons[0]).toMatchObject({ required: false, completion_rule: "video_watched", last_position_seconds: 8 });
    expect(parsed.modules[0].lessons[0].lock_reasons).toHaveLength(1);
    expect(parsed.modules[0].lessons[1]).toMatchObject({ content_type: "text", required: true, completion_rule: "acknowledge", last_position_seconds: null });
    expect(parseOutline(null).modules).toEqual([]);
  });
});
