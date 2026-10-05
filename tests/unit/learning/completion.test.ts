import { describe, expect, it } from "vitest";
import {
  completionMode,
  formatClock,
  isPlaybackRate,
  playbackRuleMet,
  playbackThresholdSeconds,
  playedPercent,
  resumePosition,
  saveIsDue,
  toWholeDuration,
  toWholeSeconds,
} from "@/lib/learning/completion";

describe("playback rule (mirrors mark_lesson_progress: furthest position >= 90% of duration)", () => {
  it("needs 90% of the duration", () => {
    expect(playbackRuleMet(17, 20)).toBe(false);
    expect(playbackRuleMet(18, 20)).toBe(true);
    expect(playbackRuleMet(20, 20)).toBe(true);
    expect(playbackRuleMet(89, 100)).toBe(false);
    expect(playbackRuleMet(90, 100)).toBe(true);
  });

  it("is never met without a known duration or position", () => {
    expect(playbackRuleMet(10, null)).toBe(false);
    expect(playbackRuleMet(10, 0)).toBe(false);
    expect(playbackRuleMet(null, 20)).toBe(false);
  });

  it("reports thresholds and played percentages", () => {
    expect(playbackThresholdSeconds(20)).toBe(18);
    expect(playbackThresholdSeconds(61)).toBe(55);
    expect(playbackThresholdSeconds(0)).toBe(Infinity);
    expect(playedPercent(8, 20)).toBe(40);
    expect(playedPercent(25, 20)).toBe(100);
    expect(playedPercent(0, 20)).toBe(0);
    expect(playedPercent(5, null)).toBe(0);
  });

  it("converts browser times to whole seconds the server accepts", () => {
    expect(toWholeSeconds(12.9)).toBe(12);
    expect(toWholeSeconds(-1)).toBe(0);
    expect(toWholeSeconds(Number.NaN)).toBe(0);
    expect(toWholeSeconds(20.4, 20.04)).toBe(20);
    expect(toWholeDuration(20.04)).toBe(20);
    expect(toWholeDuration(2.5)).toBe(3);
    expect(toWholeDuration(Number.POSITIVE_INFINITY)).toBeNull();
    // A short clip played to the end always satisfies the rule.
    const d = toWholeDuration(2.5)!;
    expect(playbackRuleMet(d, d)).toBe(true);
  });
});

describe("completion control per rule", () => {
  it("uses acknowledgement for readings and the playback rule only with an uploaded video", () => {
    expect(completionMode("acknowledge", false)).toBe("acknowledge");
    expect(completionMode("acknowledge", true)).toBe("acknowledge");
    expect(completionMode("video_watched", true)).toBe("played");
    expect(completionMode("video_watched", false)).toBe("unavailable");
  });
});

describe("resume and periodic saves", () => {
  it("resumes from the saved position unless it is at the very end", () => {
    expect(resumePosition(42, 120)).toBe(42);
    expect(resumePosition(119, 120)).toBe(0);
    expect(resumePosition(0, 120)).toBe(0);
    expect(resumePosition(null, 120)).toBe(0);
    expect(resumePosition(30, null)).toBe(30);
  });

  it("saves every 15 seconds while the position moves", () => {
    expect(saveIsDue({ now: 20_000, lastSavedAt: 0, lastSavedPosition: 1, position: 15 })).toBe(true);
    expect(saveIsDue({ now: 10_000, lastSavedAt: 0, lastSavedPosition: 1, position: 9 })).toBe(false);
    expect(saveIsDue({ now: 20_000, lastSavedAt: 0, lastSavedPosition: 15, position: 15 })).toBe(false);
  });

  it("formats clock times and validates speeds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3723)).toBe("1:02:03");
    expect(isPlaybackRate(1.5)).toBe(true);
    expect(isPlaybackRate(3)).toBe(false);
  });
});
