"use client";
import { useActionState, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, DoorClosed, DoorOpen, Download, ExternalLink, FileCheck2, MessagesSquare, Video, type LucideIcon } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { submitWithoutReset } from "@/components/ui/submit-without-reset";
import { cn } from "@/components/ui/cn";
import { cancelEvent, deleteEvent, restoreEvent } from "@/app/actions/calendar";
import type { ActionResult } from "@/lib/errors";
import { t } from "@/i18n/client/grades";
import { EventForm } from "./event-form";
import type { BoardData, DayCell, DisplayItem } from "./types";

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
type Open = (key: string) => void;

const KIND_ICON: Record<DisplayItem["kind"], LucideIcon> = {
  assignment_due: FileCheck2,
  quiz_opens: DoorOpen,
  quiz_closes: DoorClosed,
  live_session: Video,
  office_hours: MessagesSquare,
  event: CalendarDays,
};

function KindIcon({ item, className }: { item: DisplayItem; className?: string }) {
  const Icon = KIND_ICON[item.kind];
  return <Icon aria-hidden="true" className={cn("h-3.5 w-3.5 shrink-0", className)} />;
}

/** Compact item button for the month grid (one line) and the week columns (stacked). */
function Chip({ item, onOpen, compact }: { item: DisplayItem; onOpen: Open; compact?: boolean }) {
  const hidden = (
    <>
      <span className="sr-only">{item.kindLabel}: </span>
      {item.title}
      <span className="sr-only">, {item.scopeLabel}</span>
      {item.cancelled ? <span className="sr-only">, {t("cal.cancelled")}</span> : null}
    </>
  );
  return (
    <button
      type="button"
      onClick={() => onOpen(item.key)}
      aria-haspopup="dialog"
      className={cn(
        "w-full min-w-0 rounded-sm border-l-4 bg-canvas px-1.5 py-1 text-left text-xs hover:bg-[#e9ecef] focus-visible:outline-2 focus-visible:outline-primary",
        compact ? "flex items-center gap-1" : "block",
      )}
      style={{ borderLeftColor: item.accent }}
    >
      {compact ? (
        <>
          <KindIcon item={item} className="text-muted" />
          <span className="shrink-0 tabular-nums text-muted">{item.time}</span>
          <span className={cn("relative min-w-0 truncate", item.cancelled && "line-through")}>{hidden}</span>
        </>
      ) : (
        <>
          <span className="flex items-center gap-1 text-muted">
            <KindIcon item={item} />
            <span className="tabular-nums">{item.time}</span>
          </span>
          <span className={cn("mt-0.5 block font-medium [overflow-wrap:anywhere]", item.cancelled && "line-through")}>{hidden}</span>
          {item.cancelled ? <span aria-hidden="true" className="block text-danger">{t("cal.cancelled")}</span> : null}
        </>
      )}
    </button>
  );
}

