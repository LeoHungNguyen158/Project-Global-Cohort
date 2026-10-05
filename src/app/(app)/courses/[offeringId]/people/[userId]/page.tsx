import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, KeyRound } from "lucide-react";
import { requireOffering } from "@/lib/data/offering-access";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/forms";
import { formatDate, formatDateTime } from "@/lib/time";
import { describeLockReason } from "@/lib/domain/prerequisites";
import { parseLearnerOutline, lessonStatus, requiredCounts, type LearnerLessonState } from "@/lib/learning/outline";
import { formatClock } from "@/lib/learning/completion";
import { LIMITS } from "@/lib/learning/validate";
import { assetUrl } from "@/lib/learning/data";
import { grantOverride, revokeOverride } from "@/app/actions/learning";
import { StatusBadge } from "@/components/learning/lesson-badges";
import { ProgressMeter } from "@/components/learning/progress-meter";
import { ActionNotice } from "@/components/learning/authoring/action-notice";
import { parseNotice } from "@/lib/learning/notices";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { td, th } from "@/components/ui/table";
import { ScrollTable } from "@/components/learning/scroll-table";
import { t } from "@/i18n";

type Params = { offeringId: string; userId: string };

type OverrideRow = {
  id: string;
  target_lesson_lineage: string;
  reason: string;
  created_at: string;
  revoked_at: string | null;
  granter: { display_name: string } | null;
};

const STATUS_LABEL = {
  active: "people.enrollment.active",
  completed: "people.enrollment.completed",
  suspended: "people.enrollment.suspended",
  withdrawn: "people.enrollment.withdrawn",
} as const;

async function loadName(userId: string): Promise<{ name: string; avatar: string | null } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("display_name, avatar_asset_id").eq("id", userId).maybeSingle();
  return data ? { name: data.display_name as string, avatar: (data.avatar_asset_id as string | null) ?? null } : null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { offeringId, userId } = await params;
  const access = await requireOffering(offeringId);
  if (!access.isStaffView || !isUuid(userId)) return {};
  const person = await loadName(userId);
  return person ? { title: t("people.detail.title", { name: person.name }) } : {};
}

