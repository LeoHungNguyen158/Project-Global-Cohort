import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Mail, MessageSquare, Plus, Wrench } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/forms";
import { formatDate } from "@/lib/time";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { AccentBar, Panel, PanelHeader } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { CohortStatusBadge } from "@/components/cohorts/badges";
import { SectionTitle } from "@/components/announcements/section-title";
import { ManagedAnnouncements, ReleasedAnnouncements } from "@/components/announcements/announcement-feed";
import { SavedNotice } from "@/components/announcements/screens";
import { TopicList } from "@/components/discussions/topic-list";
import { loadAnnouncements } from "@/lib/comms/announcement-queries";
import { loadTopicList } from "@/lib/comms/discussion-queries";
import { loadCohort, loadCohortOverview, loadMessageScopes, type CohortOverview } from "@/lib/comms/queries";
import { formatDay } from "@/lib/comms/dates";
import { composeHref } from "@/lib/comms/scope";
import { newTopicPath, topicsPath, type AnnouncementScope, type DiscussionScope } from "@/lib/comms/paths";
import { t } from "@/i18n";

const ROSTER_SHOWN = 40;
const TOPICS_SHOWN = 5;

export async function generateMetadata({ params }: { params: Promise<{ cohortId: string }> }): Promise<Metadata> {
  const { cohortId } = await params;
  const cohort = isUuid(cohortId) ? await loadCohort(cohortId) : null;
  return { title: cohort?.name ?? t("cohort.title") };
}

function viewerRole(overview: CohortOverview, userId: string): string {
  if (overview.is_admin) return t("cohort.role.admin");
  if (overview.staff.some((s) => s.user_id === userId)) return t("cohort.role.staff");
  if (overview.participants.some((p) => p.user_id === userId)) return t("cohort.role.participant");
  return t("cohort.role.learner");
}

