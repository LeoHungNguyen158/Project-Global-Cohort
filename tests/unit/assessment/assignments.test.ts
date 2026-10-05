import { describe, expect, it } from "vitest";
import { levelForScore, parseRubric, parseRubricScores, rubricTotal, scoreRubric, shortId, validateRubric, type RubricCriterion } from "@/lib/assessment/rubric";
import { rubricProblemText } from "@/lib/assessment/rubric-text";
import { inQueue, learnerAssignmentState, queueCounts, submissionWindow, submitBlock, QUEUE_FILTERS, type QueueRow } from "@/lib/assessment/assignment-status";

const criterion = (id: string, points: number, extra: Partial<RubricCriterion> = {}): RubricCriterion => ({
  id,
  criterion: `Criterion ${id}`,
  description: "",
  points,
  levels: [],
  ...extra,
});

describe("rubric parsing and totals", () => {
  it("reads stored rubrics tolerantly, including the seed format without levels", () => {
    const rubric = parseRubric([
      { id: "clarity", criterion: "Clarity", points: 40 },
      { id: "safety", title: "Safety", points: "30" },
      { id: "bad id!", criterion: "Dropped", points: 10 },
      { id: "zero", criterion: "Dropped", points: 0 },
      "nonsense",
    ]);
    expect(rubric.map((c) => [c.id, c.criterion, c.points])).toEqual([
      ["clarity", "Clarity", 40],
      ["safety", "Safety", 30],
    ]);
    expect(parseRubric(null)).toEqual([]);
  });

  it("totals decimal points exactly", () => {
    expect(rubricTotal([criterion("a", 0.1), criterion("b", 0.2)])).toBe(0.3);
    expect(rubricTotal([])).toBe(0);
  });
});

describe("validateRubric", () => {
  it("accepts an empty rubric and a rubric that matches the points", () => {
    expect(validateRubric([], 100)).toBeNull();
    expect(validateRubric([criterion("a", 60), criterion("b", 40)], 100)).toBeNull();
  });

  it("reports the first problem with its position", () => {
    expect(validateRubric([criterion("a", 60), criterion("b", 30)], 100)).toEqual({ code: "totalMismatch", total: 90, points: 100 });
    expect(validateRubric([criterion("a", 50), criterion("a", 50)], 100)).toEqual({ code: "duplicateId" });
    expect(validateRubric([criterion("a", 50), criterion("b", 50, { criterion: " " })], 100)).toEqual({ code: "criterionText", index: 1 });
    expect(
      validateRubric([criterion("a", 100, { levels: [{ id: "l1", label: "Great", points: 120, description: "" }] })], 100),
    ).toEqual({ code: "levelPoints", index: 0, level: 0 });
    expect(validateRubric([criterion("a", 100, { levels: [{ id: "l1", label: "", points: 50, description: "" }] })], 100)).toEqual({
      code: "levelLabel",
      index: 0,
      level: 0,
    });
    expect(validateRubric(Array.from({ length: 21 }, (_, i) => criterion(`c${i}`, 1)), 21)).toEqual({ code: "tooMany" });
  });

  it("turns problems into numbered messages", () => {
    expect(rubricProblemText({ code: "criterionText", index: 1 })).toMatch(/Criterion 2/);
    expect(rubricProblemText({ code: "totalMismatch", total: 90, points: 100 })).toMatch(/90.*100/);
  });
});

describe("scoreRubric", () => {
  const rubric = [criterion("clarity", 40), criterion("safety", 30), criterion("eval", 30)];

  it("sums criterion scores rounded to cents", () => {
    expect(scoreRubric(rubric, { clarity: 35.555, safety: 30, eval: 0 })).toEqual({ ok: true, total: 65.56, scores: { clarity: 35.56, safety: 30, eval: 0 } });
  });

  it("requires every criterion within its points", () => {
    expect(scoreRubric(rubric, { clarity: 35, safety: null, eval: 31 })).toEqual({ ok: false, missing: ["safety"], invalid: ["eval"] });
    expect(scoreRubric(rubric, { clarity: -1, safety: 1, eval: 1 })).toEqual({ ok: false, missing: [], invalid: ["clarity"] });
  });

  it("matches levels and reads stored scores", () => {
    const c = criterion("x", 10, { levels: [{ id: "hi", label: "Strong", points: 10, description: "" }, { id: "mid", label: "Partial", points: 5, description: "" }] });
    expect(levelForScore(c, 5)?.label).toBe("Partial");
    expect(levelForScore(c, 7)).toBeNull();
    expect(parseRubricScores({ x: "5", y: 2, z: "nope" })).toEqual({ x: 5, y: 2 });
    expect(parseRubricScores([1, 2])).toEqual({});
  });

  it("makes short URL-safe ids", () => {
    const id = shortId("c");
    expect(id).toMatch(/^c[a-z0-9]{8}$/);
    expect(shortId("c")).not.toBe(id);
  });
});