/** Staff view of one learner: lesson states, locks and overrides (no contact details). */
export default async function LearnerProgressPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ notice?: string }> }) {
  const { offeringId, userId } = await params;
  const notice = parseNotice((await searchParams).notice);
  const access = await requireOffering(offeringId);
  if (!access.isStaffView || !isUuid(userId)) notFound();
  const { offering, user } = access;
  const tz = user.timezone;
  const supabase = await createClient();

  const [outlineRes, person, overridesRes] = await Promise.all([
    supabase.rpc("learner_outline", { p_offering: offeringId, p_user: userId }),
    loadName(userId),
    supabase
      .from("prerequisite_overrides")
      .select("id, target_lesson_lineage, reason, created_at, revoked_at, granter:profiles!prerequisite_overrides_granted_by_fkey(display_name)")
      .eq("offering_id", offeringId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);
  // Not enrolled here (or not visible): the same 404 as an unknown page.
  if (outlineRes.error || !outlineRes.data || !person) notFound();
  const outline = parseLearnerOutline(outlineRes.data);
  const lessons = outline.modules.flatMap((m) => m.lessons);
  const counts = requiredCounts(lessons);
  const overrides = (overridesRes.data ?? []) as unknown as OverrideRow[];
  const titles = new Map(lessons.map((l) => [l.lineage_id, l.title]));
  const archived = offering.status === "archived";
  const canOverride = access.canAuthor && !archived;
  const statusKey = STATUS_LABEL[outline.enrollmentStatus as keyof typeof STATUS_LABEL] ?? "people.enrollment.active";

  return (
    <PageBody>
      <div className="mx-auto max-w-6xl space-y-6">
        <Link href={`/courses/${offeringId}/people`} className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary underline underline-offset-2">
          <ArrowLeft aria-hidden="true" className="h-4 w-4" /> {t("people.detail.back")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name={person.name} src={person.avatar ? assetUrl(person.avatar) : null} size={44} />
          <h2 className="break-words text-xl font-semibold">{t("people.detail.title", { name: person.name })}</h2>
          <Badge tone={outline.enrollmentStatus === "active" ? "info" : outline.enrollmentStatus === "completed" ? "success" : "warning"}>{t(statusKey)}</Badge>
        </div>
        <ActionNotice message={notice === "overrideRevoked" ? t("people.detail.revoked") : null} />

        <Panel aria-labelledby="learner-summary">
          <PanelHeader id="learner-summary" title={t("people.detail.summary")} level={3} />
          <div className="px-4 py-4 sm:px-6">
            {counts.total > 0 ? <ProgressMeter done={counts.done} total={counts.total} /> : <p className="text-sm text-muted">{t("learn.progress.noRequired")}</p>}
          </div>
        </Panel>

        <section aria-labelledby="learner-lessons" className="space-y-3">
          <h3 id="learner-lessons" className="text-lg font-semibold">{t("people.detail.lessons")}</h3>
          {lessons.length === 0 ? (
            <EmptyState title={t("people.detail.noLessons")} />
          ) : (
            <ScrollTable caption={t("people.detail.caption", { name: person.name })}>
              <thead>
                <tr>
                  <th scope="col" className={th}>{t("people.detail.col.lesson")}</th>
                  <th scope="col" className={th}>{t("people.detail.col.status")}</th>
                  <th scope="col" className={th}>{t("people.detail.col.access")}</th>
                  <th scope="col" className={th}>{t("people.detail.col.activity")}</th>
                </tr>
              </thead>
              <tbody>
                {lessons.map((l) => (
                  <LessonStateRow key={l.id} lesson={l} offeringId={offeringId} tz={tz} courseTz={offering.timezone} />
                ))}
              </tbody>
            </ScrollTable>
          )}
        </section>

        <section aria-labelledby="learner-overrides" className="space-y-3">
          <h3 id="learner-overrides" className="text-lg font-semibold">{t("people.detail.overridesTitle")}</h3>
          {overrides.length === 0 ? (
            <p className="text-sm text-muted">{t("people.detail.noOverrides")}</p>
          ) : (
            <ScrollTable caption={t("people.detail.overridesCaption", { name: person.name })}>
              <thead>
                <tr>
                  <th scope="col" className={th}>{t("people.detail.col.lesson")}</th>
                  <th scope="col" className={th}>{t("people.detail.col.reason")}</th>
                  <th scope="col" className={th}>{t("people.detail.col.grantedBy")}</th>
                  <th scope="col" className={th}>{t("people.detail.col.state")}</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => {
                  const title = titles.get(o.target_lesson_lineage) ?? t("learn.lock.previousLesson");
                  return (
                    <tr key={o.id}>
                      <th scope="row" className={`${td} font-medium`}>{title}</th>
                      <td className={`${td} max-w-xs whitespace-pre-line break-words`}>{o.reason}</td>
                      <td className={`${td} text-sm`}>{t("people.detail.grantedBy", { name: o.granter?.display_name ?? t("people.unknown"), date: formatDateTime(o.created_at, tz) })}</td>
                      <td className={td}>
                        <div className="flex flex-wrap items-center gap-2">
                          {o.revoked_at ? (
                            <Badge>{t("people.detail.statusRevoked", { date: formatDateTime(o.revoked_at, tz) })}</Badge>
                          ) : (
                            <Badge tone="success">{t("people.detail.statusActive")}</Badge>
                          )}
                          {!o.revoked_at && canOverride ? (
                            <ConfirmForm
                              action={revokeOverride}
                              fields={{ offeringId, overrideId: o.id }}
                              trigger={
                                <>
                                  {t("people.detail.revoke")}
                                  <span className="sr-only">: {t("people.detail.revokeNamed", { title })}</span>
                                </>
                              }
                              size="sm"
                              tone="danger"
                              title={t("people.detail.revokeTitle")}
                              description={t("people.detail.revokeBody")}
                              confirmLabel={t("people.detail.revoke")}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </ScrollTable>
          )}
        </section>

        <Panel aria-labelledby="grant-override" id="grant-override-panel">
          <PanelHeader id="grant-override" title={t("people.detail.grantTitle")} level={3} />
          <div className="space-y-3 px-4 py-4 sm:px-6">
            <p className="text-sm">{t("people.detail.grantHelp")}</p>
            {!access.canAuthor ? (
              <p className="text-sm text-muted">{t("people.overrideNeedsAuthor")}</p>
            ) : archived ? (
              <p className="text-sm text-muted">{t("author.rules.archived")}</p>
            ) : lessons.length === 0 ? (
              <p className="text-sm text-muted">{t("people.detail.noLessons")}</p>
            ) : (
              <ActionForm action={grantOverride} resetOnSuccess className="space-y-3">
                <input type="hidden" name="offeringId" value={offeringId} />
                <input type="hidden" name="userId" value={userId} />
                <Field label={t("people.detail.lesson")} htmlFor="override-lesson" required>
                  <Select id="override-lesson" name="lineage" required defaultValue={lessons.find((l) => l.lock_reasons.length > 0)?.lineage_id ?? ""}>
                    <option value="" disabled>{t("author.rules.choose")}</option>
                    {outline.modules.map((m, i) => (
                      <optgroup key={m.id} label={`${t("learn.content.module", { n: i + 1 })}: ${m.title}`}>
                        {m.lessons.map((l) => (
                          <option key={l.lineage_id} value={l.lineage_id}>
                            {l.lock_reasons.length > 0 ? t("people.detail.lessonLocked", { title: l.title }) : l.title}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </Field>
                <Field label={t("people.detail.reason")} htmlFor="override-reason" hint={t("people.detail.reasonHint")} required>
                  <Textarea id="override-reason" name="reason" required minLength={3} maxLength={LIMITS.reason} rows={3} aria-describedby="override-reason-hint" />
                </Field>
                <SubmitButton>
                  <KeyRound aria-hidden="true" className="h-4 w-4" /> {t("people.detail.grant")}
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        </Panel>
      </div>
    </PageBody>
  );
}

function LessonStateRow({ lesson: l, offeringId, tz, courseTz }: { lesson: LearnerLessonState; offeringId: string; tz: string; courseTz: string }) {
  const status = lessonStatus(l);
  const progressStatus = status === "locked" ? (l.started_at ? "in_progress" : "not_started") : status;
  const describe = (r: LearnerLessonState["lock_reasons"][number]) => describeLockReason(r, { offeringId, tz, courseTz }).text;
  return (
    <tr>
      <th scope="row" className={`${td} font-medium`}>
        <span className="break-words">{l.title}</span>
      </th>
      <td className={td}>
        <StatusBadge
          status={progressStatus}
          completedLabel={
            l.completed_at
              ? t(l.completion_rule === "video_watched" ? "learn.status.playedOn" : "learn.status.completedOn", { date: formatDate(l.completed_at, tz) })
              : undefined
          }
        />
        {l.duration_seconds && l.max_position_seconds !== null ? (
          <p className="mt-1 text-xs text-muted">
            {t("people.detail.played", { time: formatClock(l.max_position_seconds), duration: formatClock(l.duration_seconds) })}
          </p>
        ) : null}
      </td>
      <td className={`${td} text-sm`}>
        {l.override_id ? (
          <>
            <Badge tone="info">{t("people.detail.unlockedByOverride")}</Badge>
            {l.rule_reasons.length > 0 ? (
              <div className="mt-1">
                <p className="text-xs font-medium">{t("people.detail.bypasses")}</p>
                <ul className="list-disc pl-5 text-xs text-muted">
                  {l.rule_reasons.map((r, i) => (
                    <li key={i}>{describe(r)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : l.lock_reasons.length > 0 ? (
          <>
            <StatusBadge status="locked" />
            <ul className="mt-1 list-disc pl-5 text-xs text-muted">
              {l.lock_reasons.map((r, i) => (
                <li key={i}>{describe(r)}</li>
              ))}
            </ul>
          </>
        ) : (
          <span>{t("people.detail.unlocked")}</span>
        )}
      </td>
      <td className={`${td} whitespace-nowrap text-sm`}>{l.updated_at ? formatDateTime(l.updated_at, tz) : <span className="text-muted">{t("people.detail.noActivity")}</span>}</td>
    </tr>
  );
}
