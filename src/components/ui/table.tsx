import { useId, type ReactNode } from "react";
import { cn } from "./cn";
import { ScrollRegion } from "./scroll-region";

/**
 * Responsive table: scrolls horizontally on small screens instead of overflowing the page,
 * and is keyboard-scrollable while it does.
 */
export function Table({ caption, children, className, captionHidden }: { caption: string; children: ReactNode; className?: string; captionHidden?: boolean }) {
  const captionId = useId();
  return (
    <ScrollRegion labelledBy={captionId} className={cn("overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-panel", className)}>
      <table className="w-full border-collapse text-left text-sm">
        <caption id={captionId} className={cn("px-4 py-3 text-left font-semibold", captionHidden && "sr-only")}>{caption}</caption>
        {children}
      </table>
    </ScrollRegion>
  );
}

export const th = "border-b border-line bg-canvas px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted";
export const td = "border-b border-line px-4 py-3 align-top";
