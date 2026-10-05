import { describe, expect, it } from "vitest";
import {
  completionEdges,
  describeLockReason,
  describeRule,
  onlyWaitingForStart,
  parseLockReasons,
  wouldCreateCycle,
  type RuleRow,
} from "@/lib/domain/prerequisites";

const ctx = { offeringId: "o-1", tz: "America/New_York" };

describe("prerequisite graph", () => {
  const rules = [
    { target: "l5", required: "l3" },
    { target: "l6", required: "l5" },
  ];
  it("rejects self-references and cycles of any length", () => {
    expect(wouldCreateCycle(rules, { target: "l3", required: "l3" })).toBe(true);
    expect(wouldCreateCycle(rules, { target: "l3", required: "l5" })).toBe(true);
    expect(wouldCreateCycle(rules, { target: "l3", required: "l6" })).toBe(true);
  });
  it("accepts new edges that keep the graph acyclic", () => {
    expect(wouldCreateCycle(rules, { target: "l7", required: "l6" })).toBe(false);
    expect(wouldCreateCycle(rules, { target: "l6", required: "l3" })).toBe(false);
    expect(wouldCreateCycle([], { target: "a", required: "b" })).toBe(false);
  });
  it("only lesson-completion rules form edges", () => {
    const rows: RuleRow[] = [
      { id: "1", target_lesson_lineage: "b", kind: "lesson_complete", required_lesson_lineage: "a", quiz_id: null, min_score_pct: null, release_at: null },
      { id: "2", target_lesson_lineage: "c", kind: "quiz_min_score", required_lesson_lineage: null, quiz_id: "q", min_score_pct: "70.00", release_at: null },
      { id: "3", target_lesson_lineage: "c", kind: "release_at", required_lesson_lineage: null, quiz_id: null, min_score_pct: null, release_at: "2026-10-19T00:00:00Z" },
    ];
    expect(completionEdges(rows)).toEqual([{ target: "b", required: "a" }]);
    expect(wouldCreateCycle(completionEdges(rows), { target: "a", required: "b" })).toBe(true);
  });
});

