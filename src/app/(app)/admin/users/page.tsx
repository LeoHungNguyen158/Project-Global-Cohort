import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/admin/access";
import { pageWindow } from "@/lib/admin/data";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/time";
import { PageBody } from "@/components/ui/page-header";
import { Table, td, th } from "@/components/admin/scroll-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { AutoSubmit } from "@/components/ui/auto-submit";
import { buttonClass } from "@/components/ui/button";
import { AccountBadges, RoleBadges, SectionTitle } from "@/components/admin/badges";
import { t } from "@/i18n";
import { tRich } from "@/i18n/rich";

export const metadata: Metadata = { title: t("admin.users.title") };

const FILTERS = ["all", "active", "suspended", "unconfirmed", "admins", "coordinators"] as const;
type Filter = (typeof FILTERS)[number];
const PER_PAGE = 25;
const selectClass = "block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-ink";

type Row = {
  user_id: string;
  display_name: string;
  email: string;
  email_confirmed: boolean;
  suspended: boolean;
  roles: string[];
  created_at: string;
  last_sign_in_at: string | null;
  total_count: number;
};

type SP = { q?: string; filter?: string; sort?: string; page?: string };

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requirePlatformAdmin("/admin/users");
  const tz = ctx.user.timezone;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const filter: Filter = FILTERS.includes(sp.filter as Filter) ? (sp.filter as Filter) : "all";
  const sort = sp.sort === "newest" ? "newest" : "name";
  const { page, offset, limit } = pageWindow(sp.page, PER_PAGE);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_users_page", { p_search: q, p_filter: filter, p_sort: sort, p_limit: limit, p_offset: offset });
  if (error) throw new Error("Could not load accounts");
  const rows = (data ?? []) as Row[];
  const total = Number(rows[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged = { q, filter: filter === "all" ? "" : filter, sort: sort === "name" ? "" : sort, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const s = p.toString();
    return s ? `/admin/users?${s}` : "/admin/users";
  };

  return (
    <PageBody>
      <SectionTitle
        title={t("admin.users.title")}
        description={tRich("admin.users.description", {
          link: (
            <Link href="/admin/invitations" className="text-primary underline">
              {t("admin.users.invitationsLink")}
            </Link>
          ),
        })}
      />

      <form method="get" action="/admin/users" role="search" aria-label={t("admin.users.searchLabel")} className="mb-4 flex flex-wrap items-end gap-3">
        <div className="relative min-w-0 basis-full sm:basis-auto sm:flex-[2_1_16rem]">
          <label htmlFor="user-search" className="block text-xs text-muted">{t("admin.users.searchLabel")}</label>
          <Search aria-hidden="true" className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-muted" />
          <input
            id="user-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder={t("admin.users.searchPlaceholder")}
            className="block min-h-10 w-full rounded-md border border-line bg-white py-2 pl-9 pr-3"
          />
        </div>
        <div className="min-w-[10rem] flex-[1_1_10rem]">
          <label htmlFor="user-filter" className="block text-xs text-muted">{t("admin.users.filter")}</label>
          <select id="user-filter" name="filter" defaultValue={filter} className={selectClass}>
            {FILTERS.map((f) => (
              <option key={f} value={f}>{t(`admin.users.filter.${f}`)}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[10rem] flex-[1_1_10rem]">
          <label htmlFor="user-sort" className="block text-xs text-muted">{t("admin.users.sort")}</label>
          <select id="user-sort" name="sort" defaultValue={sort} className={selectClass}>
            <option value="name">{t("admin.users.sort.name")}</option>
            <option value="newest">{t("admin.users.sort.newest")}</option>
          </select>
        </div>
        <button type="submit" data-apply className={buttonClass("secondary")}>{t("admin.common.apply")}</button>
        <AutoSubmit />
      </form>

      <p className="mb-3 text-sm" aria-live="polite">
        {total === 1 ? t("admin.common.result") : t("admin.common.results", { count: total })}
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title={t("admin.users.empty")}
          action={q || filter !== "all" ? <Link className={buttonClass("secondary")} href="/admin/users">{t("admin.common.clear")}</Link> : null}
        />
      ) : (
        <Table caption={t("admin.users.caption")} captionHidden>
          <thead>
            <tr>
              <th scope="col" className={th}>{t("admin.common.name")}</th>
              <th scope="col" className={th}>{t("admin.common.email")}</th>
              <th scope="col" className={th}>{t("admin.users.account")}</th>
              <th scope="col" className={th}>{t("admin.users.roles")}</th>
              <th scope="col" className={th}>{t("admin.common.created")}</th>
              <th scope="col" className={th}>{t("admin.users.lastSignIn")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id}>
                <td className={td}>
                  <Link href={`/admin/users/${r.user_id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {r.display_name || r.email}
                  </Link>
                </td>
                <td className={`${td} [overflow-wrap:anywhere]`}>{r.email}</td>
                <td className={td}><AccountBadges suspended={r.suspended} confirmed={r.email_confirmed} /></td>
                <td className={td}><RoleBadges roles={r.roles} /></td>
                <td className={`${td} whitespace-nowrap`}>{formatDate(r.created_at, tz)}</td>
                <td className={`${td} whitespace-nowrap`}>{r.last_sign_in_at ? formatDateTime(r.last_sign_in_at, tz) : t("admin.common.never")}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="mt-2 text-xs text-muted">{t("admin.common.timesShownIn", { tz })}</p>
      <Pagination page={Math.min(page, pages)} pages={pages} hrefFor={(p) => qs({ page: String(p) })} />
    </PageBody>
  );
}
