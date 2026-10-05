"use client";
import { useEffect, useRef } from "react";

/**
 * Submits the surrounding GET filter form when a select changes (progressive
 * enhancement: the form still has a visible Apply button without scripts).
 */
export function AutoSubmit() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const onChange = (e: Event) => {
      if (e.target instanceof HTMLSelectElement) form.requestSubmit();
    };
    form.addEventListener("change", onChange);
    form.querySelectorAll<HTMLElement>("[data-apply]").forEach((el) => el.classList.add("sr-only"));
    return () => form.removeEventListener("change", onChange);
  }, []);
  return <span ref={ref} hidden />;
}