describe("lock reasons from the database", () => {
  it("parses every kind, including numeric strings from numeric columns", () => {
    const parsed = parseLockReasons([
      { kind: "offering_start", starts_at: "2027-01-03T01:00:00+00:00" },
      { kind: "release_at", release_at: "2026-10-19T01:16:41+00:00" },
      { kind: "lesson_complete", lesson_id: "l-3", lesson_title: "Lecture: The agent loop" },
      { kind: "quiz_min_score", quiz_id: "q-1", quiz_title: "Quiz 1", quiz_open: true, min_score_pct: "70.00", current_pct: 45.5 },
      { kind: "quiz_min_score", quiz_id: null, quiz_title: null, quiz_open: false, min_score_pct: 80, current_pct: null },
      { kind: "something_new" },
      null,
    ]);
    expect(parsed).toHaveLength(6);
    expect(parsed[3]).toEqual({ kind: "quiz_min_score", quiz_id: "q-1", quiz_title: "Quiz 1", quiz_open: true, min_score_pct: 70, current_pct: 45.5 });
    expect(parsed[4]).toEqual({ kind: "quiz_min_score", quiz_id: "", quiz_title: "", quiz_open: false, min_score_pct: 80, current_pct: null });
    expect(parseLockReasons("nope")).toEqual([]);
  });

  it("states the precise unmet condition with a link to resolve it", () => {
    const lesson = describeLockReason({ kind: "lesson_complete", lesson_id: "l-3", lesson_title: "Lecture: The agent loop" }, ctx);
    expect(lesson.text).toBe("Complete “Lecture: The agent loop” first.");
    expect(lesson.href).toBe("/courses/o-1/content/l-3");
    expect(lesson.action).toBe("Go to Lecture: The agent loop");

    const quiz = describeLockReason({ kind: "quiz_min_score", quiz_id: "q-1", quiz_title: "Quiz 1", quiz_open: true, min_score_pct: 70, current_pct: 45.5 }, ctx);
    expect(quiz.text).toBe("Score at least 70% on “Quiz 1” (your released score: 45.5%).");
    expect(quiz.href).toBe("/courses/o-1/quizzes/q-1");
    const unreleased = describeLockReason({ kind: "quiz_min_score", quiz_id: "q-1", quiz_title: "Quiz 1", quiz_open: true, min_score_pct: 70, current_pct: null }, ctx);
    expect(unreleased.text).toContain("no released score yet");
    // A quiz learners cannot open yet: no title and no link that would not work.
    const notOpen = describeLockReason({ kind: "quiz_min_score", quiz_id: "", quiz_title: "", quiz_open: false, min_score_pct: 80, current_pct: null }, ctx);
    expect(notOpen.text).toBe("Score at least 80% on a quiz that has not opened yet.");
    expect(notOpen.href).toBeUndefined();

    const release = describeLockReason({ kind: "release_at", release_at: "2026-10-19T01:16:41Z" }, ctx);
    expect(release.text).toBe("Opens Oct 18, 2026, 9:16 PM EDT.");
    expect(release.href).toBeUndefined();

    const start = describeLockReason({ kind: "offering_start", starts_at: "2027-01-03T01:00:00Z" }, { ...ctx, tz: "Asia/Ho_Chi_Minh", courseTz: "Asia/Ho_Chi_Minh" });
    expect(start.text).toBe("The course opens Jan 3, 2027, 8:00 AM GMT+7.");
  });

  it("shows course time alongside the viewer's time when they differ", () => {
    const view = describeLockReason({ kind: "release_at", release_at: "2026-10-19T01:16:41Z" }, { ...ctx, courseTz: "Asia/Ho_Chi_Minh" });
    expect(view.text).toContain("(course time: Oct 19, 2026, 8:16 AM GMT+7)");
  });

  it("does not link to a prerequisite lesson that is missing from the version", () => {
    const view = describeLockReason({ kind: "lesson_complete", lesson_id: null, lesson_title: "a previous lesson" }, ctx);
    expect(view.href).toBeUndefined();
    expect(view.text).toContain("not part of this course version");
  });

  it("recognizes lessons that only wait for the course start", () => {
    expect(onlyWaitingForStart([{ kind: "offering_start", starts_at: "2027-01-03T00:00:00Z" }])).toBe(true);
    expect(onlyWaitingForStart([{ kind: "offering_start", starts_at: "x" }, { kind: "release_at", release_at: "y" }])).toBe(false);
    expect(onlyWaitingForStart([])).toBe(false);
  });
});

describe("configured rules (staff summary)", () => {
  const lookup = { tz: "America/New_York", lessonTitle: (l: string) => (l === "a" ? "Intro" : null), quizTitle: (q: string) => (q === "q" ? "Quiz 1" : null) };
  it("names the lesson, quiz score or release time", () => {
    expect(describeRule({ id: "1", target_lesson_lineage: "b", kind: "lesson_complete", required_lesson_lineage: "a", quiz_id: null, min_score_pct: null, release_at: null }, lookup)).toBe("Requires completing “Intro”");
    expect(describeRule({ id: "1", target_lesson_lineage: "b", kind: "lesson_complete", required_lesson_lineage: "zz", quiz_id: null, min_score_pct: null, release_at: null }, lookup)).toContain("not in the version");
    expect(describeRule({ id: "2", target_lesson_lineage: "b", kind: "quiz_min_score", required_lesson_lineage: null, quiz_id: "q", min_score_pct: "72.50", release_at: null }, lookup)).toBe("Requires at least 72.5% on “Quiz 1” (released grade)");
    expect(describeRule({ id: "3", target_lesson_lineage: "b", kind: "release_at", required_lesson_lineage: null, quiz_id: null, min_score_pct: null, release_at: "2026-11-02T14:00:00Z" }, lookup)).toBe("Releases Nov 2, 2026, 9:00 AM EST");
  });
});
