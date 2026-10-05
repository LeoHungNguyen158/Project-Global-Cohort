"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { saveLessonPosition } from "@/app/actions/learning";
import { usePlayback } from "./playback-context";
import {
  formatClock,
  isPlaybackRate,
  PLAYBACK_RATES,
  resumePosition,
  saveIsDue,
  toWholeDuration,
  toWholeSeconds,
} from "@/lib/learning/completion";
import { buttonClass } from "@/components/ui/button";
import { t } from "@/i18n/client/learning";

export type VideoSource = { id: string; mime: string };
export type CaptionTrack = { id: string; lang: string; label: string };

type Status =
  | { kind: "idle" }
  | { kind: "resumed"; at: number }
  | { kind: "saved"; at: number }
  | { kind: "saveFailed" }
  | { kind: "offline" }
  | { kind: "reloading"; at: number }
  | { kind: "failed" };

const RATE_KEY = "learn.playbackRate";
/** Automatic source reloads allowed within two minutes before asking the learner. */
const MAX_RECOVERIES = 3;

/**
 * Uploaded-video player. Files come from /api/assets, which checks access and redirects
 * to a signed storage link that expires after 5 minutes; when playback fails after that
 * (for example a late seek into unbuffered video), the player reloads the source — which
 * issues a fresh link after a new access check — and returns to the same position.
 * Learners' positions are saved every 15 seconds while playing and on pause, seek, end,
 * tab switch and leaving the page; playback resumes from the saved position.
 */
