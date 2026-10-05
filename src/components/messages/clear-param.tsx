"use client";
import { useEffect } from "react";

/**
 * Removes one-time query parameters (such as `?saved=published`) from the address
 * after the page has shown their notice, so a reload or a shared link does not repeat
 * it. The hash (an announcement or post anchor) is kept.
 */
export function ClearParams({ names }: { names: string[] }) {
  const key = names.join(",");
  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;
    for (const name of key.split(",")) {
      if (url.searchParams.has(name)) {
        url.searchParams.delete(name);
        changed = true;
      }
    }
    if (changed) window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [key]);
  return null;
}
