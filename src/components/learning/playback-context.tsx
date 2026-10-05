"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type Playback = {
  /** Furthest whole second reached in the player (as the server records it). */
  max: number;
  duration: number | null;
  report: (max: number, duration: number | null) => void;
};

const PlaybackContext = createContext<Playback | null>(null);

/** Shares the video's furthest position with the completion control on the same lesson. */
export function PlaybackProvider({ initialMax, initialDuration, children }: { initialMax: number; initialDuration: number | null; children: ReactNode }) {
  const [state, setState] = useState({ max: Math.max(0, initialMax), duration: initialDuration });
  const report = useCallback((max: number, duration: number | null) => {
    setState((s) => {
      const nextMax = Math.max(s.max, max);
      const nextDuration = duration ?? s.duration;
      return nextMax === s.max && nextDuration === s.duration ? s : { max: nextMax, duration: nextDuration };
    });
  }, []);
  const value = useMemo(() => ({ ...state, report }), [state, report]);
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback(): Playback | null {
  return useContext(PlaybackContext);
}
