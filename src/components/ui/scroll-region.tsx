"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Horizontal scroll container for wide content. While it actually scrolls it becomes a
 * labelled, focusable region so keyboard users can scroll it too (tables of plain text have
 * nothing else to focus).
 */
export function ScrollRegion({ labelledBy, className, children }: { labelledBy: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} {...(scrolls ? { tabIndex: 0, role: "region", "aria-labelledby": labelledBy } : {})}>
      {children}
    </div>
  );
}