/** One row in the list and week views: time, type and course, then the title. */
function Row({ item, onOpen }: { item: DisplayItem; onOpen: Open }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.key)}
      aria-haspopup="dialog"
      className="flex w-full min-w-0 gap-3 rounded-md border border-line border-l-4 bg-panel px-3 py-2 text-left hover:bg-canvas focus-visible:outline-2 focus-visible:outline-primary"
      style={{ borderLeftColor: item.accent }}
    >
      <span className="w-[4.75rem] shrink-0 text-sm tabular-nums text-muted">{item.time}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-xs text-muted">
          <KindIcon item={item} />
          {item.kindLabel} · {item.scopeLabel}
        </span>
        <span className={cn("block font-medium [overflow-wrap:anywhere]", item.cancelled && "line-through")}>{item.title}</span>
        {item.badges.length > 0 ? (
          <span className="mt-1 flex flex-wrap gap-1">
            {item.badges.map((b) => (
              <Badge key={b.text} tone={b.tone}>{b.text}</Badge>
            ))}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function DayHeading({ day, level, className }: { day: DayCell; level: 3 | 4; className?: string }) {
  const H = level === 3 ? "h3" : "h4";
  return (
    <H className={cn("flex flex-wrap items-center gap-2 text-sm font-semibold", className)}>
      {day.label}
      {day.isToday ? <Badge tone="info">{t("cal.todayMarker")}</Badge> : null}
    </H>
  );
}

function AgendaList({ days, byDay, onOpen, level, emptyText }: { days: DayCell[]; byDay: Map<string, DisplayItem[]>; onOpen: Open; level: 3 | 4; emptyText: string }) {
  const withItems = days.filter((d) => d.inPeriod && (byDay.get(d.date)?.length ?? 0) > 0);
  if (withItems.length === 0) return <EmptyState title={emptyText} />;
  return (
    <ol className="space-y-5">
      {withItems.map((d) => (
        <li key={d.date}>
          <DayHeading day={d} level={level} className="mb-2" />
          <ul className="space-y-2">
            {byDay.get(d.date)!.map((item) => (
              <li key={item.key}>
                <Row item={item} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function MonthTable({ data, byDay, onOpen }: { data: BoardData; byDay: Map<string, DisplayItem[]>; onOpen: Open }) {
  const header = data.weeks[0] ?? [];
  return (
    <table className="w-full table-fixed border-collapse rounded-[var(--radius-panel)] bg-panel text-sm">
      <caption className="sr-only">{data.caption}</caption>
      <thead>
        <tr>
          {header.map((d) => (
            <th key={d.date} scope="col" abbr={d.weekdayLong} className="border border-line bg-canvas px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
              {d.weekdayShort}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.weeks.map((week) => (
          <tr key={week[0].date}>
            {week.map((d) => {
              const items = byDay.get(d.date) ?? [];
              return (
                <td key={d.date} className={cn("h-28 border border-line p-1 align-top", !d.inPeriod && "bg-canvas", d.isToday && "bg-primary-soft")}>
                  <div className="mb-1 flex items-center justify-between gap-1 px-0.5">
                    <span aria-hidden="true" className={cn("text-xs font-semibold", !d.inPeriod && "text-muted", d.isToday && "rounded-full bg-primary px-1.5 text-white")}>
                      {d.dom}
                    </span>
                    <span className="sr-only">
                      {d.label}
                      {d.isToday ? `, ${t("cal.todayMarker")}` : ""}
                      {items.length === 0 ? `, ${t("cal.noItemsDay")}` : `, ${items.length === 1 ? t("cal.dayItemsOne") : t("cal.dayItems", { count: items.length })}`}
                    </span>
                  </div>
                  {items.length > 0 ? (
                    <ul className="space-y-1">
                      {items.map((item) => (
                        <li key={item.key}>
                          <Chip item={item} onOpen={onOpen} compact />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WeekGrid({ data, byDay, onOpen }: { data: BoardData; byDay: Map<string, DisplayItem[]>; onOpen: Open }) {
  return (
    <ol className="grid gap-3 lg:grid-cols-7">
      {data.days.map((d) => {
        const items = byDay.get(d.date) ?? [];
        return (
          <li key={d.date} className={cn("min-w-0 rounded-[var(--radius-panel)] border border-line bg-panel p-2", d.isToday && "border-primary")}>
            <h3 className="mb-2 flex flex-wrap items-center gap-1 text-sm font-semibold">
              <span className="sr-only">{d.label}</span>
              <span aria-hidden="true">
                {d.weekdayShort} {d.dom}
              </span>
              {d.isToday ? <Badge tone="info">{t("cal.todayMarker")}</Badge> : null}
            </h3>
            {items.length === 0 ? (
              <p className="text-xs text-muted">{t("cal.noItemsDay")}</p>
            ) : (
              <ul className="space-y-1.5">
                {items.map((item) => (
                  <li key={item.key}>
                    <Chip item={item} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Two-step confirmation inside the detail dialog (no nested dialogs). */
function InlineConfirm({
  action,
  eventId,
  label,
  title,
  description,
  confirmLabel,
  tone = "primary",
  onDone,
  children,
}: {
  action: Action;
  eventId: string;
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  onDone: (message: string) => void;
  children?: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const panel = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const [state, formAction] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) onDone(r.message ?? "");
    return r;
  }, null);
  useEffect(() => {
    if (confirming) panel.current?.focus();
  }, [confirming]);
  if (!confirming) {
    return (
      <button type="button" className={buttonClass(tone === "danger" ? "danger" : "secondary", "sm")} onClick={() => setConfirming(true)}>
        {label}
      </button>
    );
  }
  return (
    <form
      ref={panel}
      tabIndex={-1}
      aria-labelledby={titleId}
      action={formAction}
      onSubmit={submitWithoutReset(formAction)}
      className="w-full space-y-3 rounded-md border border-line bg-canvas p-3 focus:outline-none"
    >
      <p id={titleId} className="font-semibold">{title}</p>
      <p className="text-sm">{description}</p>
      <input type="hidden" name="event_id" value={eventId} />
      {children}
      {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setConfirming(false)}>
          {t("common.cancel")}
        </button>
        <SubmitButton size="sm" variant={tone === "danger" ? "danger" : "primary"} pendingText={t("gradebook.saving")}>
          {confirmLabel}
        </SubmitButton>
      </div>
    </form>
  );
}

function ItemDetails({ item, timezones, onDone }: { item: DisplayItem; timezones: string[]; onDone: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const reasonId = useId();
  if (editing && item.manage) {
    return (
      <div className="space-y-4">
        <button type="button" className="text-sm text-primary underline underline-offset-2" onClick={() => setEditing(false)}>
          {t("cal.back")}
        </button>
        <EventForm event={item.manage} timezones={timezones} onDone={onDone} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {item.badges.length > 0 ? (
        <p className="flex flex-wrap gap-1.5">
          {item.badges.map((b) => (
            <Badge key={b.text} tone={b.tone}>{b.text}</Badge>
          ))}
        </p>
      ) : null}
      {item.cancelled ? (
        <Alert tone="warning">
          {t("cal.cancelledNote")}
          {item.cancelReason ? <span className="block">{t("cal.cancelReason", { reason: item.cancelReason })}</span> : null}
        </Alert>
      ) : null}
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        <div className="contents">
          <dt className="font-medium">{item.scopeHeading}</dt>
          <dd className="[overflow-wrap:anywhere]">{item.scopeLine}</dd>
        </div>
        {item.when.map((w) => (
          <div key={w.label} className="contents">
            <dt className="font-medium">{w.label}</dt>
            <dd>
              {w.value}
              {w.reference ? <span className="block text-muted">{w.reference}</span> : null}
            </dd>
          </div>
        ))}
        {item.location ? (
          <div className="contents">
            <dt className="font-medium">{t("cal.location")}</dt>
            <dd className="[overflow-wrap:anywhere]">{item.location}</dd>
          </div>
        ) : null}
        {item.meetingUrl ? (
          <div className="contents">
            <dt className="font-medium">{t("cal.meeting")}</dt>
            <dd>
              <a href={item.meetingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
                {t("cal.joinMeeting")}
                <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                <span className="sr-only"> ({t("cal.externalLink")})</span>
              </a>
              <span className="block break-all text-xs text-muted">{item.meetingUrl}</span>
              <span className="block text-xs text-muted">{t("cal.meetingNote")}</span>
            </dd>
          </div>
        ) : null}
      </dl>
      {item.notes.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {item.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {item.description ? (
        <div>
          <h3 className="text-sm font-semibold">{t("cal.details")}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{item.description}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {item.link ? (
          <Link href={item.link.href} className={buttonClass("primary", "sm")}>
            {item.link.label}
          </Link>
        ) : null}
        <a href={item.icsHref} download className={buttonClass("secondary", "sm")} aria-describedby={`${reasonId}-ics`}>
          <Download aria-hidden="true" className="h-4 w-4" />
          {t("cal.downloadIcs")}
        </a>
      </div>
      <p id={`${reasonId}-ics`} className="text-xs text-muted">{t("cal.downloadIcsHint")}</p>
      {item.manage ? (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setEditing(true)}>
            {t("cal.editEvent")}
          </button>
          {item.manage.cancelled ? (
            <InlineConfirm
              action={restoreEvent}
              eventId={item.manage.eventId}
              label={t("cal.restoreEvent")}
              title={t("cal.restoreEvent")}
              description={t("cal.restoreEventDescription")}
              confirmLabel={t("cal.restoreEvent")}
              onDone={onDone}
            />
          ) : (
            <InlineConfirm
              action={cancelEvent}
              eventId={item.manage.eventId}
              label={t("cal.cancelEvent")}
              title={t("cal.cancelEventTitle")}
              description={t("cal.cancelEventDescription")}
              confirmLabel={t("cal.cancelEvent")}
              onDone={onDone}
            >
              <Field label={t("cal.cancelReasonLabel")} htmlFor={reasonId}>
                <Textarea id={reasonId} name="reason" maxLength={500} className="min-h-20" />
              </Field>
            </InlineConfirm>
          )}
          <InlineConfirm
            action={deleteEvent}
            eventId={item.manage.eventId}
            label={t("cal.deleteEvent")}
            title={t("cal.deleteEventTitle")}
            description={t("cal.deleteEventDescription")}
            confirmLabel={t("cal.deleteConfirm")}
            tone="danger"
            onDone={onDone}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Month, week or list view of calendar items with one accessible detail dialog.
 * The server decides which items exist and formats every time in the viewer's zone.
 */
export function CalendarBoard({ data }: { data: BoardData }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const byDay = useMemo(() => {
    const map = new Map<string, DisplayItem[]>();
    for (const item of data.items) {
      const list = map.get(item.day);
      if (list) list.push(item);
      else map.set(item.day, [item]);
    }
    return map;
  }, [data.items]);
  const item = selected ? data.items.find((i) => i.key === selected) ?? null : null;
  const open = (key: string) => {
    setMessage(null);
    setSelected(key);
  };
  const done = (m: string) => {
    setMessage(m || null);
    setSelected(null);
  };

  return (
    <div className="space-y-3">
      <div aria-live="polite" className="empty:hidden">
        {message ? <Alert tone="success">{message}</Alert> : null}
      </div>
      {data.view === "month" ? (
        <>
          <div className="hidden md:block">
            <MonthTable data={data} byDay={byDay} onOpen={open} />
          </div>
          <div className="md:hidden">
            <AgendaList days={data.days} byDay={byDay} onOpen={open} level={3} emptyText={data.emptyText} />
          </div>
        </>
      ) : data.view === "week" ? (
        <WeekGrid data={data} byDay={byDay} onOpen={open} />
      ) : (
        <AgendaList days={data.days} byDay={byDay} onOpen={open} level={3} emptyText={data.emptyText} />
      )}
      {data.view !== "list" && data.items.length === 0 ? (
        <p className={cn("text-sm text-muted", data.view === "month" && "hidden md:block")}>{data.emptyText}</p>
      ) : null}
      <Dialog
        open={item !== null}
        onClose={() => setSelected(null)}
        title={item?.title ?? ""}
        description={item ? `${item.kindLabel} · ${item.scopeLabel}` : undefined}
        wide
      >
        {item ? <ItemDetails key={item.key} item={item} timezones={data.timezones} onDone={done} /> : null}
      </Dialog>
    </div>
  );
}
