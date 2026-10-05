import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { UserContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CALENDAR_VIEWS,
  dayLabel,
  dayOfMonth,
  isCalendarView,
  isCivilDate,
  monthLabel,
  shortDayLabel,
  todayIn,
  viewRange,
  weekdayLabels,
  type CalendarView,
} from "@/lib/calendar/dates";
import { CALENDAR_ITEM_TYPES, isCalendarItemType, type CalendarItem, type CalendarItemType } from "@/lib/calendar/items";
import { loadCalendarItems, type CalendarSources } from "@/lib/calendar/load";
import { COMMON_TIMEZONES, zoneAbbreviation } from "@/lib/time";
import { t, type MessageKey } from "@/i18n";
import { AutoSubmit } from "@/components/ui/auto-submit";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { CalendarBoard } from "./calendar-board";
import { AddEventButton } from "./event-form";
import { toDisplayItem } from "./display";
import type { BoardData, DayCell, ManageScope } from "./types";

export type CalendarSearch = { view?: string; date?: string; type?: string };

const VIEW_LABEL: Record<CalendarView, MessageKey> = { month: "cal.month", week: "cal.week", list: "cal.list" };
const TYPE_LABEL: Record<CalendarItemType, MessageKey> = {
  assignment: "cal.type.assignment",
  quiz: "cal.type.quiz",
  live_session: "cal.type.liveSession",
  office_hours: "cal.type.officeHours",
  event: "cal.type.event",
};

const selectClass = "block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-ink";

/**
 * Month, week and list calendar shared by /calendar and the course Calendar tab. The view,
 * date and filters live in the URL. Items are read as the signed-in person (RLS), placed
 * on the viewer's own calendar days, and shown in the viewer's time zone.
 */
