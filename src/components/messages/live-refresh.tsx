"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LIST_POLL_MS, pollDelay } from "@/lib/comms/messages";
import { scopeSignature } from "@/lib/comms/scope";
import { t } from "@/i18n";

type PollBody = { unread: number; scopes?: { type: string; id: string; unread: number; threads: number }[] };

/**
 * Keeps a server-rendered message list current: polls the unread counts while the
 * tab is visible and re-renders the page when they change. Paused while hidden.
 */
export function LiveRefresh({ signature }: { signature: string }) {
  const router = useRouter();
  const [announcement, setAnnouncement] = useState("");
  const current = useRef(signature);
  const failures = useRef(0);

  useEffect(() => {
    current.current = signature;
  }, [signature]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let inFlight: AbortController | null = null;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") timer = setTimeout(poll, ms);
    };

    async function poll() {
      if (stopped || document.visibilityState !== "visible") return;
      inFlight?.abort();
      inFlight = new AbortController();
      try {
        const res = await fetch("/api/messages/poll?scopes=1", { cache: "no-store", credentials: "same-origin", signal: inFlight.signal });
        if (res.status === 401) {
          stopped = true;
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as PollBody;
        failures.current = 0;
        const next = scopeSignature(body.unread, body.scopes ?? []);
        if (next !== current.current) {
          current.current = next;
          setAnnouncement(t("msg.liveChanged"));
          router.refresh();
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        failures.current += 1;
      }
      schedule(pollDelay(failures.current, LIST_POLL_MS));
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
      else clearTimeout(timer);
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule(LIST_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      inFlight?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  return (
    <p className="sr-only" aria-live="polite">
      {announcement}
    </p>
  );
}
