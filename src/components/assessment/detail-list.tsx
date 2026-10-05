import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** Label/value pairs that stack on phones and form two columns on wider screens. */
export function DetailList({ items, className }: { items: { label: ReactNode; value: ReactNode; key?: string }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map((it, i) => (
        <div key={it.key ?? i} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{it.label}</dt>
          <dd className="mt-0.5 break-words">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Section heading inside a course tab (the course layout owns the page h1). */
export function SectionHeading({ id, children, actions, level = 2 }: { id?: string; children: ReactNode; actions?: ReactNode; level?: 2 | 3 }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <H id={id} className={cn("min-w-0 break-words", level === 2 ? "text-xl font-semibold" : "text-lg font-semibold")}>{children}</H>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
