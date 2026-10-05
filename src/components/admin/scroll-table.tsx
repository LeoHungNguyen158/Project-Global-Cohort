import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Admin table in a keyboard-focusable scroll region. Same look as the shared Table, but a
 * table that scrolls sideways on narrow screens can be scrolled with the keyboard even when
 * none of its cells holds a link or control (WCAG 2.1.1, axe "scrollable-region-focusable").
 */
export function Table({ caption, children, className, captionHidden }: { caption: string; children: ReactNode; className?: string; captionHidden?: boolean }) {
  return (
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={cn(
        "overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-panel",
        className,
      )}
    >
      <table className="w-full border-collapse text-left text-sm">
        <caption className={cn("px-4 py-3 text-left font-semibold", captionHidden && "sr-only")}>{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export { td, th } from "@/components/ui/table";
