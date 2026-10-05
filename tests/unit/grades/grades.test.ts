import { describe, expect, it } from "vitest";
import {
  cellMatches,
  courseTotal,
  csvCell,
  exclusionReason,
  foldForSearch,
  formatPercent,
  formatPoints,
  gradebookCsv,
  learnerItemState,
  matchesSearch,
  parseMaxPoints,
  parsePoints,
  runningTotal,
  staffCell,
  toCsv,
  type CsvLabels,
  type TotalInput,
} from "@/lib/domain/grades";

const item = (id: string, max: number | string, grade: TotalInput["grade"], extra: Partial<TotalInput> = {}): TotalInput => ({
  id,
  maxPoints: max,
  countsTowardTotal: true,
  visibleToLearners: true,
  grade,
  ...extra,
});

describe("denominator rules", () => {
  const items: TotalInput[] = [
    item("graded", 100, { status: "graded", points: 85 }),
    item("zero", 10, { status: "graded", points: 0 }),
    item("missing", 20, { status: "missing", points: 0 }),
    item("exempt", 50, { status: "exempt", points: null }),
    item("ungraded", 30, null),
    item("pending", 40, { status: "pending", points: null }),
    item("not-counted", 25, { status: "graded", points: 25 }, { countsTowardTotal: false }),
    item("hidden", 15, { status: "graded", points: 15 }, { visibleToLearners: false }),
  ];

  it("includes graded (even zero) and missing items; excludes exempt, ungraded, pending, uncounted and hidden", () => {
    const t = courseTotal(items);
    expect(t.included).toEqual(["graded", "zero", "missing"]);
    expect(t.excluded).toEqual([
      { id: "exempt", reason: "exempt" },
      { id: "ungraded", reason: "no_grade" },
      { id: "pending", reason: "no_grade" },
      { id: "not-counted", reason: "not_counted" },
      { id: "hidden", reason: "hidden" },
    ]);
    // 85 + 0 + 0 earned of 100 + 10 + 20 possible.
    expect(t.earned).toBe("85");
    expect(t.possible).toBe("130");
    expect(t.percent).toBe("65.38");
  });

  it("a zero score lowers the total but an ungraded item does not", () => {
    const withZero = courseTotal([item("a", 10, { status: "graded", points: 10 }), item("b", 10, { status: "graded", points: 0 })]);
    const withUngraded = courseTotal([item("a", 10, { status: "graded", points: 10 }), item("b", 10, null)]);
    expect(withZero.percent).toBe("50.00");
    expect(withUngraded.percent).toBe("100.00");
  });

  it("missing counts as zero, exempt is neutral", () => {
    const base = [item("a", 10, { status: "graded", points: 8 })];
    expect(courseTotal([...base, item("m", 10, { status: "missing", points: null })]).percent).toBe("40.00");
    expect(courseTotal([...base, item("e", 10, { status: "exempt", points: null })]).percent).toBe("80.00");
  });

  it("returns no percentage (never a fabricated 0%) when nothing is in the denominator", () => {
    expect(courseTotal([]).percent).toBeNull();
    const onlyExcluded = courseTotal([item("e", 10, { status: "exempt", points: null }), item("u", 10, null)]);
    expect(onlyExcluded.percent).toBeNull();
    expect(onlyExcluded.earned).toBe("0");
    expect(onlyExcluded.possible).toBe("0");
    expect(formatPercent(onlyExcluded.percent)).toBeNull();
  });

  it("ignores items with an invalid max and graded rows without points", () => {
    expect(exclusionReason(item("x", 0, { status: "graded", points: 0 }))).toBe("invalid_max");
    expect(exclusionReason(item("y", 10, { status: "graded", points: null }))).toBe("no_grade");
  });
});

