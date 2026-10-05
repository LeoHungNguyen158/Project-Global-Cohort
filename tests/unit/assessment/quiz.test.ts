import { describe, expect, it } from "vitest";
import {
  computeDeadline,
  effectiveAttempt,
  formatCountdown,
  hasPassed,
  isAnswered,
  learnerQuizState,
  normalizeResponse,
  percentOf,
  projectAttemptWindow,
  quizWindowState,
  remainingMs,
  reviewExplanation,
  sameResponse,
  scoreQuestion,
} from "@/lib/domain/quiz";
import { pointsLabel, questionCountText, reviewExplanationText, scoreText, timeLimitText, windowText } from "@/lib/assessment/quiz-text";

const at = (iso: string) => new Date(iso);

describe("scoreQuestion", () => {
  it("scores single choice and true/false by exact match", () => {
    expect(scoreQuestion("single_choice", 2, ["b"], { choice: "b" })).toBe(2);
    expect(scoreQuestion("single_choice", 2, ["b"], { choice: "a" })).toBe(0);
    expect(scoreQuestion("true_false", 1, ["false"], { choice: "false" })).toBe(1);
    expect(scoreQuestion("true_false", 1, ["false"], { choice: "true" })).toBe(0);
  });

  it("gives 0 (never negative) for blank or malformed answers", () => {
    expect(scoreQuestion("single_choice", 2, ["b"], null)).toBe(0);
    expect(scoreQuestion("single_choice", 2, ["b"], { choice: 3 })).toBe(0);
    expect(scoreQuestion("multiple_select", 3, ["a", "c"], { choices: "a" })).toBe(0);
    expect(scoreQuestion("multiple_select", 3, ["a", "c"], undefined)).toBe(0);
  });

  it("scores multiple select all-or-nothing regardless of order", () => {
    expect(scoreQuestion("multiple_select", 3, ["a", "c"], { choices: ["c", "a"] })).toBe(3);
    expect(scoreQuestion("multiple_select", 3, ["a", "c"], { choices: ["a"] })).toBe(0);
    expect(scoreQuestion("multiple_select", 3, ["a", "c"], { choices: ["a", "c", "d"] })).toBe(0);
    expect(scoreQuestion("multiple_select", 3, ["a", "c"], { choices: ["a", "b"] })).toBe(0);
  });

  it("leaves short answers for manual grading", () => {
    expect(scoreQuestion("short_answer", 5, [], { text: "anything" })).toBeNull();
  });
});

describe("computeDeadline and projectAttemptWindow", () => {
  const start = at("2026-10-05T10:00:00Z");

  it("uses the time limit plus extra minutes when the close is later", () => {
    const d = computeDeadline({ start, timeLimitMinutes: 20, extraMinutes: 10, closesAt: at("2026-10-05T12:00:00Z"), truncateAtClose: true });
    expect(d?.toISOString()).toBe("2026-10-05T10:30:00.000Z");
  });

  it("truncates at the closing time when the quiz truncates at close", () => {
    const opts = { start, timeLimitMinutes: 60, closesAt: at("2026-10-05T10:25:00Z"), truncateAtClose: true };
    expect(computeDeadline(opts)?.toISOString()).toBe("2026-10-05T10:25:00.000Z");
    const p = projectAttemptWindow(opts);
    expect(p.truncated).toBe(true);
    expect(p.availableMinutes).toBe(25);
    expect(p.fullLimitDeadline?.toISOString()).toBe("2026-10-05T11:00:00.000Z");
  });

  it("does not truncate when truncation is off", () => {
    const opts = { start, timeLimitMinutes: 60, closesAt: at("2026-10-05T10:25:00Z"), truncateAtClose: false };
    expect(computeDeadline(opts)?.toISOString()).toBe("2026-10-05T11:00:00.000Z");
    expect(projectAttemptWindow(opts).truncated).toBe(false);
  });

  it("prefers an extended (accommodated) close over the quiz close", () => {
    const d = computeDeadline({
      start,
      timeLimitMinutes: 60,
      closesAt: at("2026-10-05T10:25:00Z"),
      extendedClosesAt: at("2026-10-05T10:50:00Z"),
      truncateAtClose: true,
    });
    expect(d?.toISOString()).toBe("2026-10-05T10:50:00.000Z");
  });

  it("without a time limit the deadline is the close (or none)", () => {
    expect(computeDeadline({ start, timeLimitMinutes: null, closesAt: at("2026-10-06T00:00:00Z"), truncateAtClose: true })?.toISOString()).toBe(
      "2026-10-06T00:00:00.000Z",
    );
    expect(computeDeadline({ start, timeLimitMinutes: null, closesAt: null, truncateAtClose: true })).toBeNull();
    const p = projectAttemptWindow({ start, timeLimitMinutes: null, closesAt: null, truncateAtClose: true });
    expect(p).toEqual({ deadline: null, fullLimitDeadline: null, truncated: false, availableMinutes: null });
  });
});

