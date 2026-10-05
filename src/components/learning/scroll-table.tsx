"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Table wrapper for this area: like the shared Table it scrolls sideways on small screens
 * instead of widening the page, and while it actually scrolls it is a labelled, focusable
 * region so keyboard users can scroll it too (tables of plain text have nothing else to
 * focus).
 */
export function ScrollTable({ caption, children, className, captionHidden }: { caption: string; children: ReactNode; className?: string; captionHidden?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const captionId = useId();
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
    <div
      ref={ref}
      className={cn("overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-panel", className)}
      {...(scrolls ? { tabIndex: 0, role: "region", "aria-labelledby": captionId } : {})}
    >
      <table className="w-full border-collapse text-left text-sm">
        <caption id={captionId} className={cn("px-4 py-3 text-left font-semibold", captionHidden && "sr-only")}>
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}
