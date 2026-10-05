import type { Metadata } from "next";
import Link from "next/link";
import { LayoutGrid, LibraryBig, List, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listMyOfferings, listStaff, offeringPhase, offeringTitle } from "@/lib/data/offerings";
import { CourseCard, CourseRow, type CourseListEntry } from "@/components/course/course-list-item";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { AutoSubmit } from "@/components/ui/auto-submit";
import { buttonClass } from "@/components/ui/button";
import { setCoursesView } from "@/app/actions/courses";
import { cn } from "@/components/ui/cn";
import { t } from "@/i18n";

export const metadata: Metadata = { title: "Courses" };

type SP = { q?: string; term?: string; filter?: string; per?: string; page?: string };
const FILTERS = ["all", "favorites", "learning", "teaching", "administered"] as const;
type Filter = (typeof FILTERS)[number];
const PAGE_SIZES = [10, 25, 50];

const selectClass = "block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-ink";

export default async function CoursesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser("/courses");
  const supabase = await createClient();

  const [offerings, favoritesRes] = await Promise.all([listMyOfferings(), supabase.from("favorites").select("offering_id")]);
  const favorites = new Set((favoritesRes.data ?? []).map((f) => f.offering_id as string));
  const staffIds = new Set(user.staff.map((s) => s.offering_id));
  const enrollmentById = new Map(user.enrollments.map((e) => [e.offering_id, e.status]));
  const isAdminish = user.isPlatformAdmin || user.coordinatorCohorts.length > 0;

  const filter: Filter = FILTERS.includes(sp.filter as Filter) ? (sp.filter as Filter) : "all";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const term = (sp.term ?? "").slice(0, 100);
  const per = PAGE_SIZES.includes(Number(sp.per)) ? Number(sp.per) : 25;
  const view = user.coursesView;

  // "My courses" are offerings I teach or take. Administrators can also list every
  // offering they administer, which RLS already limits to their cohorts.
  const mine = offerings.filter((o) => staffIds.has(o.id) || enrollmentById.has(o.id));
  const base = filter === "administered" && isAdminish ? offerings : mine;
  const staffByOffering = await listStaff(base.map((o) => o.id));

  const needle = q.toLocaleLowerCase();
  const filtered = base.filter((o) => {
    if (term && o.term_label !== term) return false;
    if (filter === "favorites" && !favorites.has(o.id)) return false;
    if (filter === "learning" && !enrollmentById.has(o.id)) return false;
    if (filter === "teaching" && !staffIds.has(o.id)) return false;
    if (!needle) return true;
    const staffNames = (staffByOffering[o.id] ?? []).map((s) => s.profiles?.display_name ?? "").join(" ");
    return [offeringTitle(o), o.code, o.courses?.code, o.cohorts?.name, o.term_label, staffNames]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle);
  });

  // Order: ongoing, upcoming, then closed terms (newest first).
  const phaseRank = { ongoing: 0, upcoming: 1, archived: 2 } as const;
  filtered.sort((a, b) => {
    const pa = phaseRank[offeringPhase(a)];
    const pb = phaseRank[offeringPhase(b)];
    if (pa !== pb) return pa - pb;
    return (b.starts_at ?? "").localeCompare(a.starts_at ?? "") || offeringTitle(a).localeCompare(offeringTitle(b));
  });

  const pages = Math.max(1, Math.ceil(filtered.length / per));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pages);
  const pageItems = filtered.slice((page - 1) * per, page * per);

  // Learner progress for courses shown on this page that are open to the learner.
  const progress = new Map<string, number | null>();
  await Promise.all(
    pageItems
      .filter((o) => enrollmentById.has(o.id) && !staffIds.has(o.id) && offeringPhase(o) !== "upcoming")
      .map(async (o) => {
        const { data } = await supabase.rpc("course_progress", { p_offering: o.id });
        progress.set(o.id, typeof data?.percent === "number" ? data.percent : data?.percent != null ? Number(data.percent) : null);
      }),
  );

  const entries: CourseListEntry[] = pageItems.map((o) => {
    const staff = user.staff.find((s) => s.offering_id === o.id);
    return {
      offering: o,
      staff: staffByOffering[o.id] ?? [],
      favorite: favorites.has(o.id),
      role: staff ? staff.role : enrollmentById.has(o.id) ? "learner" : "admin",
      enrollmentStatus: enrollmentById.get(o.id) ?? null,
      progressPercent: progress.get(o.id) ?? null,
    };
  });

  // Group headings like the reference layout: Ongoing, Upcoming, then each closed term.
  const groups: { label: string; items: CourseListEntry[] }[] = [];
  for (const e of entries) {
    const phase = offeringPhase(e.offering);
    const label = phase === "ongoing" ? t("courses.ongoing") : phase === "upcoming" ? t("courses.upcoming") : `${e.offering.term_label || "Earlier"} (closed)`;
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(e);
    else groups.push({ label, items: [e] });
  }

  const terms = Array.from(new Set(base.map((o) => o.term_label).filter(Boolean))).sort();
  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged = { q, term, filter: filter === "all" ? "" : filter, per: per === 25 ? "" : String(per), ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const s = p.toString();
    return s ? `/courses?${s}` : "/courses";
  };

  return (
    <>
      <PageHeader
        title={t("courses.title")}
        actions={
          <Link href="/catalog" className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 hover:underline">
            <LibraryBig aria-hidden="true" className="h-5 w-5" /> {t("nav.catalog")}
          </Link>
        }
      />
      <PageBody>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex self-start rounded-md border border-line bg-panel lg:self-auto" role="group" aria-label="Layout">
            <form action={setCoursesView}>
              <input type="hidden" name="view" value="list" />
              <button
                type="submit"
                aria-pressed={view === "list"}
                className={cn("inline-flex h-10 w-11 items-center justify-center rounded-l-md", view === "list" ? "bg-sidebar text-white" : "hover:bg-canvas")}
              >
                <List aria-hidden="true" className="h-5 w-5" />
                <span className="sr-only">{t("courses.listView")}</span>
              </button>
            </form>
            <form action={setCoursesView}>
              <input type="hidden" name="view" value="grid" />
              <button
                type="submit"
                aria-pressed={view === "grid"}
                className={cn("inline-flex h-10 w-11 items-center justify-center rounded-r-md", view === "grid" ? "bg-sidebar text-white" : "hover:bg-canvas")}
              >
                <LayoutGrid aria-hidden="true" className="h-5 w-5" />
                <span className="sr-only">{t("courses.gridView")}</span>
              </button>
            </form>
          </div>
          <form method="get" action="/courses" role="search" className="flex flex-1 flex-wrap items-end gap-3">
            <div className="relative min-w-0 basis-full sm:basis-auto sm:flex-[2_1_16rem]">
              <label htmlFor="course-search" className="sr-only">{t("courses.search")}</label>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                id="course-search"
                name="q"
                type="search"
                defaultValue={q}
                placeholder={t("courses.search")}
                className="block min-h-10 w-full rounded-md border border-line bg-white py-2 pl-9 pr-3"
              />
            </div>
            <div className="min-w-[10rem] flex-[1_1_10rem]">
              <label htmlFor="course-term" className="block text-xs text-muted">{t("courses.terms")}</label>
              <select id="course-term" name="term" defaultValue={term} className={selectClass}>
                <option value="">{t("courses.allTerms")}</option>
                {terms.map((tl) => (
                  <option key={tl} value={tl}>{tl}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[10rem] flex-[1_1_10rem]">
              <label htmlFor="course-filter" className="block text-xs text-muted">{t("courses.filters")}</label>
              <select id="course-filter" name="filter" defaultValue={filter} className={selectClass}>
                <option value="all">{t("courses.allCourses")}</option>
                <option value="favorites">{t("courses.favorites")}</option>
                <option value="learning">{t("courses.learning")}</option>
                <option value="teaching">{t("courses.teaching")}</option>
                {isAdminish ? <option value="administered">All offerings I administer</option> : null}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label htmlFor="course-per" className="sr-only">{t("common.itemsPerPage")}</label>
                <select id="course-per" name="per" defaultValue={String(per)} className={cn(selectClass, "w-20")}>
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <span aria-hidden="true" className="pb-2 text-sm">{t("common.itemsPerPage")}</span>
            </div>
            <button type="submit" data-apply className={buttonClass("secondary")}>Apply</button>
            <AutoSubmit />
          </form>
        </div>

        <p className="mb-4 text-sm" aria-live="polite">
          {filtered.length === 1 ? t("common.result") : t("common.results", { count: filtered.length })}
        </p>

        {base.length === 0 ? (
          <EmptyState title={t("courses.noCourses")}>
            {isAdminish ? <>Choose <Link className="text-primary underline" href="/courses?filter=administered">All offerings I administer</Link> to see the offerings in your cohorts.</> : <>Browse the <Link className="text-primary underline" href="/catalog">course catalog</Link> to request access.</>}
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState title={t("courses.empty")} action={<Link className={buttonClass("secondary")} href="/courses">Clear search and filters</Link>} />
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.label} aria-labelledby={`group-${g.label}`}>
                <h2 id={`group-${g.label}`} className="mb-3 text-lg font-semibold">{g.label}</h2>
                {view === "grid" ? (
                  <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {g.items.map((e) => <CourseCard key={e.offering.id} entry={e} />)}
                  </ul>
                ) : (
                  <ul className="space-y-3">
                    {g.items.map((e) => <CourseRow key={e.offering.id} entry={e} tz={user.timezone} />)}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
        <Pagination page={page} pages={pages} hrefFor={(p) => qs({ page: String(p) })} />
      </PageBody>
    </>
  );
}
