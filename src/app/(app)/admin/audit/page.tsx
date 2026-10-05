import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/access";
import { pageWindow } from "@/lib/admin/data";
import { dayRangeToUtc, isDateOnly } from "@/lib/admin/validation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { PageBody } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Disclosure } from "@/components/ui/disclosure";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionTitle } from "@/components/admin/badges";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.audit.title") };

const PER_PAGE = 50;
type SP = { actor?: string; system?: string; action?: string; target?: string; from?: string; to?: string; page?: string };
type AuditEvent = {
  id: number;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_table: string;
  target_id: string | null;
  offering_id: string | null;
  offering_code: string | null;
  cohort_id: string | null;
  cohort_code: string | null;
  metadata: unknown;
  total_count: number;
};
type Facets = { actions: string[]; target_tables: string[] };

const inputClass = "block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-ink";

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireAdmin("/admin/audit");
  const tz = ctx.user.timezone;
  const supabase = await createClient();
  const { data: facetData, error: facetError } = await supabase.rpc("admin_audit_facets");
  if (facetError) throw new Error("Could not load the audit log");
  const facets = (facetData ?? { actions: [], target_tables: [] }) as Facets;

  const actor = (sp.actor ?? "").trim().slice(0, 100);
  const systemOnly = sp.system === "1";
  const action = facets.actions.includes(sp.action ?? "") ? (sp.action as string) : "";
  const target = facets.target_tables.includes(sp.target ?? "") ? (sp.target as string) : "";
  const from = isDateOnly(sp.from ?? "") ? (sp.from as string) : "";
  const to = isDateOnly(sp.to ?? "") ? (sp.to as string) : "";
  const range = dayRangeToUtc(from, to, tz);
  const badRange = Boolean(from && to && to < from);
  const { page, offset } = pageWindow(sp.page, PER_PAGE);

  const { data, error } = badRange
    ? { data: [], error: null }
    : await supabase.rpc("admin_audit_events", {
        p_actor: systemOnly ? "" : actor,
        p_system_only: systemOnly,
        p_action: action,
        p_target_table: target,
        p_from: range.from,
        p_to: range.to,
        p_limit: PER_PAGE,
        p_offset: offset,
      });
  if (error) throw new Error("Could not load the audit log");
  const events = (data ?? []) as AuditEvent[];
  const total = Number(events[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtered = Boolean(actor || systemOnly || action || target || from || to);

  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged: SP = { actor, system: systemOnly ? "1" : "", action, target, from, to, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const s = p.toString();
    return s ? `/admin/audit?${s}` : "/admin/audit";
  };

  return (
    <PageBody className="space-y-5">
      <SectionTitle title={t("admin.audit.title")} description={ctx.isPlatformAdmin ? t("admin.audit.descriptionPlatform") : t("admin.audit.descriptionCoordinator")} />
      <form method="get" action="/admin/audit" role="search" aria-label={t("admin.audit.filters")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 xl:items-end">
        <div className="xl:col-span-2">
          <label htmlFor="audit-actor" className="block text-xs text-muted">{t("admin.audit.actor")}</label>
          <input id="audit-actor" name="actor" type="search" defaultValue={actor} placeholder={ctx.isPlatformAdmin ? t("admin.audit.actorPlaceholder") : t("admin.audit.actorPlaceholderName")} className={inputClass} />
        </div>
        <div>
          <label htmlFor="audit-action" className="block text-xs text-muted">{t("admin.audit.action")}</label>
          <select id="audit-action" name="action" defaultValue={action} className={inputClass}>
            <option value="">{t("admin.audit.anyAction")}</option>
            {facets.actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-target" className="block text-xs text-muted">{t("admin.audit.target")}</label>
          <select id="audit-target" name="target" defaultValue={target} className={inputClass}>
            <option value="">{t("admin.audit.anyTarget")}</option>
            {facets.target_tables.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-from" className="block text-xs text-muted">{t("admin.audit.from")}</label>
          <input id="audit-from" name="from" type="date" defaultValue={from} className={inputClass} />
        </div>
        <div>
          <label htmlFor="audit-to" className="block text-xs text-muted">{t("admin.audit.to")}</label>
          <input id="audit-to" name="to" type="date" defaultValue={to} className={inputClass} />
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-2 lg:col-span-1 xl:col-span-2">
          <input type="checkbox" name="system" value="1" defaultChecked={systemOnly} className="h-4 w-4 rounded border-line" />
          {t("admin.audit.systemOnly")}
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-2 xl:col-span-4 xl:justify-end">
          <button type="submit" className={buttonClass("primary")}>{t("admin.common.apply")}</button>
          {filtered ? <Link href="/admin/audit" className={buttonClass("secondary")}>{t("admin.audit.clear")}</Link> : null}
        </div>
      </form>
      <p className="text-xs text-muted">{t("admin.audit.timesIn", { tz })}</p>
      {badRange ? <p className="text-sm text-danger" role="alert">{t("admin.audit.badRange")}</p> : null}
      <p className="text-sm" aria-live="polite">{total === 1 ? t("admin.audit.oneEvent") : t("admin.audit.events", { count: total })}</p>
      {events.length === 0 ? (
        <EmptyState title={filtered ? t("admin.audit.noMatch") : t("admin.audit.empty")} />
      ) : (
        <ol className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-panel" aria-label={t("admin.audit.listLabel")}>
          {events.map((e) => (
            <li key={e.id} className="space-y-1 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <time dateTime={e.created_at} className="text-sm tabular-nums text-muted">{formatDateTime(e.created_at, tz)}</time>
                <span className="font-medium">
                  {e.actor_id ? (
                    ctx.isPlatformAdmin ? (
                      <Link href={`/admin/users/${e.actor_id}`} className="text-primary underline-offset-2 hover:underline">{e.actor_name ?? t("admin.audit.deletedAccount")}</Link>
                    ) : (
                      (e.actor_name ?? t("admin.audit.deletedAccount"))
                    )
                  ) : (
                    <Badge>{t("admin.audit.system")}</Badge>
                  )}
                </span>
                <code className="rounded bg-canvas px-1.5 py-0.5 text-sm">{e.action}</code>
                <span className="text-sm text-muted">{t("admin.audit.on", { target: e.target_table })}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {e.cohort_code ? <span>{t("admin.audit.cohort", { code: e.cohort_code })}</span> : null}
                {e.offering_code ? <span>{t("admin.audit.offering", { code: e.offering_code })}</span> : null}
                {e.target_id ? <span className="[overflow-wrap:anywhere]">{t("admin.audit.targetId", { id: e.target_id })}</span> : null}
              </div>
              {e.metadata && typeof e.metadata === "object" && Object.keys(e.metadata as object).length > 0 ? (
                <Disclosure summary={t("admin.audit.details")} summaryClassName="text-primary">
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-canvas p-3 text-xs [overflow-wrap:anywhere]">{JSON.stringify(e.metadata, null, 2)}</pre>
                </Disclosure>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <Pagination page={Math.min(page, pages)} pages={pages} hrefFor={(p) => qs({ page: String(p) })} />
    </PageBody>
  );
}