export function VideoPlayer({
  offeringId,
  lessonId,
  title,
  sources,
  tracks,
  initialPosition,
  initialDuration,
  record,
}: {
  offeringId: string;
  lessonId: string;
  title: string;
  sources: VideoSource[];
  tracks: CaptionTrack[];
  initialPosition: number;
  initialDuration: number | null;
  /** False for staff and draft previews: nothing is saved. */
  record: boolean;
}) {
  const rateId = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const playback = usePlayback();
  const report = playback?.report;
  const [rate, setRate] = useState(1);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  /** True once the player has the video's metadata and is tracking playback. */
  const [ready, setReady] = useState(false);
  const live = useRef({
    hadMetadata: false,
    resumeAt: (record ? resumePosition(initialPosition, initialDuration) : 0) || null,
    initialResume: true,
    resumePlaying: false,
    max: 0,
    lastSavedAt: 0,
    lastSavedPosition: -1,
    inflight: false,
    recoveries: [] as number[],
    failedSources: 0,
    seekTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  });

  const save = useCallback(
    async (force: boolean) => {
      const v = videoRef.current;
      const s = live.current;
      if (!record || !v || !s.hadMetadata) return;
      const duration = toWholeDuration(v.duration);
      const position = v.ended && duration ? duration : toWholeSeconds(v.currentTime, v.duration);
      if (force ? position === s.lastSavedPosition : !saveIsDue({ now: Date.now(), lastSavedAt: s.lastSavedAt, lastSavedPosition: s.lastSavedPosition, position })) return;
      if (s.inflight) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setStatus({ kind: "offline" });
        return;
      }
      s.inflight = true;
      try {
        const res = await saveLessonPosition({ offeringId, lessonId, position, duration });
        if (res.ok) {
          s.lastSavedAt = Date.now();
          s.lastSavedPosition = position;
          setStatus((prev) => (prev.kind === "resumed" ? prev : { kind: "saved", at: position }));
        } else {
          setStatus({ kind: "saveFailed" });
        }
      } catch {
        setStatus({ kind: "saveFailed" });
      } finally {
        s.inflight = false;
      }
    },
    [record, offeringId, lessonId],
  );

  useEffect(() => {
    const s = live.current;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void save(true);
    };
    const onOnline = () => void save(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      clearTimeout(s.seekTimer);
      void save(true);
    };
  }, [save]);

  function applyRate(next: number) {
    const v = videoRef.current;
    if (v) {
      v.defaultPlaybackRate = next;
      v.playbackRate = next;
    }
  }

  function onLoadedMetadata() {
    const v = videoRef.current;
    if (!v) return;
    const s = live.current;
    s.hadMetadata = true;
    s.failedSources = 0;
    setReady(true);
    const duration = toWholeDuration(v.duration);
    let preferred = rate;
    try {
      const stored = Number(window.localStorage.getItem(RATE_KEY));
      if (isPlaybackRate(stored)) preferred = stored;
    } catch {
      // Storage unavailable: keep the current speed.
    }
    applyRate(preferred);
    if (preferred !== rate) setRate(preferred);
    const at = s.resumeAt;
    if (at && at > 0 && (!duration || at < duration)) {
      v.currentTime = at;
      setStatus(s.initialResume ? { kind: "resumed", at } : { kind: "idle" });
    } else if (!s.initialResume) {
      setStatus({ kind: "idle" });
    }
    if (s.resumePlaying) void v.play().catch(() => undefined);
    s.resumeAt = null;
    s.resumePlaying = false;
    s.initialResume = false;
    report?.(s.max, duration);
  }

  // The metadata can arrive before the page is interactive, when nothing listens yet for
  // the event: catch up once on mount, or positions would never be tracked or saved.
  useEffect(() => {
    const v = videoRef.current;
    if (v && v.readyState >= HTMLMediaElement.HAVE_METADATA && !live.current.hadMetadata) onLoadedMetadata();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  function onTimeUpdate() {
    const v = videoRef.current;
    const s = live.current;
    if (!v || !s.hadMetadata) return;
    const pos = toWholeSeconds(v.currentTime, v.duration);
    if (pos > s.max) {
      s.max = pos;
      report?.(pos, toWholeDuration(v.duration));
    }
    if (!v.paused) void save(false);
  }

  function onSeeked() {
    const s = live.current;
    clearTimeout(s.seekTimer);
    s.seekTimer = setTimeout(() => void save(true), 800);
  }

  function onEnded() {
    const v = videoRef.current;
    const s = live.current;
    if (!v) return;
    const duration = toWholeDuration(v.duration);
    if (duration) {
      s.max = Math.max(s.max, duration);
      report?.(duration, duration);
    }
    void save(true);
  }

  /** Reload the sources (fresh signed links after a new access check) and return to the position. */
  function recover() {
    const v = videoRef.current;
    const s = live.current;
    if (!v) return;
    const now = Date.now();
    s.recoveries = s.recoveries.filter((at) => now - at < 120_000);
    if (s.recoveries.length >= MAX_RECOVERIES) {
      setStatus({ kind: "failed" });
      return;
    }
    s.recoveries.push(now);
    const at = Number.isFinite(v.currentTime) ? Math.floor(v.currentTime) : 0;
    s.resumeAt = at > 0 ? at : null;
    s.resumePlaying = !v.paused || v.seeking;
    s.hadMetadata = false;
    s.failedSources = 0;
    setReady(false);
    setStatus({ kind: "reloading", at });
    v.load();
  }

  function onVideoError() {
    // After metadata loaded, a failure is almost always an expired or interrupted link.
    if (live.current.hadMetadata) recover();
    else setStatus({ kind: "failed" });
  }

  function onSourceError() {
    // The browser moves on to the next <source>; only when all of them fail is it an error.
    const s = live.current;
    s.failedSources += 1;
    if (s.failedSources >= sources.length) setStatus({ kind: "failed" });
  }

  function retry() {
    const v = videoRef.current;
    const s = live.current;
    if (!v) return;
    s.recoveries = [];
    s.failedSources = 0;
    s.hadMetadata = false;
    setReady(false);
    if (s.max > 0 && s.resumeAt === null) s.resumeAt = Math.floor(v.currentTime) || null;
    setStatus({ kind: "idle" });
    v.load();
  }

  function startOver() {
    const v = videoRef.current;
    if (v) v.currentTime = 0;
    setStatus({ kind: "idle" });
  }

  return (
    <div className="space-y-2">
      <video
        ref={videoRef}
        controls
        preload="metadata"
        playsInline
        crossOrigin="anonymous"
        aria-label={t("learn.video.label", { title })}
        className="aspect-video w-full rounded-md bg-black"
        data-state={ready ? "ready" : "loading"}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onPause={() => void save(true)}
        onSeeked={onSeeked}
        onEnded={onEnded}
        onError={onVideoError}
      >
        {sources.map((s) => (
          <source key={s.id} src={`/api/assets/${s.id}`} type={s.mime} onError={onSourceError} />
        ))}
        {tracks.map((tr) => (
          <track key={tr.id} kind="captions" src={`/api/assets/${tr.id}`} srcLang={tr.lang} label={tr.label} />
        ))}
        {t("learn.video.unsupported")}
      </video>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor={rateId} className="text-sm font-medium">{t("learn.video.speed")}</label>
          <select
            id={rateId}
            value={rate}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!isPlaybackRate(next)) return;
              setRate(next);
              applyRate(next);
              try {
                window.localStorage.setItem(RATE_KEY, String(next));
              } catch {
                // Not persisted; the speed still applies now.
              }
            }}
            className="min-h-10 rounded-md border border-line bg-white px-2 py-1.5 text-sm"
          >
            {PLAYBACK_RATES.map((r) => (
              <option key={r} value={r}>{t("learn.video.speedValue", { rate: r })}</option>
            ))}
          </select>
        </div>
        <div className="min-w-0 text-sm">
          {!record ? <span className="text-muted">{t("learn.video.notRecording")}</span> : null}
          {status.kind === "resumed" ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>{t("learn.video.resumed", { time: formatClock(status.at) })}</span>
              <button type="button" onClick={startOver} className={buttonClass("ghost", "sm")}>
                <RotateCcw aria-hidden="true" className="h-4 w-4" /> {t("learn.video.startOver")}
              </button>
            </span>
          ) : null}
          {status.kind === "saved" ? <span className="text-muted">{t("learn.video.saved", { time: formatClock(status.at) })}</span> : null}
        </div>
      </div>

      <div aria-live="polite" className="text-sm empty:hidden">
        {status.kind === "saveFailed" ? <p className="text-warning">{t("learn.video.saveFailed")}</p> : null}
        {status.kind === "offline" ? <p className="text-warning">{t("learn.video.offline")}</p> : null}
        {status.kind === "reloading" ? <p>{t("learn.video.reloading", { time: formatClock(status.at) })}</p> : null}
        {status.kind === "failed" ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#fecaca] bg-danger-soft px-3 py-2">
            <AlertCircle aria-hidden="true" className="h-4 w-4 text-danger" />
            <span>{t("learn.video.failed")} {t("learn.video.downloadInstead")}</span>
            <button type="button" onClick={retry} className={buttonClass("secondary", "sm")}>
              <RotateCcw aria-hidden="true" className="h-4 w-4" /> {t("learn.video.retry")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