export default async function CohortPage({
  params,
  searchParams,
}: {
  params: Promise<{ cohortId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cohortId } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/cohorts/${cohortId}`);
  if (!isUuid(cohortId)) notFound();
  // Members and administrators only; everyone else gets the same "not available" page.
  const [cohort, overview] = await Promise.all([loadCohort(cohortId), loadCohortOverview(cohortId)]);
  if (!cohort || !overview) notFound();

  const annScope: AnnouncementScope = { type: "cohort", id: cohort.id };
  const discScope: DiscussionScope = { type: "cohort", id: cohort.id };
  const [announcements, topics, scopes] = await Promise.all([
    loadAnnouncements(annScope, { staff: overview.is_admin }),
    loadTopicList(discScope, 1, TOPICS_SHOWN),
    loadMessageScopes(),
  ]);
  const canMessage = scopes.some((s) => s.type === "cohort" && s.id === cohort.id);
  const tz = user.timezone;

  // Announcement bylines: staff and coordinators are named in the directory; otherwise "cohort administration".
  const names = new Map<string, string>([...overview.staff.map((s) => [s.user_id, s.name] as const), ...overview.coordinators.map((c) => [c.user_id, c.name] as const)]);
  const items = announcements.map((a) => ({ ...a, authorName: a.authorName ?? (a.authorId ? (names.get(a.authorId) ?? null) : null) }));

  const roster = overview.participants;
  const shown = roster.slice(0, ROSTER_SHOWN);
  const rest = roster.slice(ROSTER_SHOWN);
  const person = (p: { user_id: string; name: string }) => (
    <li key={p.user_id} className="flex items-center justify-between gap-2 py-1">
      <span className="min-w-0 break-words">
        {p.name}
        {p.user_id === user.id ? <span className="text-muted"> {t("msg.youSuffix")}</span> : null}
      </span>
      {canMessage && p.user_id !== user.id ? (
        <Link
          href={composeHref({ type: "cohort", id: cohort.id }, p.user_id)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-canvas"
          aria-label={t("cohort.messageNamed", { name: p.name })}
          prefetch={false}
        >
          <Mail aria-hidden="true" className="h-4 w-4" />
        </Link>
      ) : null}
    </li>
  );

  return (
    <>
      <PageHeader
        title={cohort.name}
        crumbs={[{ label: t("cohort.allCohorts"), href: "/cohorts" }, { label: cohort.code }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{t("msg.idLabel", { code: cohort.code })}</span>
            <CohortStatusBadge status={cohort.status} />
          </span>
        }
      />
      <PageBody>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-8">
            <Panel aria-labelledby="about-heading">
              <PanelHeader id="about-heading" title={t("cohort.about")} />
              <div className="space-y-4 px-4 py-4 sm:px-6">
                <p className="break-words">{cohort.description || <span className="text-muted">{t("cohort.noDescription")}</span>}</p>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{t("cohort.datesLabel")}</dt>
                    <dd>
                      {cohort.starts_on || cohort.ends_on
                        ? t("cohort.datesRange", { start: formatDay(cohort.starts_on), end: formatDay(cohort.ends_on) })
                        : t("cohort.noDates")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{t("cohort.timezone")}</dt>
                    <dd className="break-words">{cohort.timezone}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{t("cohort.yourRole")}</dt>
                    <dd>{viewerRole(overview, user.id)}</dd>
                  </div>
                </dl>
              </div>
            </Panel>

            <section aria-labelledby="offerings-heading">
              <SectionTitle id="offerings-heading">{t("cohort.offerings")}</SectionTitle>
              {overview.offerings.length === 0 ? (
                <EmptyState title={t("cohort.offeringsEmpty")} />
              ) : (
                <ul className="space-y-3">
                  {overview.offerings.map((o) => (
                    <li key={o.id} className="flex rounded-[var(--radius-panel)] border border-line bg-panel">
                      <AccentBar color={/^#[0-9a-f]{6}$/i.test(o.accent_color) ? o.accent_color : "#475569"} />
                      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
                        <div className="min-w-0">
                          <p className="text-sm text-muted">{t("msg.idLabel", { code: o.code })}</p>
                          <h3 className="break-words font-semibold">{o.title}</h3>
                          <p className="text-sm text-muted">
                            {o.term_label}
                            {o.starts_at ? ` · ${formatDate(o.starts_at, tz)} – ${formatDate(o.ends_at, tz)}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {o.status === "draft" ? <Badge tone="warning">{t("cohort.offeringDraft")}</Badge> : null}
                          {o.status === "archived" ? <Badge>{t("cohort.offeringArchived")}</Badge> : null}
                          {o.can_open ? (
                            <ButtonLink href={`/courses/${o.id}`} variant="secondary" size="sm">
                              {t("cohort.openCourse")}
                              <span className="sr-only"> {o.code}</span>
                            </ButtonLink>
                          ) : (
                            <span className="text-sm text-muted">{t("cohort.notEnrolled")}</span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section id="announcements" aria-labelledby="cohort-ann-heading" className="scroll-mt-24">
              <SectionTitle
                id="cohort-ann-heading"
                actions={
                  overview.is_admin ? (
                    <ButtonLink href={`/cohorts/${cohort.id}/announcements/new`} size="sm">
                      <Plus aria-hidden="true" className="h-4 w-4" /> {t("ann.new")}
                    </ButtonLink>
                  ) : null
                }
                description={overview.is_admin ? t("ann.cohortStaffNote") : undefined}
              >
                {t("cohort.announcements")}
              </SectionTitle>
              <SavedNotice saved={sp.saved} />
              {overview.is_admin ? (
                items.length === 0 ? (
                  <EmptyState title={t("ann.empty")}>{t("ann.emptyCohort")}</EmptyState>
                ) : (
                  <ManagedAnnouncements items={items} scope={annScope} scopeName={cohort.code} tz={tz} authorFallback={t("ann.cohortAdministration")} />
                )
              ) : (
                <ReleasedAnnouncements
                  items={items}
                  scope={annScope}
                  scopeName={cohort.code}
                  tz={tz}
                  authorFallback={t("ann.cohortAdministration")}
                  emptyTitle={t("ann.empty")}
                  emptyText={t("ann.emptyCohort")}
                />
              )}
            </section>

            <section aria-labelledby="cohort-disc-heading">
              <SectionTitle
                id="cohort-disc-heading"
                actions={
                  overview.is_admin ? (
                    <ButtonLink href={newTopicPath(discScope)} size="sm" variant="secondary">
                      <Plus aria-hidden="true" className="h-4 w-4" /> {t("disc.newTopic")}
                    </ButtonLink>
                  ) : null
                }
              >
                {t("cohort.discussions")}
              </SectionTitle>
              {!topics || topics.topics.length === 0 ? (
                <EmptyState title={t("disc.empty")}>{overview.is_admin ? t("disc.emptyStaff") : t("disc.emptyCohort")}</EmptyState>
              ) : (
                <TopicList topics={topics.topics} scope={discScope} tz={tz} />
              )}
              <p className="mt-3 text-sm">
                <Link href={topicsPath(discScope)} className="font-medium underline-offset-2 hover:underline">
                  {t("cohort.viewAllDiscussions")}
                </Link>
              </p>
            </section>
          </div>

          <aside className="min-w-0 space-y-6">
            <Panel aria-labelledby="shortcuts-heading">
              <PanelHeader id="shortcuts-heading" title={t("cohort.shortcuts")} />
              <ul className="space-y-1 px-4 py-3 sm:px-6">
                <li>
                  <Link href={`/calendar?cohort=${cohort.id}`} className="inline-flex min-h-10 items-center gap-2 hover:underline">
                    <CalendarDays aria-hidden="true" className="h-4 w-4" /> {t("cohort.calendar")}
                  </Link>
                </li>
                <li>
                  <Link href={`/tools?cohort=${cohort.id}`} className="inline-flex min-h-10 items-center gap-2 hover:underline">
                    <Wrench aria-hidden="true" className="h-4 w-4" /> {t("cohort.tools")}
                  </Link>
                </li>
                {canMessage ? (
                  <li>
                    <Link href={`/messages?cohort=${cohort.id}`} className="inline-flex min-h-10 items-center gap-2 hover:underline">
                      <MessageSquare aria-hidden="true" className="h-4 w-4" /> {t("cohort.messageCohort")}
                    </Link>
                  </li>
                ) : null}
              </ul>
            </Panel>

            <Panel aria-labelledby="staff-heading">
              <PanelHeader id="staff-heading" title={t("cohort.staff")} />
              <div className="px-4 py-3 sm:px-6">
                {overview.staff.length === 0 && overview.coordinators.length === 0 ? (
                  <p className="text-sm text-muted">{t("cohort.staffEmpty")}</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {overview.coordinators.map((c) => (
                      <li key={`c-${c.user_id}`}>
                        <span className="font-medium">{c.name}</span>
                        <span className="block text-muted">{t("cohort.coordinator")}</span>
                      </li>
                    ))}
                    {overview.staff.map((s) => (
                      <li key={`s-${s.user_id}`}>
                        <span className="font-medium">{s.name}</span>
                        {s.roles.map((r) => (
                          <span key={`${r.role}-${r.offering_code}`} className="block text-muted">
                            {r.role === "instructor" ? t("cohort.instructorIn", { code: r.offering_code }) : t("cohort.taIn", { code: r.offering_code })}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>

            <Panel aria-labelledby="roster-heading">
              <PanelHeader id="roster-heading" title={t("cohort.roster")} />
              <div className="space-y-2 px-4 py-3 text-sm sm:px-6">
                <p className="text-muted">
                  {roster.length === 0
                    ? t("cohort.rosterEmpty")
                    : roster.length === 1
                      ? t("cohort.rosterCountOne")
                      : t("cohort.rosterCount", { count: roster.length })}
                </p>
                {shown.length > 0 ? <ul className="divide-y divide-line">{shown.map(person)}</ul> : null}
                {rest.length > 0 ? (
                  <Disclosure summary={t("cohort.showAll", { count: roster.length })}>
                    <ul className="divide-y divide-line">{rest.map(person)}</ul>
                  </Disclosure>
                ) : null}
                <p className="text-xs text-muted">{t("cohort.rosterPrivacy")}</p>
              </div>
            </Panel>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
