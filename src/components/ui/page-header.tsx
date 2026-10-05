import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/i18n/client/core";

export type Crumb = { label: string; href?: string };

export function PageHeader({ title, actions, crumbs, description }: { title: ReactNode; actions?: ReactNode; crumbs?: Crumb[]; description?: ReactNode }) {
  return (
    <header className="border-b border-line bg-panel px-4 py-5 sm:px-8">
      {crumbs && crumbs.length > 0 ? (
        <nav aria-label={t("common.breadcrumb")} className="mb-2 text-sm text-muted">
          <ol className="flex flex-wrap items-center gap-1">
            {crumbs.map((c, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 ? <span aria-hidden="true">/</span> : null}
                {c.href ? (
                  <Link href={c.href} className="underline-offset-2 hover:underline">{c.label}</Link>
                ) : (
                  <span aria-current="page">{c.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-[1.85rem] leading-tight text-ink [font-family:Georgia,'Times_New_Roman',serif]">{title}</h1>
          {description ? <div className="mt-1 text-muted">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function PageBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 py-6 sm:px-8 ${className}`}>{children}</div>;
}
