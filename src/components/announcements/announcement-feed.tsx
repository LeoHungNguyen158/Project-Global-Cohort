import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { groupByState, sortAnnouncements } from "@/lib/comms/announcements";
import type { AnnouncementItem } from "@/lib/comms/announcement-queries";
import type { AnnouncementScope } from "@/lib/comms/paths";
import { t } from "@/i18n";
import { AnnouncementCard } from "./announcement-card";

type Common = {
  items: AnnouncementItem[];
  scope: AnnouncementScope;
  scopeName: string;
  tz: string;
  authorFallback?: string;
  now?: Date;
};

function timing(a: AnnouncementItem) {
  return { status: a.status, publish_at: a.publishAt, created_at: a.createdAt, pinned: a.pinned };
}

/**
 * Released announcements for learners and members, pinned first and then newest.
 * The database only returns released ones to them (published and due by its own
 * clock), so nothing is filtered again here. Heading level 3.
 */
export function ReleasedAnnouncements({ items, scope, scopeName, tz, authorFallback, emptyTitle, emptyText }: Omit<Common, "now"> & { emptyTitle: string; emptyText?: string }) {
  const released = sortAnnouncements(items.map((a) => ({ ...timing(a), item: a }))).map((x) => x.item);
  if (released.length === 0) return <EmptyState title={emptyTitle}>{emptyText}</EmptyState>;
  return (
    <ul className="space-y-4">
      {released.map((a) => (
        <li key={a.id}>
          <AnnouncementCard item={a} state="published" scope={scope} scopeName={scopeName} tz={tz} manage={false} authorFallback={authorFallback} level={3} />
        </li>
      ))}
    </ul>
  );
}

/** Every announcement for staff, grouped by state; archived ones are collapsed. */
export function ManagedAnnouncements({ items, scope, scopeName, tz, authorFallback, now = new Date(), locked }: Common & { locked?: boolean }) {
  const byId = new Map(items.map((a) => [a.id, a]));
  const groups = groupByState(items.map((a) => ({ ...timing(a), id: a.id })), now);
  const pick = (list: { id: string }[]) => list.map((x) => byId.get(x.id)).filter((a): a is AnnouncementItem => Boolean(a));
  const sections = [
    { key: "published" as const, title: t("ann.sectionPublished"), list: pick(groups.published) },
    { key: "scheduled" as const, title: t("ann.sectionScheduled"), list: pick(groups.scheduled) },
    { key: "draft" as const, title: t("ann.sectionDrafts"), list: pick(groups.draft) },
  ];
  const archived = pick(groups.archived);
  const card = (a: AnnouncementItem, state: "published" | "scheduled" | "draft" | "archived") => (
    <li key={a.id}>
      <AnnouncementCard item={a} state={state} scope={scope} scopeName={scopeName} tz={tz} manage locked={locked} authorFallback={authorFallback} level={4} />
    </li>
  );
  return (
    <div className="space-y-8">
      {sections.map((s) => (
        <section key={s.key} aria-labelledby={`ann-${s.key}`} className="space-y-3">
          <h3 id={`ann-${s.key}`} className="text-lg font-semibold">
            {s.title} <span className="text-base font-normal text-muted">({s.list.length})</span>
          </h3>
          {s.list.length === 0 ? <p className="text-sm text-muted">{t("ann.noneInSection")}</p> : <ul className="space-y-4">{s.list.map((a) => card(a, s.key))}</ul>}
        </section>
      ))}
      {archived.length > 0 ? (
        <section aria-labelledby="ann-archived" className="space-y-3">
          <h3 id="ann-archived" className="sr-only">{t("ann.sectionArchived", { count: archived.length })}</h3>
          <Disclosure summary={<span className="text-base font-semibold">{t("ann.sectionArchived", { count: archived.length })}</span>}>
            <ul className="space-y-4">{archived.map((a) => card(a, "archived"))}</ul>
          </Disclosure>
        </section>
      ) : null}
    </div>
  );
}