describe("countdown", () => {
  it("measures remaining time against the server clock offset", () => {
    const deadline = "2026-10-05T10:20:00Z";
    const clientNow = at("2026-10-05T10:10:00Z").getTime();
    // The client clock is 30 s behind the server (offset = server - client = +30 s).
    expect(remainingMs(deadline, clientNow, 30_000)).toBe(570_000);
  });

  it("formats minutes and hours, rounds up and never goes negative", () => {
    expect(formatCountdown(299_001)).toBe("5:00");
    expect(formatCountdown(299_000)).toBe("4:59");
    expect(formatCountdown(3_909_000)).toBe("1:05:09");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5_000)).toBe("0:00");
  });
});

describe("quiz window and results", () => {
  it("classifies the quiz window", () => {
    const now = at("2026-10-05T10:00:00Z");
    expect(quizWindowState(now, "2026-10-06T00:00:00Z", null)).toBe("not_open");
    expect(quizWindowState(now, null, "2026-10-05T10:00:00Z")).toBe("closed");
    expect(quizWindowState(now, "2026-10-01T00:00:00Z", "2026-10-09T00:00:00Z")).toBe("open");
  });

  it("picks the effective attempt by rule, ignoring ungraded and voided attempts", () => {
    const attempts = [
      { attemptNo: 1, pct: 80, status: "graded" as const },
      { attemptNo: 2, pct: 80, status: "graded" as const },
      { attemptNo: 3, pct: 95, status: "voided" as const },
      { attemptNo: 4, pct: 60, status: "graded" as const },
      { attemptNo: 5, pct: 99, status: "submitted" as const },
    ];
    expect(effectiveAttempt(attempts, "highest")?.attemptNo).toBe(1);
    expect(effectiveAttempt(attempts, "latest")?.attemptNo).toBe(4);
    expect(effectiveAttempt([], "highest")).toBeNull();
  });

  it("computes percentages half-up and compares the pass mark on the shown value", () => {
    expect(percentOf(2, 3)).toBe("66.67");
    expect(percentOf("7.5", "10")).toBe("75.00");
    expect(percentOf(1, 0)).toBeNull();
    expect(percentOf(null, 10)).toBeNull();
    expect(hasPassed("69.995", 70)).toBe(false);
    expect(hasPassed(percentOf(6.9995, 10), 70)).toBe(true);
    expect(hasPassed(null, 70)).toBeNull();
  });

  it("derives the learner's quiz state", () => {
    expect(learnerQuizState([], false)).toBe("not_started");
    expect(learnerQuizState([{ status: "graded", attemptNo: 1 }, { status: "in_progress", attemptNo: 2 }], true)).toBe("in_progress");
    expect(learnerQuizState([{ status: "submitted", attemptNo: 1 }], false)).toBe("pending_manual");
    expect(learnerQuizState([{ status: "graded", attemptNo: 1 }], false)).toBe("awaiting_release");
    expect(learnerQuizState([{ status: "graded", attemptNo: 1 }], true)).toBe("released");
    expect(learnerQuizState([{ status: "voided", attemptNo: 1 }], false)).toBe("voided");
  });

  it("explains review availability by policy", () => {
    expect(reviewExplanation("after_close", { available: true, effectiveClosesAt: null, answersReleasedAt: null })).toEqual({ kind: "available" });
    expect(reviewExplanation("after_close", { available: false, effectiveClosesAt: "2026-10-09T00:00:00Z", answersReleasedAt: null })).toEqual({
      kind: "after_close",
      at: "2026-10-09T00:00:00Z",
    });
    expect(reviewExplanation("manual", { available: false, effectiveClosesAt: null, answersReleasedAt: null })).toEqual({ kind: "manual", releasedAt: null });
    expect(reviewExplanation("never", { available: false, effectiveClosesAt: null, answersReleasedAt: null })).toEqual({ kind: "never" });
  });
});

