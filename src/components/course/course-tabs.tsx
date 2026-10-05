"use client";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { cn } from "@/components/ui/cn";

export type CourseTab = { segment: string | null; path: string; label: string };

/** Course section tabs. Labels are translated on the server and passed in. */
export function CourseTabs({ offeringId, tabs, label }: { offeringId: string; tabs: CourseTab[]; label: string }) {
  const segment = useSelectedLayoutSegment();
  return (
    <nav aria-label={label} className="overflow-x-auto border-b border-line bg-panel px-2 sm:px-6">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = tab.segment === segment;
          return (
            <li key={tab.path}>
              <Link
                href={`/courses/${offeringId}${tab.path}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium",
                  active ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
