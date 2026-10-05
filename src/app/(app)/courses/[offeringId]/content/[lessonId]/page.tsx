import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye, Lock } from "lucide-react";
import { requireOffering } from "@/lib/data/offering-access";
import { isUuid } from "@/lib/forms";
import { formatDateTime } from "@/lib/time";
import { findLessonContext, lessonStatus } from "@/lib/learning/outline";
import { loadLessonAssets, loadLessonContent, loadMyLessonProgress, loadOutline } from "@/lib/learning/data";
import { completionMode } from "@/lib/learning/completion";
import { assetKind } from "@/lib/learning/assets";
import { LessonViewer } from "@/components/learning/lesson-viewer";
import { LessonHeader, LessonNav } from "@/components/learning/lesson-chrome";
import { LockReasonList } from "@/components/learning/lock-reasons";
import { PageBody } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { t } from "@/i18n";

type Params = { offeringId: string; lessonId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { offeringId, lessonId } = await params;
  await requireOffering(offeringId);
  const { outline } = await loadOutline(offeringId);
  const ctx = findLessonContext(outline.modules, lessonId);
  return ctx ? { title: ctx.lesson.title } : {};
}

export default async function LessonPage({ params }: { params: Promise<Params> }) {
  const { offeringId, lessonId } = await params;
  const access = await requireOffering(offeringId);
  if (!isUuid(lessonId)) notFound();
  const { offering, user } = access;
  const tz = user.timezone;

  // Only lessons of the version this offering uses; anything else is not part of the course.
  const { outline } = await loadOutline(offeringId);
  const ctx = findLessonContext(outline.modules, lessonId);
  if (!ctx) notFound();

  const staffView = access.isStaffView;
  const lessonHref = (id: string) => `/courses/${offeringId}/content/${id}`;
  const status = staffView ? null : lessonStatus(ctx.lesson);
  const context = `${t("learn.lesson.inModule", { title: ctx.module.title })} · ${t("learn.lesson.position", { n: ctx.number, total: ctx.total })}`;
  const nav = (
    <LessonNav
      prev={ctx.prev ? { href: lessonHref(ctx.prev.id), title: ctx.prev.title, locked: !staffView && lessonStatus(ctx.prev) === "locked" } : null}
      next={ctx.next ? { href: lessonHref(ctx.next.id), title: ctx.next.title, locked: !staffView && lessonStatus(ctx.next) === "locked" } : null}
      back={{ href: `/courses/${offeringId}/content`, label: t("learn.lesson.backToOutline") }}
    />
  );
  const header = (completedLabel?: string) => (
    <LessonHeader
      id="lesson-title"
      title={ctx.lesson.title}
      context={context}
      contentType={ctx.lesson.content_type}
      required={ctx.lesson.required}
      durationMinutes={ctx.lesson.duration_minutes}
      status={status}
      completedLabel={completedLabel}
    />
  );
  const backLink = (
    <Link href={`/courses/${offeringId}/content`} className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary underline underline-offset-2">
      <ArrowLeft aria-hidden="true" className="h-4 w-4" /> {t("learn.lesson.backToOutline")}
    </Link>
  );

  // Locked for this learner: the server refuses the content and its files, so only the
  // conditions (and where to meet them) are shown.
  if (!staffView && ctx.lesson.lock_reasons.length > 0) {
    const completedAt = ctx.lesson.completed_at;
    return (
      <PageBody>
        <article aria-labelledby="lesson-title" className="mx-auto max-w-4xl space-y-6">
          {backLink}
          {header()}
          <section aria-labelledby="lesson-locked" className="rounded-[var(--radius-panel)] border border-[#fde68a] bg-warning-soft p-4 sm:p-6">
            <h3 id="lesson-locked" className="flex items-center gap-2 text-lg font-semibold">
              <Lock aria-hidden="true" className="h-5 w-5" /> {t("learn.lesson.lockedTitle")}
            </h3>
            <p className="mt-2 text-sm">
              {completedAt ? t("learn.lesson.lockedCompleted", { date: formatDateTime(completedAt, tz) }) : t("learn.lesson.lockedIntro")}
            </p>
            <LockReasonList reasons={ctx.lesson.lock_reasons} offeringId={offeringId} tz={tz} courseTz={offering.timezone} className="mt-3" />
          </section>
          {nav}
        </article>
      </PageBody>
    );
  }

  const lesson = await loadLessonContent(lessonId);
  if (!lesson) {
    return (
      <PageBody>
        <article aria-labelledby="lesson-title" className="mx-auto max-w-4xl space-y-6">
          {backLink}
          {header()}
          <Alert tone="warning">{t("learn.lesson.notAvailable")}</Alert>
          {nav}
        </article>
      </PageBody>
    );
  }

  const [assets, progress] = await Promise.all([
    loadLessonAssets(lessonId),
    staffView ? Promise.resolve(null) : loadMyLessonProgress(offeringId, lesson.lineage_id, user.id),
  ]);
  const hasVideo = assets.some((a) => a.role === "primary" && a.status === "ready" && assetKind(a.mime) === "video");
  const played = completionMode(lesson.completion_rule, hasVideo) === "played";
  const doneLabel = progress?.completed_at
    ? t(played ? "learn.complete.donePlayed" : "learn.complete.doneAck", { date: formatDateTime(progress.completed_at, tz) })
    : null;
  const disabledReason = staffView
    ? t("learn.complete.staffDisabled")
    : offering.status === "archived"
      ? t("learn.complete.closed")
      : !access.isActiveLearner
        ? t("learn.complete.notActive")
        : null;
  const record = !staffView && access.isActiveLearner;

  return (
    <PageBody>
      <article aria-labelledby="lesson-title" className="mx-auto max-w-4xl space-y-6">
        {backLink}
        {header(played ? t("learn.status.played") : undefined)}
        {staffView ? (
          <div role="note" className="flex gap-3 rounded-md border border-[#c7d6fb] bg-primary-soft px-4 py-3 text-sm">
            <Eye aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">{t("learn.preview.staff")}</p>
              <p>{t("learn.preview.staffDetail")}</p>
            </div>
          </div>
        ) : null}
        <LessonViewer
          offeringId={offeringId}
          lesson={lesson}
          assets={assets}
          record={record}
          progress={progress}
          completion={{ doneLabel, disabledReason }}
        />
        {nav}
      </article>
    </PageBody>
  );
}
