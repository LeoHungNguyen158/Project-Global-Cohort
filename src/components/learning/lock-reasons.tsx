import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { describeLockReason, type LockReason } from "@/lib/domain/prerequisites";
import { cn } from "@/components/ui/cn";

/** The precise unmet conditions of a locked lesson, each with a link to resolve it when possible. */
export function LockReasonList({
  reasons,
  offeringId,
  tz,
  courseTz,
  className,
}: {
  reasons: LockReason[];
  offeringId: string;
  tz: string;
  courseTz?: string;
  className?: string;
}) {
  if (reasons.length === 0) return null;
  return (
    <ul className={cn("space-y-1 text-sm", className)}>
      {reasons.map((r, i) => {
        const view = describeLockReason(r, { offeringId, tz, courseTz });
        return (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2">
            <span>{view.text}</span>
            {view.href && view.action ? (
              <Link href={view.href} className="inline-flex min-h-10 items-center gap-1 font-medium text-primary underline underline-offset-2">
                {view.action} <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
