import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { t } from "@/i18n";

/** "On this page" navigation for long help and policy pages. */
export function OnThisPage({ label, items }: { label: string; items: { id: string; label: string }[] }) {
  return (
    <nav aria-label={label} className="mb-6 rounded-[var(--radius-panel)] border border-line bg-panel px-4 py-3">
      <p className="mb-1 text-sm font-semibold">{label}</p>
      <ul className="grid gap-x-6 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} className="inline-flex min-h-10 items-center text-primary underline-offset-2 hover:underline">
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A titled section with an anchor; headings stay in order (h2 inside the page's h1). */
export function DocSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <h2 id={`${id}-title`} className="mb-2 text-xl font-semibold">{title}</h2>
      <div className="space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}

export function DocList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-6">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** Banner for policy pages whose text the program owner has not approved yet. */
export function DraftNotice() {
  return (
    <div className="mb-6 space-y-2">
      <Alert tone="warning" title={t("legal.draftTitle")}>
        <p>{t("legal.draftBody")}</p>
      </Alert>
      <p className="text-sm text-muted">{t("legal.updated", { date: t("legal.updatedDate") })}</p>
    </div>
  );
}