describe("assignment status", () => {
  it("derives the learner state; grades show only once released", () => {
    expect(learnerAssignmentState({ submission: null, latestVersionLate: null, hasReleasedGrade: false })).toBe("not_started");
    expect(learnerAssignmentState({ submission: { status: "draft", submitted_count: 0 }, latestVersionLate: null, hasReleasedGrade: false })).toBe("draft");
    expect(learnerAssignmentState({ submission: { status: "submitted", submitted_count: 1 }, latestVersionLate: false, hasReleasedGrade: false })).toBe("submitted");
    expect(learnerAssignmentState({ submission: { status: "submitted", submitted_count: 1 }, latestVersionLate: true, hasReleasedGrade: false })).toBe("late");
    expect(learnerAssignmentState({ submission: { status: "returned", submitted_count: 1 }, latestVersionLate: false, hasReleasedGrade: false })).toBe("returned");
    expect(learnerAssignmentState({ submission: { status: "graded", submitted_count: 1 }, latestVersionLate: false, hasReleasedGrade: false })).toBe("graded_unreleased");
    expect(learnerAssignmentState({ submission: { status: "graded", submitted_count: 1 }, latestVersionLate: false, hasReleasedGrade: true })).toBe("graded");
  });

  it("mirrors the database's time window and late policy", () => {
    const a = { available_from: "2026-10-01T00:00:00Z", due_at: "2026-10-10T00:00:00Z", closes_at: "2026-10-12T00:00:00Z", late_policy: "accept_flag" as const };
    expect(submissionWindow(new Date("2026-09-30T00:00:00Z"), a)).toBe("not_open");
    expect(submissionWindow(new Date("2026-10-05T00:00:00Z"), a)).toBe("open");
    expect(submissionWindow(new Date("2026-10-11T00:00:00Z"), a)).toBe("late_allowed");
    expect(submissionWindow(new Date("2026-10-11T00:00:00Z"), { ...a, late_policy: "reject" })).toBe("late_rejected");
    expect(submissionWindow(new Date("2026-10-13T00:00:00Z"), a)).toBe("closed");
    expect(submissionWindow(new Date("2030-01-01T00:00:00Z"), { available_from: null, due_at: null, closes_at: null, late_policy: "reject" })).toBe("open");
  });

  it("explains why a learner cannot submit", () => {
    const ok = { isActiveLearner: true, readOnly: false, window: "open" as const, submittedCount: 0, maxSubmissions: 3, status: null };
    expect(submitBlock(ok)).toBeNull();
    expect(submitBlock({ ...ok, readOnly: true })).toBe("read_only");
    expect(submitBlock({ ...ok, isActiveLearner: false })).toBe("not_learner");
    expect(submitBlock({ ...ok, window: "closed" })).toBe("closed");
    expect(submitBlock({ ...ok, window: "late_rejected" })).toBe("late_rejected");
    expect(submitBlock({ ...ok, window: "late_allowed" })).toBeNull();
    expect(submitBlock({ ...ok, status: "graded", submittedCount: 1 })).toBe("graded");
    expect(submitBlock({ ...ok, status: "returned", submittedCount: 3 })).toBe("limit_reached");
  });

  it("counts the staff queue with the same predicate as the list", () => {
    const rows: QueueRow[] = [
      { status: null, latestLate: false },
      { status: "draft", latestLate: false },
      { status: "submitted", latestLate: false },
      { status: "submitted", latestLate: true },
      { status: "returned", latestLate: true },
      { status: "graded", latestLate: false },
    ];
    const counts = queueCounts(rows);
    expect(counts).toEqual({ all: 6, to_grade: 2, late: 2, returned: 1, graded: 1, not_submitted: 2 });
    for (const f of QUEUE_FILTERS) expect(rows.filter((r) => inQueue(f, r)).length).toBe(counts[f]);
  });
});
