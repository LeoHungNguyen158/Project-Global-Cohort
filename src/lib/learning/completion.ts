import type { CompletionRule } from "./outline";

// Completion rules. The database (public.mark_lesson_progress) is authoritative; these
// mirror it so the interface can explain the rule and enable the control at the same
// moment the server would accept it.
//
// Playback rule ("video_watched"): a lesson counts as PLAYED once the furthest position
// the learner reached in the uploaded video is at least 90% of its duration. Skipping
// ahead in the player also moves the furthest position. This records playback only; it
// is not evidence that anything was learned.

export const PLAYBACK_COMPLETE_RATIO = 0.9;

/** Periodic position saves while a video plays. */
export const PROGRESS_SAVE_INTERVAL_MS = 15_000;

/** Seconds of the video that must be reached (ceil, so the client never enables early). */
export function playbackThresholdSeconds(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return Infinity;
  return Math.ceil(durationSeconds * PLAYBACK_COMPLETE_RATIO);
}

/** Same comparison as the database: max_position >= duration * 0.9 (integer seconds). */
export function playbackRuleMet(maxPositionSeconds: number | null | undefined, durationSeconds: number | null | undefined): boolean {
  if (!durationSeconds || durationSeconds <= 0 || maxPositionSeconds === null || maxPositionSeconds === undefined) return false;
  return maxPositionSeconds >= durationSeconds * PLAYBACK_COMPLETE_RATIO;
}

/** Furthest point reached as a whole percentage of the video (0–100). */
export function playedPercent(maxPositionSeconds: number | null | undefined, durationSeconds: number | null | undefined): number {
  if (!durationSeconds || durationSeconds <= 0 || !maxPositionSeconds || maxPositionSeconds <= 0) return 0;
  return Math.min(100, Math.floor((maxPositionSeconds / durationSeconds) * 100));
}

/** Integer seconds the browser reports for a position (never negative, never past the end). */
export function toWholeSeconds(seconds: number, durationSeconds?: number | null): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const whole = Math.floor(seconds);
  return durationSeconds && durationSeconds > 0 ? Math.min(whole, Math.round(durationSeconds)) : whole;
}

/** Whole-second duration recorded with progress. */
export function toWholeDuration(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.max(1, Math.round(seconds));
}

export type CompletionMode = "acknowledge" | "played" | "unavailable";

/**
 * Which completion control a lesson gets. The playback rule needs an uploaded video that
 * reports its position; without one the rule cannot be met, so the control is shown as
 * unavailable (with a reason) instead of a button that can never succeed.
 */
export function completionMode(rule: CompletionRule, hasUploadedVideo: boolean): CompletionMode {
  if (rule === "video_watched") return hasUploadedVideo ? "played" : "unavailable";
  return "acknowledge";
}

/** Where playback resumes: the saved position unless it is (almost) at the end. */
export function resumePosition(savedSeconds: number | null | undefined, durationSeconds: number | null | undefined): number {
  if (!savedSeconds || savedSeconds <= 0) return 0;
  if (durationSeconds && durationSeconds > 0 && savedSeconds >= durationSeconds - 2) return 0;
  return savedSeconds;
}

/** "1:05", "12:00", "1:02:03". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Decides whether a periodic save is due (time elapsed and the position moved). */
export function saveIsDue(opts: { now: number; lastSavedAt: number; lastSavedPosition: number; position: number; intervalMs?: number }): boolean {
  const interval = opts.intervalMs ?? PROGRESS_SAVE_INTERVAL_MS;
  return opts.now - opts.lastSavedAt >= interval && opts.position !== opts.lastSavedPosition;
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function isPlaybackRate(n: number): boolean {
  return (PLAYBACK_RATES as readonly number[]).includes(n);
}
