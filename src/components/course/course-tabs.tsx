"use client";
import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { cn } from "@/components/ui/cn";

export const COURSE_TABS = [
  { segment: null, path: "", label: "Overview" },
  { segment: "content", path: "/content", label: "Content" },
  { segment: "announcements", path: "/announcements", label: "Announcements" },
  { segment: "assignments", path: "/assignments", label: "Assignments" },
  { segment: "quizzes", path: "/quizzes", label: "Quizzes" },
  { segment: "discussions", path: "/discussions", label: "Discussions" },
  { segment: "grades", path: "/grades", label: "Grades" },
  { segment: "calendar", path: "/calendar", label: "Calendar" },
  { segment: "people", path: "/people", label: "People" },
] as const;

export function CourseTabs({ offeringId }: { offeringId: string }) {
  const segment = useSelectedLayoutSegment();
  return (
    <nav aria-label="Course sections" className="overflow-x-auto border-b border-line bg-panel px-2 sm:px-6">
      <ul className="flex min-w-max gap-1">
        {COURSE_TABS.map((tab) => {
          const active = tab.segment === segment;
          return (
            <li key={tab.label}>
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