describe("decimal-safe arithmetic and one rounding rule", () => {
  it("adds decimal points exactly (no binary floating point drift)", () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004.
    const t = courseTotal([item("a", 1, { status: "graded", points: 0.1 }), item("b", 1, { status: "graded", points: 0.2 })]);
    expect(t.earned).toBe("0.3");
    expect(t.percent).toBe("15.00");
  });

  it("sums thirds without drift", () => {
    const t = courseTotal([
      item("a", 100, { status: "graded", points: "33.33" }),
      item("b", 100, { status: "graded", points: "33.33" }),
      item("c", 100, { status: "graded", points: "33.34" }),
    ]);
    expect(t.earned).toBe("100");
    expect(t.percent).toBe("33.33");
  });

  it("rounds percentages half-up to exactly two decimals", () => {
    // 28.73 / 200 = 14.365% exactly: half-up gives 14.37 (banker's rounding would give 14.36).
    expect(courseTotal([item("a", 200, { status: "graded", points: "28.73" })]).percent).toBe("14.37");
    // 2/3 = 66.666…% -> 66.67
    expect(courseTotal([item("a", 3, { status: "graded", points: 2 })]).percent).toBe("66.67");
    // 1/8 = 12.5% -> "12.50" (always two decimals)
    expect(courseTotal([item("a", 8, { status: "graded", points: 1 })]).percent).toBe("12.50");
    expect(courseTotal([item("a", 10, { status: "graded", points: 10 })]).percent).toBe("100.00");
  });

  it("rounds displayed points half-up to at most two decimals", () => {
    expect(formatPoints("7.125")).toBe("7.13");
    expect(formatPoints(85)).toBe("85");
    expect(formatPoints("85.00")).toBe("85");
    expect(formatPoints("33.30")).toBe("33.3");
    expect(formatPoints(null)).toBe("–");
    expect(formatPercent("87.50")).toBe("87.50%");
  });

  it("keeps the legacy runningTotal identical to courseTotal", () => {
    const released = [
      { status: "graded" as const, points: 85, max_points: 100, counts_toward_total: true },
      { status: "missing" as const, points: 0, max_points: 20, counts_toward_total: true },
      { status: "exempt" as const, points: null, max_points: 20, counts_toward_total: true },
      { status: "graded" as const, points: 9, max_points: 10, counts_toward_total: false },
    ];
    const legacy = runningTotal(released);
    const modern = courseTotal(
      released.map((r, i) => item(String(i), r.max_points, { status: r.status, points: r.points }, { countsTowardTotal: r.counts_toward_total })),
    );
    expect(legacy).toEqual({ earned: modern.earned, possible: modern.possible, percent: modern.percent, included: modern.included.length });
    expect(legacy.percent).toBe("70.83");
  });
});

describe("points input validation", () => {
  it("accepts up to two decimals with a dot or comma, within 0..max", () => {
    expect(parsePoints("7", 10)).toEqual({ ok: true, value: 7, text: "7" });
    expect(parsePoints(" 7.5 ", 10)).toEqual({ ok: true, value: 7.5, text: "7.5" });
    expect(parsePoints("7,25", 10)).toEqual({ ok: true, value: 7.25, text: "7.25" });
    expect(parsePoints("0", 10)).toMatchObject({ ok: true, value: 0 });
    expect(parsePoints("10", "10.00")).toMatchObject({ ok: true, value: 10 });
  });

  it("rejects empty, malformed, negative, too precise and out-of-range values", () => {
    expect(parsePoints("", 10)).toEqual({ ok: false, reason: "required" });
    expect(parsePoints("abc", 10)).toEqual({ ok: false, reason: "format" });
    expect(parsePoints("-1", 10)).toEqual({ ok: false, reason: "format" });
    expect(parsePoints("7.125", 10)).toEqual({ ok: false, reason: "format" });
    expect(parsePoints("1e2", 1000)).toEqual({ ok: false, reason: "format" });
    expect(parsePoints("10.01", 10)).toEqual({ ok: false, reason: "range" });
  });

  it("validates grade item max points", () => {
    expect(parseMaxPoints("10")).toMatchObject({ ok: true, value: 10 });
    expect(parseMaxPoints("0")).toEqual({ ok: false, reason: "range" });
    expect(parseMaxPoints("1000000")).toEqual({ ok: false, reason: "format" });
    expect(parseMaxPoints("12.345")).toEqual({ ok: false, reason: "format" });
  });
});

describe("learner item states", () => {
  const none = { kind: "other" as const };
  it("shows released, zero, missing and exempt from released grades only", () => {
    expect(learnerItemState({ status: "graded", points: 9 }, none).state).toBe("released");
    expect(learnerItemState({ status: "graded", points: "0.00" }, none).state).toBe("zero");
    expect(learnerItemState({ status: "missing", points: 0 }, none).state).toBe("missing");
    expect(learnerItemState({ status: "exempt", points: null }, none).state).toBe("exempt");
    expect(learnerItemState(null, none).state).toBe("not_graded");
  });

  it("infers 'not yet published' only from the learner's own work status", () => {
    expect(learnerItemState(null, { kind: "assignment", submissionStatus: "graded" }).state).toBe("not_published");
    expect(learnerItemState(null, { kind: "assignment", submissionStatus: "submitted" }).state).toBe("awaiting_grading");
    expect(learnerItemState(null, { kind: "assignment", submissionStatus: "returned" }).state).toBe("returned");
    expect(learnerItemState(null, { kind: "assignment", submissionStatus: "draft" }).state).toBe("not_graded");
    expect(learnerItemState(null, { kind: "quiz", attemptStatuses: ["graded"] }).state).toBe("not_published");
    expect(learnerItemState(null, { kind: "quiz", attemptStatuses: ["graded", "submitted"] }).state).toBe("awaiting_grading");
    expect(learnerItemState(null, { kind: "quiz", attemptStatuses: ["in_progress"] }).state).toBe("in_progress");
    expect(learnerItemState(null, { kind: "quiz", attemptStatuses: ["voided"] }).state).toBe("not_graded");
  });

  it("flags newer work awaiting grading next to a released result", () => {
    const r = learnerItemState({ status: "graded", points: 80 }, { kind: "quiz", attemptStatuses: ["graded", "submitted"] });
    expect(r).toEqual({ state: "released", newerWorkPending: true });
  });
});