export async function CalendarScreen({
  basePath,
  search,
  keep = {},
  user,
  sources,
  scopeSelect,
  manage,
  manageNote,
  canManage,
}: {
  basePath: string;
  search: CalendarSearch;
  /** Extra query parameters kept on every link (e.g. the scope filter). */
  keep?: Record<string, string>;
  user: UserContext;
  sources: CalendarSources;
  scopeSelect?: { options: { value: string; label: string }[]; value: string } | null;
  manage?: ManageScope | null;
  manageNote?: string | null;
  canManage: (item: CalendarItem) => boolean;
}) {
  const tz = user.timezone;
  const today = todayIn(tz);
  const view: CalendarView = isCalendarView(search.view) ? search.view : "month";
  const anchor = isCivilDate(search.date) ? search.date : today;
  const type = isCalendarItemType(search.type) ? search.type : null;
  const range = viewRange(view, anchor, tz);

  const db = await createClient();
  const items = await loadCalendarItems(db, user.id, sources, range, type);
  const currentHref = basePath === "/calendar" && keep.scope ? `/calendar?scope=${keep.scope}` : basePath;
  const display = items.map((item) =>
    toDisplayItem(item, {
      tz,
      offerings: new Map(sources.offerings.map((o) => [o.id, o])),
      cohorts: new Map(sources.cohorts.map((c) => [c.id, c])),
      currentHref,
      canManage,
    }),
  );

  const days: DayCell[] = range.days.map((d) => {
    const w = weekdayLabels(d);
    return { date: d, label: dayLabel(d), weekdayShort: w.short, weekdayLong: w.long, dom: dayOfMonth(d), inPeriod: d >= range.from && d < range.toExclusive, isToday: d === today };
  });
  const weeks: DayCell[][] = [];
  if (view === "month") for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const filtered = type !== null || Boolean(keep.scope);
  const board: BoardData = {
    view,
    days,
    weeks,
    items: display,
    caption: t("cal.monthCaption", { month: monthLabel(anchor) }),
    emptyText: filtered ? t("cal.emptyFiltered") : t("cal.empty"),
    timezones: COMMON_TIMEZONES,
  };

  const href = (patch: { view?: CalendarView; date?: string | null }) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) p.set(k, v);
    const v = patch.view ?? view;
    if (v !== "month") p.set("view", v);
    const date = patch.date === undefined ? (search.date && isCivilDate(search.date) ? anchor : null) : patch.date;
    if (date) p.set("date", date);
    if (type) p.set("type", type);
    const s = p.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  const end = days[days.length - 1].date;
  const period =
    view === "week"
      ? t("cal.weekTitle", { start: shortDayLabel(days[0].date), end: `${shortDayLabel(end)}, ${end.slice(0, 4)}` })
      : view === "list"
        ? t("cal.listTitle", { month: monthLabel(anchor) })
        : monthLabel(anchor);
  const prevLabel = view === "week" ? t("cal.prevWeek") : t("cal.prevMonth");
  const nextLabel = view === "week" ? t("cal.nextWeek") : t("cal.nextMonth");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label={t("cal.views")}>
          <ul className="flex rounded-md border border-line bg-panel">
            {CALENDAR_VIEWS.map((v, i) => (
              <li key={v}>
                <Link
                  href={href({ view: v })}
                  aria-current={v === view ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-10 items-center px-4 text-sm font-medium",
                    i === 0 && "rounded-l-md",
                    i === CALENDAR_VIEWS.length - 1 && "rounded-r-md",
                    v === view ? "bg-sidebar text-white" : "hover:bg-canvas",
                  )}
                >
                  {t(VIEW_LABEL[v])}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t("cal.navigation")} className="flex items-center gap-1">
          <Link href={href({ date: range.prev })} className={buttonClass("secondary", "sm")} rel="prev">
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">{prevLabel}</span>
          </Link>
          <Link href={href({ date: null })} className={buttonClass("secondary", "sm")}>
            {t("cal.today")}
          </Link>
          <Link href={href({ date: range.next })} className={buttonClass("secondary", "sm")} rel="next">
            <span className="sr-only sm:not-sr-only">{nextLabel}</span>
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </nav>
        {manage ? (
          <div className="sm:ml-auto">
            <AddEventButton scope={manage} timezones={COMMON_TIMEZONES} />
          </div>
        ) : null}
      </div>
      {manageNote ? <p className="text-sm text-muted">{manageNote}</p> : null}

      <h2 className="text-xl font-semibold" data-testid="calendar-period">{period}</h2>

      <form method="get" action={basePath} role="search" aria-label={t("cal.filters")} className="flex flex-wrap items-end gap-3">
        {view !== "month" ? <input type="hidden" name="view" value={view} /> : null}
        {search.date && isCivilDate(search.date) ? <input type="hidden" name="date" value={anchor} /> : null}
        {scopeSelect ? (
          <div className="min-w-0 flex-[2_1_14rem] sm:max-w-xl">
            <label htmlFor="cal-scope" className="block text-xs text-muted">{t("cal.filterScope")}</label>
            <select id="cal-scope" name="scope" defaultValue={scopeSelect.value} className={selectClass}>
              <option value="">{t("cal.allScopes")}</option>
              {scopeSelect.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="min-w-0 flex-[1_1_12rem] sm:max-w-xs">
          <label htmlFor="cal-type" className="block text-xs text-muted">{t("cal.filterType")}</label>
          <select id="cal-type" name="type" defaultValue={type ?? ""} className={selectClass}>
            <option value="">{t("cal.allTypes")}</option>
            {CALENDAR_ITEM_TYPES.map((ty) => (
              <option key={ty} value={ty}>{t(TYPE_LABEL[ty])}</option>
            ))}
          </select>
        </div>
        <button type="submit" data-apply className={buttonClass("secondary")}>{t("cal.apply")}</button>
        <AutoSubmit />
      </form>

      <p className="text-sm text-muted">
        {t("cal.timezone", { tz, abbr: zoneAbbreviation(new Date(), tz) })}{" "}
        <Link href="/profile" className="text-primary underline underline-offset-2">{t("cal.changeTimezone")}</Link>
      </p>

      <CalendarBoard data={board} />
    </div>
  );
}
