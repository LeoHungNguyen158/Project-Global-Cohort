import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { t } from "@/i18n";

export type ManageSection = "versions" | "rules" | null;

/** Heading, sub-navigation and breadcrumbs for the authoring pages (the layout owns the h1). */
export function ManageHeader({
  offeringId,
  current,
  crumbs = [],
  intro = true,
}: {
  offeringId: string;
  current: ManageSection;
  crumbs?: { label: string; href?: string }[];
  intro?: boolean;
}) {
  const base = `/courses/${offeringId}/content/manage`;
  const tabs = [
    { key: "versions", href: base, label: t("author.nav.overview") },
    { key: "rules", href: `${base}/rules`, label: t("author.nav.rules") },
  ] as const;
  return (
    <div className="space-y-3">
      <Link href={`/courses/${offeringId}/content`} className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary underline underline-offset-2">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" /> {t("author.backToContent")}
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">{t("author.title")}</h2>
        <Badge tone="info">{t("author.badge")}</Badge>
      </div>
      {intro ? <p className="max-w-3xl text-sm text-muted">{t("author.intro")}</p> : null}
      <nav aria-label={t("author.nav")} className="overflow-x-auto border-b border-line">
        <ul className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={current === tab.key ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium",
                  current === tab.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {crumbs.length > 0 ? (
        <nav aria-label={t("author.breadcrumb")} className="text-sm text-muted">
          <ol className="flex flex-wrap items-center gap-1">
            {crumbs.map((c, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 ? <span aria-hidden="true">/</span> : null}
                {c.href ? (
                  <Link href={c.href} className="inline-flex min-h-10 items-center underline-offset-2 hover:underline">{c.label}</Link>
                ) : (
                  <span aria-current="page">{c.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
    </div>
  );
}

export function VersionStatusBadge({ status }: { status: "draft" | "published" | "archived" }) {
  if (status === "draft") return <Badge tone="warning">{t("author.status.draft")}</Badge>;
  if (status === "published") return <Badge tone="success">{t("author.status.published")}</Badge>;
  return <Badge>{t("author.status.archived")}</Badge>;
}