describe("gradebook cells", () => {
  it("derives entry and publication state", () => {
    expect(staffCell(null, false)).toEqual({ entry: "ungraded", publication: "none", needsGrading: false, publishable: false });
    expect(staffCell(null, false, true).needsGrading).toBe(true);
    expect(staffCell({ id: "g", status: "graded", points: 7, dirty: true }, false)).toMatchObject({ publication: "unpublished", publishable: true });
    expect(staffCell({ id: "g", status: "graded", points: 7, dirty: false }, true)).toMatchObject({ publication: "published", publishable: false });
    expect(staffCell({ id: "g", status: "graded", points: 8, dirty: true }, true)).toMatchObject({ publication: "changed", publishable: true });
    expect(staffCell({ id: "g", status: "pending", points: null, dirty: true }, false)).toMatchObject({
      entry: "pending",
      publication: "none",
      needsGrading: true,
      publishable: false,
    });
  });

  it("filters cells by status", () => {
    const unpublished = staffCell({ id: "g", status: "missing", points: 0, dirty: true }, false);
    const published = staffCell({ id: "g", status: "exempt", points: null, dirty: false }, true);
    const pending = staffCell({ id: "g", status: "pending", points: null, dirty: true }, false);
    expect(cellMatches(unpublished, "unpublished")).toBe(true);
    expect(cellMatches(unpublished, "missing")).toBe(true);
    expect(cellMatches(published, "published")).toBe(true);
    expect(cellMatches(published, "unpublished")).toBe(false);
    expect(cellMatches(pending, "needs_grading")).toBe(true);
    expect(cellMatches(pending, "ungraded")).toBe(true);
    expect(cellMatches(pending, "unpublished")).toBe(false);
    expect(cellMatches(staffCell(null, false), "ungraded")).toBe(true);
    expect(cellMatches(staffCell(null, false), "all")).toBe(true);
  });
});

describe("learner search", () => {
  it("matches Vietnamese names with or without diacritics", () => {
    expect(foldForSearch("Trần Thị Đặng")).toBe("tran thi dang");
    expect(matchesSearch("Mai Trần", "tran")).toBe(true);
    expect(matchesSearch("Đặng Quốc Huy", "dang quoc")).toBe(true);
    expect(matchesSearch("Đặng Quốc Huy", "Đặng")).toBe(true);
    expect(matchesSearch("Kwame Mensah", "  ")).toBe(true);
    expect(matchesSearch("Kwame Mensah", "priya")).toBe(false);
  });
});

describe("CSV export", () => {
  it("neutralizes formulas and quotes separators", () => {
    expect(csvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(\"http://x\",\"y\")")).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
    expect(toCsv([["a", 1], [null, "b\nc"]])).toBe('a,1\r\n,"b\nc"\r\n');
  });

  const labels: CsvLabels = {
    learner: "Learner",
    enrollment: "Enrollment",
    pointsHeader: (t, max) => `${t} (out of ${max})`,
    statusHeader: (t) => `${t} status`,
    releasedEarned: "Released points",
    releasedPossible: "Released possible",
    releasedPercent: "Released %",
    workingPercent: "Working %",
    cellStatus: (c) => `${c.entry}/${c.publication}`,
    enrollmentStatus: (s) => s,
  };

  it("builds rows whose totals match the learner view", () => {
    const items = [
      { id: "i1", title: "=Participation", maxPoints: 10 },
      { id: "i2", title: "Project", maxPoints: "100.00" },
    ];
    const g1 = { status: "graded" as const, points: 7.5 };
    const released = courseTotal([item("i1", 10, g1), item("i2", 100, null)]);
    const working = courseTotal([item("i1", 10, g1), item("i2", 100, { status: "missing", points: 0 })]);
    const csv = gradebookCsv(
      items,
      [
        {
          name: "@Mallory",
          enrollmentStatus: "active",
          cells: {
            i1: { cell: staffCell({ id: "a", ...g1, dirty: false }, true), points: 7.5 },
            i2: { cell: staffCell({ id: "b", status: "missing", points: 0, dirty: true }, false), points: 0 },
          },
          released,
          working,
        },
        { name: "Nguyễn Văn An", enrollmentStatus: "completed", cells: {}, released: courseTotal([]), working: courseTotal([]) },
      ],
      labels,
    );
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "Learner,Enrollment,'=Participation (out of 10),'=Participation status,Project (out of 100),Project status,Released points,Released possible,Released %,Working %",
    );
    expect(lines[1]).toBe("'@Mallory,active,7.5,graded/published,0,missing/unpublished,7.5,10,75.00,6.82");
    // No released grades: totals stay empty rather than a fabricated 0%.
    expect(lines[2]).toBe("Nguyễn Văn An,completed,,ungraded/none,,ungraded/none,,,,");
    expect(released.percent).toBe("75.00");
    expect(csv).not.toMatch(/@sample\.crewscaler\.test/);
  });
});