describe("responses", () => {
  it("normalizes valid responses and rejects malformed ones", () => {
    expect(normalizeResponse("single_choice", { choice: "c1" })).toEqual({ choice: "c1" });
    expect(normalizeResponse("single_choice", { choice: "" })).toBeNull();
    expect(normalizeResponse("single_choice", { choice: 7 })).toBe("invalid");
    expect(normalizeResponse("single_choice", ["c1"])).toBe("invalid");
    expect(normalizeResponse("multiple_select", { choices: ["a", "b", "a"] })).toEqual({ choices: ["a", "b"] });
    expect(normalizeResponse("multiple_select", { choices: [] })).toBeNull();
    expect(normalizeResponse("multiple_select", { choices: [""] })).toBe("invalid");
    expect(normalizeResponse("short_answer", { text: "  " })).toBeNull();
    expect(normalizeResponse("short_answer", { text: "x".repeat(10_001) })).toBe("invalid");
    expect(normalizeResponse("true_false", null)).toBeNull();
  });

  it("knows when a question counts as answered", () => {
    expect(isAnswered("short_answer", { text: " " })).toBe(false);
    expect(isAnswered("short_answer", { text: "ok" })).toBe(true);
    expect(isAnswered("multiple_select", { choices: [] })).toBe(false);
    expect(isAnswered("multiple_select", { choices: ["a"] })).toBe(true);
    expect(isAnswered("single_choice", null)).toBe(false);
    expect(isAnswered("true_false", { choice: "true" })).toBe(true);
  });

  it("compares responses regardless of selection order", () => {
    expect(sameResponse({ choices: ["a", "b"] }, { choices: ["b", "a"] })).toBe(true);
    expect(sameResponse({ choices: ["a"] }, { choices: ["a", "b"] })).toBe(false);
    expect(sameResponse({ choice: "a" }, { choice: "a" })).toBe(true);
    expect(sameResponse({ text: "a" }, { text: "a " })).toBe(false);
    expect(sameResponse(null, null)).toBe(true);
    expect(sameResponse(null, { choice: "a" })).toBe(false);
  });
});

describe("quiz display text", () => {
  it("formats scores, points and counts", () => {
    expect(scoreText(7.5, 10)).toBe("7.5 / 10 (75.00%)");
    expect(scoreText(null, 10)).toBeNull();
    expect(pointsLabel(1)).toMatch(/1 point/);
    expect(pointsLabel(2.5)).toMatch(/2\.5 points/);
    expect(questionCountText(1)).toMatch(/1 question/);
    expect(questionCountText(4)).toMatch(/4 questions/);
  });

  it("describes time limits including extra time", () => {
    expect(timeLimitText(null)).not.toMatch(/\d/);
    expect(timeLimitText(20)).toMatch(/20/);
    expect(timeLimitText(20, 10)).toMatch(/20.*10/);
  });

  it("describes the window in the viewer's time zone", () => {
    const now = at("2026-10-05T10:00:00Z");
    const open = windowText(now, null, "2026-10-09T03:59:00Z", "America/New_York");
    expect(open).toMatch(/Oct 8, 2026/);
    const notOpen = windowText(now, "2026-10-06T00:00:00Z", null, "Asia/Ho_Chi_Minh");
    expect(notOpen).toMatch(/Oct 6, 2026/);
    expect(windowText(now, null, "2026-10-01T00:00:00Z", "UTC")).toMatch(/Oct 1, 2026/);
  });

  it("explains review timing truthfully", () => {
    expect(reviewExplanationText({ kind: "after_close", at: "2026-10-09T00:00:00Z" }, "UTC")).toMatch(/Oct 9, 2026/);
    expect(reviewExplanationText({ kind: "manual", releasedAt: null }, "UTC")).not.toMatch(/2026/);
  });
});
