import { t } from "@/i18n";
import { matchesSearch } from "@/components/public/text";
import { TOOL_CATEGORIES, scopeOfRow, scopeValue, type ToolCategory, type ToolScope } from "./validation";

// Pure rules for the Tools directory: who may manage which scope (mirrors the
// tools_write policy, for the UI only), filtering, ordering and grouping.

export type ToolRow = {
  id: string;
  offering_id: string | null;
  cohort_id: string | null;
  category: ToolCategory;
  title: string;
  description: string;
  body_html: string;
  url: string | null;
  published: boolean;
  position: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

/** Cohorts and course offerings the signed-in person can see (from RLS). */
export type ScopeDirectory = {
  cohorts: { id: string; name: string }[];
  offerings: { id: string; code: string; title: string; cohortId: string }[];
};

export type ManagerContext = {
  isPlatformAdmin: boolean;
  coordinatorCohorts: readonly string[];
  /** Offerings with a staff assignment (instructors and TAs both may communicate). */
  staffOfferings: readonly string[];
};

/**
 * Mirrors the tools_write policy: platform-wide entries need a platform admin, cohort
 * entries a coordinator of that cohort, and course entries any staff member of the
 * offering or a coordinator of its cohort. The database enforces the same rule.
 */
export function canManageScope(ctx: ManagerContext, scope: ToolScope, dir: ScopeDirectory): boolean {
  if (ctx.isPlatformAdmin) return true;
  if (scope.kind === "platform") return false;
  if (scope.kind === "cohort") return ctx.coordinatorCohorts.includes(scope.id);
  if (ctx.staffOfferings.includes(scope.id)) return true;
  const cohortId = dir.offerings.find((o) => o.id === scope.id)?.cohortId;
  return Boolean(cohortId && ctx.coordinatorCohorts.includes(cohortId));
}

/** Every scope this person may add resources to, in display order. */
export function manageableScopes(ctx: ManagerContext, dir: ScopeDirectory): ToolScope[] {
  const out: ToolScope[] = [];
  if (ctx.isPlatformAdmin) out.push({ kind: "platform" });
  for (const c of sortCohorts(dir.cohorts)) {
    const scope: ToolScope = { kind: "cohort", id: c.id };
    if (canManageScope(ctx, scope, dir)) out.push(scope);
  }
  for (const o of sortOfferings(dir.offerings)) {
    const scope: ToolScope = { kind: "offering", id: o.id };
    if (canManageScope(ctx, scope, dir)) out.push(scope);
  }
  return out;
}

/** Every scope this person can see resources for, for the filter control. */
export function visibleScopes(dir: ScopeDirectory): ToolScope[] {
  return [
    { kind: "platform" },
    ...sortCohorts(dir.cohorts).map((c): ToolScope => ({ kind: "cohort", id: c.id })),
    ...sortOfferings(dir.offerings).map((o): ToolScope => ({ kind: "offering", id: o.id })),
  ];
}

export function hasScope(scopes: readonly ToolScope[], scope: ToolScope): boolean {
  const v = scopeValue(scope);
  return scopes.some((s) => scopeValue(s) === v);
}

export function isKnownScope(scope: ToolScope, dir: ScopeDirectory): boolean {
  if (scope.kind === "platform") return true;
  if (scope.kind === "cohort") return dir.cohorts.some((c) => c.id === scope.id);
  return dir.offerings.some((o) => o.id === scope.id);
}

/** Short label used on entries and in the filter: "Cohort: …", "Course: CODE — Title". */
export function scopeLabel(scope: ToolScope, dir: ScopeDirectory): string {
  if (scope.kind === "platform") return t("tools.scope.platform");
  if (scope.kind === "cohort") {
    const c = dir.cohorts.find((x) => x.id === scope.id);
    return t("tools.scope.cohort", { name: c?.name ?? "—" });
  }
  const o = dir.offerings.find((x) => x.id === scope.id);
  return t("tools.scope.offering", { code: o?.code ?? "—", title: o?.title ?? "" });
}

/** Longer label for the authoring form, saying who will see the resource. */
export function scopeFormLabel(scope: ToolScope, dir: ScopeDirectory): string {
  if (scope.kind === "platform") return t("tools.form.scope.platform");
  if (scope.kind === "cohort") {
    const c = dir.cohorts.find((x) => x.id === scope.id);
    return t("tools.form.scope.cohort", { name: c?.name ?? "—" });
  }
  const o = dir.offerings.find((x) => x.id === scope.id);
  return t("tools.form.scope.offering", { code: o?.code ?? "—", title: o?.title ?? "" });
}

/**
 * Whether a resource belongs to the chosen scope. A cohort includes the resources of
 * the course offerings in it; platform-wide and course scopes match exactly.
 */
export function inScope(row: Pick<ToolRow, "offering_id" | "cohort_id">, scope: ToolScope | null, dir: ScopeDirectory): boolean {
  if (!scope) return true;
  const own = scopeOfRow(row);
  if (scope.kind === "platform") return own.kind === "platform";
  if (scope.kind === "offering") return own.kind === "offering" && own.id === scope.id;
  if (own.kind === "cohort") return own.id === scope.id;
  if (own.kind === "offering") return dir.offerings.find((o) => o.id === own.id)?.cohortId === scope.id;
  return false;
}

/** Visible text of stored rich text, for search only (never rendered). */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export type ToolFilter = { q: string; category: ToolCategory | "all"; scope: ToolScope | null };

export function filterTools<R extends ToolRow>(rows: readonly R[], filter: ToolFilter, dir: ScopeDirectory): R[] {
  return rows.filter(
    (r) =>
      (filter.category === "all" || r.category === filter.category) &&
      inScope(r, filter.scope, dir) &&
      matchesSearch(filter.q, [r.title, r.description, plainText(r.body_html), scopeLabel(scopeOfRow(r), dir)]),
  );
}

const SCOPE_ORDER = { platform: 0, cohort: 1, offering: 2 } as const;

/** Lower position first, then platform-wide before cohort before course, then title. */
export function sortTools<R extends ToolRow>(rows: readonly R[]): R[] {
  return [...rows].sort(
    (a, b) =>
      a.position - b.position ||
      SCOPE_ORDER[scopeOfRow(a).kind] - SCOPE_ORDER[scopeOfRow(b).kind] ||
      a.title.localeCompare(b.title, "en", { sensitivity: "base" }) ||
      a.id.localeCompare(b.id),
  );
}

/** Groups resources by category in the fixed directory order, skipping empty groups. */
export function groupByCategory<R extends ToolRow>(rows: readonly R[]): { category: ToolCategory; rows: R[] }[] {
  return TOOL_CATEGORIES.map((category) => ({ category, rows: sortTools(rows.filter((r) => r.category === category)) })).filter(
    (g) => g.rows.length > 0,
  );
}

function sortCohorts<C extends { name: string }>(cohorts: readonly C[]): C[] {
  return [...cohorts].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

function sortOfferings<O extends { code: string }>(offerings: readonly O[]): O[] {
  return [...offerings].sort((a, b) => a.code.localeCompare(b.code, "en", { sensitivity: "base" }));
}
