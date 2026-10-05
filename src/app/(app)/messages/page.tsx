import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SquarePen } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { AutoSubmit } from "@/components/ui/auto-submit";
import { Select } from "@/components/ui/field";
import { ScopeRow } from "@/components/messages/scope-row";
import { ThreadList } from "@/components/messages/thread-list";
import { LiveRefresh } from "@/components/messages/live-refresh";
import {
  loadMessageScopes, loadOtherParticipantCounts, loadReadOnlyScopes, loadScopeLabel, loadScopeThreads, loadUnreadCount,
} from "@/lib/comms/queries";
import { composeHref, parseScopeParams, sameScope, scopeMessagesHref, scopeSignature, type MessageScope, type ScopeRef } from "@/lib/comms/scope";
import { pageInfo, readPage } from "@/lib/comms/discussions";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("msg.title") };

const PAGE_SIZE = 20;

type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function MessagesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const user = await requireUser("/messages");
  const scope = parseScopeParams(sp);
  if (scope === "invalid") notFound();
  const [scopes, unread] = await Promise.all([loadMessageScopes(), loadUnreadCount()]);
  const signature = scopeSignature(unread, scopes);
  if (scope) {
    return (
      <ScopeConversations
        scope={scope}
        scopes={scopes}
        signature={signature}
        tz={user.timezone}
        show={one(sp.show) === "unread" ? "unread" : "all"}
        page={readPage(one(sp.page))}
      />
    );
  }

  const readOnly = await loadReadOnlyScopes(scopes);
  const courses = scopes.filter((s) => s.type === "offering");
  const cohorts = scopes.filter((s) => s.type === "cohort");
  return (
    <>
      <PageHeader title={t("msg.title")} description={t("msg.intro")} />
      <PageBody className="space-y-8">
        {scopes.length === 0 && readOnly.length === 0 ? (
          <EmptyState title={t("msg.noScopes")}>{t("msg.noScopesHelp")}</EmptyState>
        ) : null}
        {courses.length > 0 ? <ScopeSection id="courses" title={t("msg.coursesHeading")} scopes={courses} /> : null}
        {cohorts.length > 0 ? <ScopeSection id="cohorts" title={t("msg.cohortsHeading")} scopes={cohorts} /> : null}
        {readOnly.length > 0 ? (
          <section aria-labelledby="earlier-heading" className="space-y-3">
            <div>
              <h2 id="earlier-heading" className="text-lg font-semibold">{t("msg.readOnlyHeading")}</h2>
              <p className="text-sm text-muted">{t("msg.readOnlyIntro")}</p>
            </div>
            <ul className="space-y-3">
              {readOnly.map((s) => (
                <ScopeRow key={`${s.type}:${s.id}`} scope={s} readOnly />
              ))}
            </ul>
          </section>
        ) : null}
        <p className="text-sm text-muted">{t("msg.liveNote")}</p>
        <LiveRefresh signature={signature} />
      </PageBody>
    </>
  );
}

function ScopeSection({ id, title, scopes }: { id: string; title: string; scopes: MessageScope[] }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-3">
      <h2 id={`${id}-heading`} className="text-lg font-semibold">{title}</h2>
      <ul className="space-y-3">
        {scopes.map((s) => (
          <ScopeRow key={`${s.type}:${s.id}`} scope={s} />
        ))}
      </ul>
    </section>
  );
}

async function ScopeConversations({
  scope,
  scopes,
  signature,
  tz,
  show,
  page,
}: {
  scope: ScopeRef;
  scopes: MessageScope[];
  signature: string;
  tz: string;
  show: "all" | "unread";
  page: number;
}) {
  const active = scopes.find((s) => sameScope(s, scope)) ?? null;
  const threads = await loadScopeThreads(scope);
  // Only scopes the viewer can message in, or has conversations in, exist for them.
  if (!active && threads.length === 0) notFound();
  const label = active ?? (await loadScopeLabel(scope));
  const code = label?.code ?? "—";
  const title = label?.title ?? t("msg.unknownScope");

  const filtered = show === "unread" ? threads.filter((th) => th.unread > 0) : threads;
  const { page: current, pages } = pageInfo(filtered.length, PAGE_SIZE, page);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const others = await loadOtherParticipantCounts(visible.map((th) => th.id));
  const hrefFor = (p: number) => scopeMessagesHref(scope, { show: show === "unread" ? "unread" : undefined, page: p > 1 ? String(p) : undefined });

  return (
    <>
      <PageHeader
        title={title}
        crumbs={[{ label: t("msg.title"), href: "/messages" }, { label: code }]}
        description={`${t("msg.idLabel", { code })} · ${scope.type === "offering" ? t("msg.scopeCourse") : t("msg.scopeCohort")}`}
        actions={
          active ? (
            <ButtonLink href={composeHref(scope)}>
              <SquarePen aria-hidden="true" className="h-4 w-4" /> {t("msg.new")}
              <span className="sr-only"> {t("msg.newIn", { code })}</span>
            </ButtonLink>
          ) : null
        }
      />
      <PageBody className="space-y-4">
        {!active ? <Alert tone="info">{t("msg.readOnlyScope")}</Alert> : null}
        <section aria-labelledby="conversations-heading" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="conversations-heading" className="text-lg font-semibold">{t("msg.conversationsHeading")}</h2>
            <form method="get" action="/messages" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name={scope.type} value={scope.id} />
              <div className="space-y-1">
                <label htmlFor="show" className="block text-sm font-medium">{t("msg.filterLabel")}</label>
                <Select id="show" name="show" defaultValue={show}>
                  <option value="all">{t("msg.filterAll")}</option>
                  <option value="unread">{t("msg.filterUnread")}</option>
                </Select>
              </div>
              <button type="submit" data-apply className={buttonClass("secondary")}>{t("msg.apply")}</button>
              <AutoSubmit />
            </form>
          </div>
          {visible.length > 0 ? (
            <ThreadList threads={visible} tz={tz} others={others} />
          ) : show === "unread" && threads.length > 0 ? (
            <EmptyState title={t("msg.emptyUnread")} action={<ButtonLink variant="secondary" href={scopeMessagesHref(scope)}>{t("msg.showAll")}</ButtonLink>} />
          ) : (
            <EmptyState
              title={t("msg.emptyScope")}
              action={active ? <ButtonLink href={composeHref(scope)}>{t("msg.new")}</ButtonLink> : undefined}
            >
              {active ? t("msg.emptyScopeHelp") : null}
            </EmptyState>
          )}
          <Pagination page={current} pages={pages} hrefFor={hrefFor} />
        </section>
        <p className="text-sm text-muted">
          {t("msg.liveNote")} {t("common.timezoneNote", { tz })}.
        </p>
        <LiveRefresh signature={signature} />
      </PageBody>
    </>
  );
}
