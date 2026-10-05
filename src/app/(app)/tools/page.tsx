import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/forms";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { AutoSubmit } from "@/components/ui/auto-submit";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { TOOL_COLUMNS, loadScopeDirectory, managerContext } from "@/components/tools/data";
import { ToolEntry } from "@/components/tools/tool-entry";
import {
  canManageScope,
  filterTools,
  groupByCategory,
  hasScope,
  isKnownScope,
  manageableScopes,
  scopeLabel,
  sortTools,
  visibleScopes,
  type ToolRow,
} from "@/components/tools/scopes";
import { TOOL_CATEGORIES, isToolCategory, parseToolScope, scopeOfRow, scopeValue, type ToolCategory, type ToolScope } from "@/components/tools/validation";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("tools.title") };

type SP = { q?: string; scope?: string; cohort?: string; offering?: string; category?: string; notice?: string; tool?: string };

const selectClass = "block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-ink";
const NOTICES = { saved: "tools.saved", archived: "tools.archived", restored: "tools.restored" } as const;

/** The scope asked for in the URL: ?scope=… from the filter form, or ?cohort= / ?offering= links. */
function requestedScope(sp: SP): { scope: ToolScope | null; invalid: boolean } {
  if (sp.scope && sp.scope !== "all") {
    const scope = parseToolScope(sp.scope);
    return { scope, invalid: !scope };
  }
  if (sp.cohort) return isUuid(sp.cohort) ? { scope: { kind: "cohort", id: sp.cohort.toLowerCase() }, invalid: false } : { scope: null, invalid: true };
  if (sp.offering) return isUuid(sp.offering) ? { scope: { kind: "offering", id: sp.offering.toLowerCase() }, invalid: false } : { scope: null, invalid: true };
  return { scope: null, invalid: false };
}

