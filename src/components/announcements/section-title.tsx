import type { ReactNode } from "react";

/** Section heading inside a course tab or cohort page (the layout or page owns the h1). */
export function SectionTitle({
  id,
  children,
  actions,
  level = 2,
  description,
}: {
  id?: string;
  children: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  description?: ReactNode;
}) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <H id={id} className={`min-w-0 break-words font-semibold ${level === 2 ? "text-xl" : "text-lg"}`}>{children}</H>
        {description ? <div className="mt-1 text-sm text-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
