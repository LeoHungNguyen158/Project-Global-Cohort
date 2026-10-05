import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";

/** Native <details> disclosure: keyboard and screen-reader friendly without scripts. */
export function Disclosure({ summary, children, className, summaryClassName }: { summary: ReactNode; children: ReactNode; className?: string; summaryClassName?: string }) {
  return (
    <details className={cn("group", className)}>
      <summary className={cn("inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-sm hover:underline [&::-webkit-details-marker]:hidden", summaryClassName)}>
        {summary}
        <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