export default async function ToolsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser("/tools");
  const supabase = await createClient();
  // RLS returns only what this person may see: published entries in their scopes,
  // plus drafts and archived entries in scopes they manage.
  const [toolsRes, dir] = await Promise.all([
    supabase.from("tool_resources").select(TOOL_COLUMNS).order("position").limit(1000),
    loadScopeDirectory(),
  ]);

  const header = (actions?: ReactNode) => <PageHeader title={t("tools.title")} description={t("tools.description")} actions={actions} />;
  if (toolsRes.error || !dir) {
    return (
      <>
        {header()}
        <PageBody>
          <Alert tone="error" title={t("tools.loadError")}>
            <Link className="text-primary underline" href="/tools">{t("tools.retry")}</Link>
          </Alert>
        </PageBody>
      </>
    );
  }

  const rows = (toolsRes.data ?? []) as ToolRow[];
  const ctx = managerContext(user);
  const manageable = manageableScopes(ctx, dir);

  const requested = requestedScope(sp);
  const scope = requested.scope && isKnownScope(requested.scope, dir) ? requested.scope : null;
  const unknownScope = requested.invalid || (requested.scope !== null && scope === null);
  const category: ToolCategory | "all" = isToolCategory(sp.category) ? sp.category : "all";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const filtering = Boolean(q) || category !== "all" || scope !== null;

  const active = rows.filter((r) => !r.archived_at);
  const archived = sortTools(rows.filter((r) => r.archived_at));
  const filter = { q, category, scope };
  const shown = filterTools(active, filter, dir);
  const shownArchived = filterTools(archived, filter, dir);
  const groups = groupByCategory(shown);

  const listQuery = new URLSearchParams();
  if (q) listQuery.set("q", q);
  if (scope) listQuery.set("scope", scopeValue(scope));
  if (category !== "all") listQuery.set("category", category);
  const returnTo = listQuery.toString() ? `/tools?${listQuery.toString()}` : "/tools";

  const addHref = scope && hasScope(manageable, scope) ? `/tools/new?scope=${encodeURIComponent(scopeValue(scope))}` : "/tools/new";
  const notice = sp.notice && sp.notice in NOTICES ? NOTICES[sp.notice as keyof typeof NOTICES] : null;
  const highlighted = isUuid(sp.tool) ? sp.tool.toLowerCase() : null;
  const label = (r: ToolRow) => scopeLabel(scopeOfRow(r), dir);
  const cohortName = scope?.kind === "cohort" ? dir.cohorts.find((c) => c.id === scope.id)?.name ?? "" : "";

  const entry = (r: ToolRow) => (
    <ToolEntry
      key={r.id}
      row={r}
      scope={label(r)}
      canManage={canManageScope(ctx, scopeOfRow(r), dir)}
      timezone={user.timezone}
      returnTo={returnTo}
      highlighted={highlighted === r.id}
    />
  );

  return (
    <>
      {header(manageable.length > 0 ? <ButtonLink href={addHref}>{t("tools.add")}</ButtonLink> : undefined)}
      <PageBody className="max-w-5xl space-y-5">
        {notice ? (
          <Alert tone="success" live>
            {t(notice)}
          </Alert>
        ) : null}
        {unknownScope ? <Alert tone="warning">{t("tools.unknownScope")}</Alert> : null}

        <form method="get" action="/tools" role="search" className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-0 basis-full sm:basis-auto sm:flex-[2_1_16rem]">
            <label htmlFor="tools-q" className="sr-only">{t("tools.search")}</label>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              id="tools-q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder={t("tools.searchPlaceholder")}
              className="block min-h-10 w-full rounded-md border border-line bg-white py-2 pl-9 pr-3"
            />
          </div>
          <div className="min-w-0 flex-[1_1_14rem]">
            <label htmlFor="tools-scope" className="block text-xs text-muted">{t("tools.scope")}</label>
            <select id="tools-scope" name="scope" defaultValue={scope ? scopeValue(scope) : "all"} className={selectClass}>
              <option value="all">{t("tools.scope.all")}</option>
              {visibleScopes(dir).map((s) => (
                <option key={scopeValue(s)} value={scopeValue(s)}>
                  {scopeLabel(s, dir)}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0 flex-[1_1_12rem]">
            <label htmlFor="tools-category" className="block text-xs text-muted">{t("tools.category")}</label>
            <select id="tools-category" name="category" defaultValue={category} className={selectClass}>
              <option value="all">{t("tools.category.all")}</option>
              {TOOL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`tools.category.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" data-apply className={buttonClass("secondary")}>{t("tools.apply")}</button>
          <AutoSubmit />
        </form>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-live="polite">
          <span>{shown.length === 1 ? t("tools.countOne") : t("tools.countMany", { count: shown.length })}</span>
          {scope ? (
            <span className="text-muted">
              {scope.kind === "cohort" ? t("tools.showingCohort", { name: cohortName }) : t("tools.showingScope", { scope: scopeLabel(scope, dir) })}{" "}
              <Link className="text-primary underline" href="/tools">{t("tools.showAll")}</Link>
            </span>
          ) : null}
        </div>

        {active.length === 0 && !filtering ? (
          <EmptyState
            title={manageable.length > 0 ? t("tools.emptyManager") : t("tools.empty")}
            action={manageable.length > 0 ? <ButtonLink href={addHref}>{t("tools.add")}</ButtonLink> : undefined}
          />
        ) : shown.length === 0 ? (
          <EmptyState
            title={scope && !q && category === "all" ? t("tools.emptyScope", { scope: scopeLabel(scope, dir) }) : t("tools.noMatches")}
            action={
              <Link className={buttonClass("secondary")} href="/tools">
                {scope && !q && category === "all" ? t("tools.showAll") : t("tools.clear")}
              </Link>
            }
          />
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.category} aria-labelledby={`tools-${g.category}`} data-testid="tool-category" data-category={g.category}>
                <h2 id={`tools-${g.category}`} className="text-lg font-semibold">{t(`tools.category.${g.category}`)}</h2>
                <p className="mb-3 text-sm text-muted">{t(`tools.categoryHelp.${g.category}`)}</p>
                <ul className="space-y-3">{g.rows.map(entry)}</ul>
              </section>
            ))}
          </div>
        )}

        {shownArchived.length > 0 ? (
          <section aria-labelledby="tools-archived" className="border-t border-line pt-5" data-testid="tool-archived">
            <h2 id="tools-archived" className="text-lg font-semibold">{t("tools.archivedSection", { count: shownArchived.length })}</h2>
            <p className="mb-3 text-sm text-muted">{t("tools.archivedHelp")}</p>
            <ul className="space-y-3">{shownArchived.map(entry)}</ul>
          </section>
        ) : null}
      </PageBody>
    </>
  );
}
