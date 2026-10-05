import Link from "next/link";
import { Clock } from "lucide-react";
import type { OutlineLesson, OutlineModule } from "@/lib/learning/outline";
import { lessonStatus, requiredCounts } from "@/lib/learning/outline";
import { formatDate } from "@/lib/time";
import { ContentTypeIcon, contentTypeLabel, RequiredBadge, StatusBadge } from "./lesson-badges";
import { LockReasonList } from "./lock-reasons";
import { t } from "@/i18n";

/**
 * Ordered modules and lessons. Learners see their status, and for locked lessons the
 * precise unmet conditions with a link to resolve them. Staff see every lesson unlocked
 * plus the conditions configured for learners.
 */
export function CourseOutline({
  offeringId,
  modules,
  staffView,
  tz,
  courseTz,
  hideStartReason,
  conditions,
}: {
  offeringId: string;
  modules: OutlineModule[];
  staffView: boolean;
  tz: string;
  courseTz: string;
  /** The offering has not started: a banner says so, so rows do not repeat the start date. */
  hideStartReason: boolean;
  /** Staff only: descriptions of the conditions configured per lesson lineage. */
  conditions?: Map<string, string[]>;
}) {
  return (
    <ol className="space-y-6">
      {modules.map((m, i) => {
        const counts = requiredCounts(m.lessons);
        const headingId = `module-${m.id}`;
        return (
          <li key={m.id}>
            <section aria-labelledby={headingId} className="rounded-[var(--radius-panel)] border border-line bg-panel">
              <div className="border-b border-line px-4 py-3 sm:px-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("learn.content.module", { n: i + 1 })}</p>
                <h3 id={headingId} className="break-words text-lg font-semibold">{m.title}</h3>
                {m.description ? <p className="mt-1 text-sm text-muted">{m.description}</p> : null}
                <p className="mt-1 text-sm text-muted">
                  {m.lessons.length === 1 ? t("learn.content.lessonsOne") : t("learn.content.lessons", { count: m.lessons.length })}
                  {!staffView
                    ? ` · ${counts.total > 0 ? t("learn.content.moduleProgress", { done: counts.done, total: counts.total }) : t("learn.content.moduleNoRequired")}`
                    : ""}
                </p>
              </div>
              {m.lessons.length > 0 ? (
                <ol className="divide-y divide-line">
                  {m.lessons.map((l) => (
                    <LessonRow
                      key={l.id}
                      offeringId={offeringId}
                      lesson={l}
                      staffView={staffView}
                      tz={tz}
                      courseTz={courseTz}
                      hideStartReason={hideStartReason}
                      conditions={conditions?.get(l.lineage_id) ?? []}
                    />
                  ))}
                </ol>
              ) : null}
            </section>
          </li>
        );
      })}
    </ol>
  );
}

function LessonRow({
  offeringId,
  lesson,
  staffView,
  tz,
  courseTz,
  hideStartReason,
  conditions,
}: {
  offeringId: string;
  lesson: OutlineLesson;
  staffView: boolean;
  tz: string;
  courseTz: string;
  hideStartReason: boolean;
  conditions: string[];
}) {
  const status = lessonStatus(lesson);
  const reasons = hideStartReason ? lesson.lock_reasons.filter((r) => r.kind !== "offering_start") : lesson.lock_reasons;
  // Playback-rule lessons are "played": the platform records playback, not learning.
  const completedLabel = lesson.completed_at
    ? t(lesson.completion_rule === "video_watched" ? "learn.status.playedOn" : "learn.status.completedOn", { date: formatDate(lesson.completed_at, tz) })
    : undefined;
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-6">
      <div className="flex min-w-0 items-start gap-3">
        <ContentTypeIcon type={lesson.content_type} className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
        <div className="min-w-0">
          <Link
            href={`/courses/${offeringId}/content/${lesson.id}`}
            className="inline-flex min-h-10 items-center break-words font-medium text-primary underline-offset-2 hover:underline"
          >
            {lesson.title}
          </Link>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span>{contentTypeLabel(lesson.content_type)}</span>
            {lesson.duration_minutes !== null ? (
              <span className="inline-flex items-center gap-1">
                <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                <span aria-hidden="true">{t("learn.lesson.minutes", { count: lesson.duration_minutes })}</span>
                <span className="sr-only">{t("learn.lesson.duration", { count: lesson.duration_minutes })}</span>
              </span>
            ) : null}
          </p>
          {!staffView && status === "locked" && reasons.length > 0 ? (
            <div className="mt-1 text-sm">
              <p className="font-medium">{t("learn.content.whyLocked")}</p>
              <LockReasonList reasons={reasons} offeringId={offeringId} tz={tz} courseTz={courseTz} />
            </div>
          ) : null}
          {staffView && conditions.length > 0 ? (
            <div className="mt-1 text-sm">
              <p className="font-medium">{t("learn.content.staffConditions")}</p>
              <ul className="list-disc pl-5 text-muted">
                {conditions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-8 sm:justify-end sm:pl-0">
        <RequiredBadge required={lesson.required} />
        {!staffView ? <StatusBadge status={status} completedLabel={completedLabel} /> : null}
      </div>
    </li>
  );
}
