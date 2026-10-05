"use client";
import { useEffect } from "react";
import { Alert } from "@/components/ui/alert";

/**
 * Announces the outcome of an action that redirected back to this page with ?notice=.
 * The live region stays mounted so the message is read out when it appears. The
 * parameter is then dropped from the address (without reloading), so refreshing or
 * sharing the link does not repeat the message; the next update of the page clears it.
 */
export function ActionNotice({ message }: { message: string | null }) {
  useEffect(() => {
    if (!message) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("notice")) return;
    url.searchParams.delete("notice");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [message]);

  return (
    <div aria-live="polite" className="empty:hidden">
      {message ? <Alert tone="success">{message}</Alert> : null}
    </div>
  );
}
