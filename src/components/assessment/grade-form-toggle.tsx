"use client";
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/components/ui/cn";

/**
 * Holds a question's grading form. Items that need manual grading show the form open; graded
 * items keep it behind a "Change grade" toggle. The form stays mounted in the same place when
 * an item becomes graded, so the confirmation of the save remains visible after the page refreshes.
 */
export function GradeFormToggle({ needsManual, label, hint, children }: { needsManual: boolean; label: string; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(needsManual);
  const id = useId();
  return (
    <div>
      {needsManual ? null : (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-10 items-center gap-1 rounded-sm text-sm font-medium text-primary hover:underline"
        >
          {label}
          <ChevronDown aria-hidden="true" className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      )}
      <div id={id} hidden={!open} className={needsManual ? undefined : "mt-2"}>
        {!needsManual && hint ? <p className="mb-3 text-xs text-muted">{hint}</p> : null}
        {children}
      </div>
    </div>
  );
}
