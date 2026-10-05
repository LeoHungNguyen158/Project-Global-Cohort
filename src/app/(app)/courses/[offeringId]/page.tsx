import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  ClipboardCheck,
  FileQuestion,
  ListChecks,
  Megaphone,
  MessageSquare,
  Settings2,
  Table2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { requireOffering } from "@/lib/data/offering-access";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatWithCourseTime } from "@/lib/time";
import { flattenLessons, nextAction, requiredCounts } from "@/lib/learning/outline";
import { assetUrl, loadOutline, loadProgress, loadStaffWithAvatars } from "@/lib/learning/data";
import { NextActionBlock } from "@/components/learning/next-action";
import { ProgressMeter } from "@/components/learning/progress-meter";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { RichText } from "@/components/ui/rich-text";
import { t } from "@/i18n";

type StaffSummary = { submissions_to_grade?: number; attempts_to_grade?: number; grades_to_publish?: number; learners?: number };

function hasText(html: string | null | undefined): boolean {
  return Boolean(html && html.replace(/<[^>]*>/g, "").trim());
}

export default async function OverviewPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const access = await requireOffering(offeringId);
  const { offering, user } = access;
  const tz = user.timezone;
  const courseTz = offering.timezone;
  const version = offering.course_versions;
  const staffView = access.isStaffView;
  const notStarted = Boolean(offering.starts_at && new Date(offering.starts_at) > new Date());
  const supabase = await createClient();

  const [staff, outlineResult, progress, summary, snapshot] = await Promise.all([
    loadStaffWithAvatars(offeringId),
    staffView ? Promise.resolve(null) : loadOutline(offeringId),
    staffView ? Promise.resolve(null) : loadProgress(offeringId),
    staffView
      ? supabase.rpc("staff_offering_summary", { p_offering: offeringId }).then(({ data }) => (data as StaffSummary | null) ?? null)
      : Promise.resolve(null),
    staffView
      ? Promise.resolve(null)
      : supabase
          .from("completion_snapshots")
          .select("completed_at")
          .eq("offering_id", offeringId)
          .eq("user_id", user.id)
          .maybeSingle()
          .then(({ data }) => (data?.completed_at as string | undefined) ?? null),
  ]);

  const modules = outlineResult?.outline.modules ?? [];
  const lessons = flattenLessons(modules).map((x) => x.lesson);
  const counts = requiredCounts(lessons);
  const objectives = (version?.objectives ?? []).filter((o) => o.trim());

  const toolLinks: { href: string; label: string; icon: LucideIcon; show: boolean }[] = [
    { href: `/courses/${offeringId}/content/manage`, label: t("learn.staff.manageContent"), icon: Settings2, show: access.canAuthor },
    { href: `/courses/${offeringId}/content/manage/rules`, label: t("learn.staff.releaseRules"), icon: ListChecks, show: access.canAuthor },
    { href: `/courses/${offeringId}/people`, label: t("learn.staff.peopleProgress"), icon: Users, show: true },
    { href: `/courses/${offeringId}/assignments`, label: t("learn.staff.assignments"), icon: ClipboardCheck, show: true },
    { href: `/courses/${offeringId}/quizzes`, label: t("learn.staff.quizzes"), icon: FileQuestion, show: true },
    { href: `/courses/${offeringId}/grades`, label: t("learn.staff.gradebook"), icon: Table2, show: true },
    { href: `/courses/${offeringId}/announcements`, label: t("learn.staff.announcements"), icon: Megaphone, show: true },
    { href: `/messages?offering=${offeringId}`, label: t("learn.staff.messages"), icon: MessageSquare, show: true },
    { href: `/courses/${offeringId}/calendar`, label: t("learn.staff.calendar"), icon: CalendarDays, show: true },
  ];
  const toGrade = Number(summary?.submissions_to_grade ?? 0) + Number(summary?.attempts_to_grade ?? 0);
  const learnersCount = Number(summary?.learners ?? 0);

  return (
    <PageBody>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {!staffView ? (
            <Panel aria-labelledby="overview-progress">
              <PanelHeader id="overview-progress" title={t("learn.overview.progressTitle")} />
              <div className="space-y-4 px-4 py-4 sm:px-6">
                {offering.status === "archived" ? <Alert tone="info">{t("learn.overview.archived")}</Alert> : null}
                {offering.status !== "archived" && access.enrollmentStatus === "completed" ? (
                  <Alert tone="info">{t("learn.overview.completedEnrollment")}</Alert>
                ) : null}
                {notStarted && offering.starts_at ? (
                  <Alert tone="info" title={t("learn.overview.upcomingTitle")}>
                    {t("learn.overview.upcoming", { date: formatWithCourseTime(offering.starts_at, tz, courseTz) })}
                  </Alert>
                ) : null}
                {counts.total > 0 ? (
                  <ProgressMeter
                    done={progress?.requiredCompleted ?? counts.done}
                    total={progress?.requiredTotal ?? counts.total}
                    percent={progress?.percent ?? null}
                  />
                ) : null}
                {snapshot ? <p className="text-sm">{t("learn.overview.completedOn", { date: formatDateTime(snapshot, tz) })}</p> : null}
                <p className="text-xs text-muted">{t("learn.progress.rule")}</p>
                {notStarted ? (
                  <Link href={`/courses/${offeringId}/content`} className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary underline underline-offset-2">
                    {t("learn.next.browse")} <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                ) : (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">{t("learn.overview.nextStep")}</h3>
                    <NextActionBlock offeringId={offeringId} action={nextAction(modules)} tz={tz} courseTz={courseTz} />
                  </div>
                )}
              </div>
            </Panel>
          ) : (
            <Panel aria-labelledby="overview-tools">
              <PanelHeader
                id="overview-tools"
                title={t("learn.staff.tools")}
                actions={
                  offering.status === "published" ? (
                    <Badge tone="success">{t("learn.staff.visibleToLearners")}</Badge>
                  ) : offering.status === "draft" ? (
                    <Badge tone="warning">{t("learn.staff.hiddenFromLearners")}</Badge>
                  ) : null
                }
              />
              <div className="space-y-4 px-4 py-4 sm:px-6">
                <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <li>{learnersCount === 1 ? t("learn.staff.learnersOne") : t("learn.staff.learners", { count: learnersCount })}</li>
                  {access.canGrade ? <li>{t("learn.staff.toGrade", { count: toGrade })}</li> : null}
                  {access.canPublishGrades ? <li>{t("learn.staff.toPublish", { count: Number(summary?.grades_to_publish ?? 0) })}</li> : null}
                  {version ? <li>{t("learn.staff.version", { version: version.version_no })}</li> : null}
                </ul>
                {offering.status === "draft" ? (
                  <p className="text-sm">
                    {t("learn.overview.draftOffering")}{" "}
                    {access.canAuthor ? t("learn.overview.draftOfferingAuthor") : t("learn.overview.draftOfferingOther")}
                  </p>
                ) : null}
                <ul className="grid gap-2 sm:grid-cols-2">
                  {toolLinks
                    .filter((l) => l.show)
                    .map((l) => (
                      <li key={l.href}>
                        <Link href={l.href} className="flex min-h-11 items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-canvas">
                          <l.icon aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" /> {l.label}
                        </Link>
                      </li>
                    ))}
                </ul>
                <p className="text-xs text-muted">{t("learn.staff.previewNote")}</p>
              </div>
            </Panel>
          )}

          <Panel aria-labelledby="overview-about">
            <PanelHeader id="overview-about" title={t("learn.overview.about")} />
            <div className="space-y-5 px-4 py-4 sm:px-6">
              <p className="whitespace-pre-line">{version?.summary?.trim() || t("learn.overview.summaryEmpty")}</p>
              <div>
                <h3 className="mb-1 font-semibold">{t("learn.overview.objectives")}</h3>
                {objectives.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5">
                    {objectives.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">{t("learn.overview.noObjectives")}</p>
                )}
              </div>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="font-semibold">{t("learn.overview.audience")}</dt>
                  <dd className="whitespace-pre-line text-sm">{version?.audience?.trim() || t("learn.overview.notProvided")}</dd>
                </div>
                <div>
                  <dt className="font-semibold">{t("learn.overview.effort")}</dt>
                  <dd className="whitespace-pre-line text-sm">{version?.expected_effort?.trim() || t("learn.overview.notProvided")}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-semibold">{t("learn.overview.prerequisites")}</dt>
                  <dd className="whitespace-pre-line text-sm">{version?.prerequisites_text?.trim() || t("learn.overview.notProvided")}</dd>
                </div>
              </dl>
            </div>
          </Panel>

          <Panel aria-labelledby="overview-syllabus">
            <PanelHeader id="overview-syllabus" title={t("learn.overview.syllabus")} />
            <div className="px-4 py-4 sm:px-6">
              {hasText(version?.syllabus_html) ? (
                <RichText html={version?.syllabus_html} className="break-words [&_img]:h-auto [&_img]:max-w-full [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto" />
              ) : (
                <p className="text-sm text-muted">{t("learn.overview.noSyllabus")}</p>
              )}
            </div>
          </Panel>

          <Panel aria-labelledby="overview-grading">
            <PanelHeader id="overview-grading" title={t("learn.overview.grading")} />
            <div className="px-4 py-4 sm:px-6">
              <p className={version?.grading_policy?.trim() ? "whitespace-pre-line" : "text-sm text-muted"}>
                {version?.grading_policy?.trim() || t("learn.overview.noGrading")}
              </p>
            </div>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-6" aria-label={t("learn.overview.planTitle")}>
          <Panel aria-labelledby="overview-dates">
            <PanelHeader id="overview-dates" title={t("learn.overview.dates")} />
            <dl className="space-y-3 px-4 py-4 text-sm sm:px-6">
              <div>
                <dt className="font-semibold">{t("learn.overview.starts")}</dt>
                <dd>{offering.starts_at ? formatDateTime(offering.starts_at, tz) : t("learn.overview.notScheduled")}</dd>
              </div>
              <div>
                <dt className="font-semibold">{t("learn.overview.ends")}</dt>
                <dd>{offering.ends_at ? formatDateTime(offering.ends_at, tz) : t("learn.overview.notScheduled")}</dd>
              </div>
            </dl>
            <div className="space-y-1 px-4 text-sm text-muted sm:px-6">
              <p>{t("learn.overview.yourTimeZone", { tz })}</p>
              {courseTz !== tz ? (
                <p>
                  {t("learn.overview.courseTimeZone", { tz: courseTz })}
                  {offering.starts_at ? ` · ${formatDate(offering.starts_at, courseTz)} – ${formatDate(offering.ends_at, courseTz)}` : ""}
                </p>
              ) : null}
            </div>
            <dl className="space-y-3 px-4 py-4 text-sm sm:px-6">
              <div>
                <dt className="font-semibold">{t("learn.overview.cohort")}</dt>
                <dd>{offering.cohorts?.name ?? t("learn.overview.notProvided")}</dd>
              </div>
              {offering.term_label ? (
                <div>
                  <dt className="font-semibold">{t("learn.overview.term")}</dt>
                  <dd>{offering.term_label}</dd>
                </div>
              ) : null}
              <div>
                <dt className="font-semibold">{t("learn.overview.offeringCode")}</dt>
                <dd>{offering.code}</dd>
              </div>
              {offering.courses?.code ? (
                <div>
                  <dt className="font-semibold">{t("learn.overview.courseCode")}</dt>
                  <dd>{offering.courses.code}</dd>
                </div>
              ) : null}
            </dl>
          </Panel>

          <Panel aria-labelledby="overview-staff">
            <PanelHeader id="overview-staff" title={t("learn.overview.staff")} />
            <div className="px-4 py-4 sm:px-6">
              {staff.length === 0 ? (
                <p className="text-sm text-muted">{t("learn.overview.noStaff")}</p>
              ) : (
                <ul className="space-y-3">
                  {staff.map((s) => (
                    <li key={s.user_id} className="flex items-center gap-3">
                      <Avatar name={s.display_name} src={s.avatar_asset_id ? assetUrl(s.avatar_asset_id) : null} />
                      <div className="min-w-0">
                        <p className="break-words font-medium">{s.display_name}</p>
                        <p className="text-sm text-muted">{s.role === "instructor" ? t("learn.role.instructor") : t("learn.role.ta")}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          {staffView ? null : (
            <p className="flex items-center gap-2 text-sm text-muted">
              <BookOpenCheck aria-hidden="true" className="h-4 w-4" />
              <Link href={`/courses/${offeringId}/content`} className="text-primary underline underline-offset-2">{t("learn.next.browse")}</Link>
            </p>
          )}
        </aside>
      </div>
    </PageBody>
  );
}
