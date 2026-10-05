import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { getCurrentUser, isAdminish } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { AutoSubmit } from "@/components/ui/auto-submit";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { getSiteSettings } from "@/components/public/site-settings";
import { tx } from "@/components/public/rich-t";
import { RequestControl } from "@/components/catalog/request-control";
import {
  catalogFacets,
  entryState,
  filterCatalog,
  isAvailability,
  type Availability,
  type CatalogRow,
  type EntryState,
} from "@/components/catalog/catalog";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("catalog.title") };

type SP = { q?: string; cohort?: string; term?: string; availability?: string; page?: string };
type RequestRow = { id: string; offering_id: string; status: string; created_at: string; reviewed_at: string | null };

const PER_PAGE = 20;
const selectClass = "block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-ink";

// Public page: approved catalog metadata only (catalog_list). Signed-out visitors see
// it only when the public catalog setting is on; the database enforces the same rule.
export default async function CatalogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  const supabase = await createClient();

  const header = (
    <PageHeader
      title={t("catalog.title")}
      crumbs={user ? [{ label: t("nav.courses"), href: "/courses" }, { label: t("catalog.title") }] : undefined}
      description={t("catalog.description")}
    />
  );

  if (!user) {
    const settings = await getSiteSettings();
    if (!settings) return <LoadError header={header} />;
    if (!settings.publicCatalog) {
      return (
        <>
          {header}
          <PageBody>
            <EmptyState title={t("catalog.signInTitle")} action={<ButtonLink href="/login?next=%2Fcatalog">{t("catalog.signIn")}</ButtonLink>}>
              {t("catalog.signInBody")}
            </EmptyState>
          </PageBody>
        </>
      );
    }
  }

  const [catalogRes, requestsRes] = await Promise.all([
    supabase.rpc("catalog_list"),
    user
      ? supabase.from("access_requests").select("id, offering_id, status, created_at, reviewed_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as RequestRow[], error: null }),
  ]);
  if (catalogRes.error) return <LoadError header={header} />;
  const rows = (catalogRes.data ?? []) as CatalogRow[];

  const pendingByOffering = new Map<string, RequestRow>();
  const latestByOffering = new Map<string, RequestRow>();
  for (const r of (requestsRes.data ?? []) as RequestRow[]) {
    if (r.status === "pending" && !pendingByOffering.has(r.offering_id)) pendingByOffering.set(r.offering_id, r);
    // Only the most recent decision matters: an older decline is not shown after a newer request.
    if (!latestByOffering.has(r.offering_id)) latestByOffering.set(r.offering_id, r);
  }

  const enrollmentStatus = new Map((user?.enrollments ?? []).map((e) => [e.offering_id, e.status]));
  const stateOf = (row: CatalogRow): EntryState => entryState(row, enrollmentStatus.get(row.offering_id));

  const q = (sp.q ?? "").trim().slice(0, 100);
  const cohort = (sp.cohort ?? "").slice(0, 200);
  const term = (sp.term ?? "").slice(0, 100);
  const availability: Availability = isAvailability(sp.availability) ? sp.availability : "all";
  const filtered = filterCatalog(rows, { q, cohort, term, availability }, stateOf);
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pages);
  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const facets = catalogFacets(rows);

  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged: SP = { q, cohort, term, availability: availability === "all" ? "" : availability, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const s = p.toString();
    return s ? `/catalog?${s}` : "/catalog";
  };

  const showRoa = Boolean(user && user.enrollments.length === 0 && user.staff.length === 0 && !isAdminish(user));
  const availabilityOptions: Availability[] = user ? ["all", "open", "pending", "mine", "not_open"] : ["all", "open", "not_open"];

  return (
    <>
      {header}
      <PageBody>
        {showRoa ? (
          <Alert tone="info" title={t("catalog.roa.title")} className="mb-4">
            <p>{tx("catalog.roa.body", { invitations: <Link className="text-primary underline" href="/invite/accept">{t("catalog.roa.invitationsLink")}</Link> })}</p>
          </Alert>
        ) : null}

        <form method="get" action="/catalog" role="search" className="mb-4 flex flex-wrap items-end gap-3">
          <div className="relative min-w-0 basis-full sm:basis-auto sm:flex-[2_1_16rem]">
            <label htmlFor="catalog-q" className="sr-only">{t("catalog.search")}</label>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              id="catalog-q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder={t("catalog.searchPlaceholder")}
              className="block min-h-10 w-full rounded-md border border-line bg-white py-2 pl-9 pr-3"
            />
          </div>
          <div className="min-w-[10rem] flex-[1_1_10rem]">
            <label htmlFor="catalog-cohort" className="block text-xs text-muted">{t("catalog.cohort")}</label>
            <select id="catalog-cohort" name="cohort" defaultValue={cohort} className={selectClass}>
              <option value="">{t("catalog.allCohorts")}</option>
              {facets.cohorts.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[8rem] flex-[1_1_8rem]">
            <label htmlFor="catalog-term" className="block text-xs text-muted">{t("catalog.term")}</label>
            <select id="catalog-term" name="term" defaultValue={term} className={selectClass}>
              <option value="">{t("catalog.allTerms")}</option>
              {facets.terms.map((tl) => (
                <option key={tl} value={tl}>{tl}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[10rem] flex-[1_1_10rem]">
            <label htmlFor="catalog-availability" className="block text-xs text-muted">{t("catalog.availability")}</label>
            <select id="catalog-availability" name="availability" defaultValue={availability} className={selectClass}>
              {availabilityOptions.map((a) => (
                <option key={a} value={a}>{t(`catalog.availability.${a}`)}</option>
              ))}
            </select>
          </div>
          <button type="submit" data-apply className={buttonClass("secondary")}>{t("catalog.apply")}</button>
          <AutoSubmit />
        </form>

        <p className="mb-4 text-sm" aria-live="polite">
          {filtered.length === 1 ? t("catalog.countOne") : t("catalog.countMany", { count: filtered.length })}
          {" · "}
          {user ? t("catalog.datesIn", { tz: user.timezone }) : t("catalog.datesCourseTime")}
        </p>

        {rows.length === 0 ? (
          <EmptyState title={t("catalog.empty")} />
        ) : filtered.length === 0 ? (
          <EmptyState title={t("catalog.noMatches")} action={<Link className={buttonClass("secondary")} href="/catalog">{t("catalog.clear")}</Link>} />
        ) : (
          <ul className="space-y-3" aria-label={t("catalog.listLabel")}>
            {pageRows.map((row) => {
              const state = stateOf(row);
              const pending = pendingByOffering.get(row.offering_id) ?? null;
              const last = latestByOffering.get(row.offering_id);
              return (
                <CatalogEntry
                  key={row.offering_id}
                  row={row}
                  state={state}
                  tz={user?.timezone ?? row.timezone}
                  showCourseTz={!user || user.timezone !== row.timezone}
                  requestId={pending?.id ?? null}
                  pendingNote={t("catalog.pendingHelp", { date: pending ? formatDate(pending.created_at, user?.timezone ?? row.timezone) : "" })}
                  declinedNote={
                    last && last.status === "declined"
                      ? t("catalog.declinedBefore", { date: formatDate(last.reviewed_at ?? last.created_at, user?.timezone ?? row.timezone) })
                      : null
                  }
                />
              );
            })}
          </ul>
        )}
        <Pagination page={page} pages={pages} hrefFor={(p) => qs({ page: String(p) })} />
      </PageBody>
    </>
  );
}

function LoadError({ header }: { header: React.ReactNode }) {
  return (
    <>
      {header}
      <PageBody>
        <Alert tone="error" title={t("catalog.loadError")}>
          <Link className="text-primary underline" href="/catalog">{t("catalog.retry")}</Link>
        </Alert>
      </PageBody>
    </>
  );
}

function CatalogEntry({
  row,
  state,
  tz,
  showCourseTz,
  requestId,
  pendingNote,
  declinedNote,
}: {
  row: CatalogRow;
  state: EntryState;
  tz: string;
  showCourseTz: boolean;
  requestId: string | null;
  pendingNote: string;
  declinedNote: string | null;
}) {
  const headingId = `catalog-${row.offering_id}`;
  const dates = row.starts_at ? `${formatDate(row.starts_at, tz)} – ${row.ends_at ? formatDate(row.ends_at, tz) : t("catalog.datesTba")}` : t("catalog.datesTba");
  return (
    <li className="rounded-[var(--radius-panel)] border border-line bg-panel" data-testid="catalog-entry" data-offering-code={row.offering_code}>
      <article aria-labelledby={headingId} className="flex flex-col gap-4 p-4 sm:p-6 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">
            {row.course_code} · {row.offering_code}
          </p>
          <h2 id={headingId} className="text-lg font-semibold">{row.title}</h2>
          <dl className="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            <dt className="font-medium">{t("catalog.cohortLabel")}</dt>
            <dd className="break-words">{row.cohort_name}</dd>
            <dt className="font-medium">{t("catalog.termLabel")}</dt>
            <dd>{row.term_label || "—"}</dd>
            <dt className="font-medium">{t("catalog.datesLabel")}</dt>
            <dd>
              {dates}
              {row.starts_at && showCourseTz ? (
                <span className="text-muted"> {t("catalog.courseTimeZone", { tz: row.timezone })}</span>
              ) : null}
            </dd>
            {row.audience ? (
              <>
                <dt className="font-medium">{t("catalog.audienceLabel")}</dt>
                <dd className="break-words">{row.audience}</dd>
              </>
            ) : null}
            {row.expected_effort ? (
              <>
                <dt className="font-medium">{t("catalog.effortLabel")}</dt>
                <dd className="break-words">{row.expected_effort}</dd>
              </>
            ) : null}
          </dl>
          {row.summary ? <p className="mt-3 max-w-3xl break-words">{row.summary}</p> : null}
        </div>
        <div className="md:w-64 md:shrink-0">
          <EntryAction row={row} state={state} requestId={requestId} pendingNote={pendingNote} declinedNote={declinedNote} />
        </div>
      </article>
    </li>
  );
}

function EntryAction({
  row,
  state,
  requestId,
  pendingNote,
  declinedNote,
}: {
  row: CatalogRow;
  state: EntryState;
  requestId: string | null;
  pendingNote: string;
  declinedNote: string | null;
}) {
  switch (state) {
    case "enrolled":
    case "completed":
    case "staff":
      return (
        <div className="space-y-2">
          <Badge tone="success">{t(`catalog.state.${state}`)}</Badge>
          <div>
            <Link href={`/courses/${row.offering_id}`} className={buttonClass("secondary", "sm")} aria-label={t("catalog.openCourseFor", { title: row.title })}>
              {t("catalog.openCourse")}
            </Link>
          </div>
        </div>
      );
    case "requested":
    case "can_request":
      return (
        <RequestControl
          offeringId={row.offering_id}
          title={row.title}
          state={state}
          requestId={requestId}
          pendingNote={pendingNote}
          declinedNote={declinedNote}
        />
      );
    case "inactive":
      return (
        <div className="space-y-2">
          <Badge>{t("catalog.state.inactive")}</Badge>
          <p className="text-sm text-muted">{t("catalog.inactiveHelp")}</p>
        </div>
      );
    case "signed_out_open":
      return (
        <div className="space-y-2">
          <Badge tone="info">{t("catalog.state.can_request")}</Badge>
          <div>
            <Link href="/login?next=%2Fcatalog" className={buttonClass("primary", "sm")}>{t("catalog.signInToRequest")}</Link>
          </div>
        </div>
      );
    default:
      return (
        <div className="space-y-2">
          <Badge>{t("catalog.state.not_open")}</Badge>
          <p className="text-sm text-muted">{t("catalog.notOpenHelp")}</p>
        </div>
      );
  }
}
