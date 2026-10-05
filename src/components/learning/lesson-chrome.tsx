import Link from "next/link";
import { ArrowLeft, ArrowRight, Clock, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LessonContentType, LessonStatus } from "@/lib/learning/outline";
import { ContentTypeIcon, contentTypeLabel, RequiredBadge, StatusBadge } from "./lesson-badges";
import { t } from "@/i18n";

/** Lesson title block: where the lesson sits in the course and its type, requirement and status. */
export function LessonHeader({
  id,
  title,
  context,
  contentType,
  required,
  durationMinutes,
  status,
  completedLabel,
}: {
  id: string;
  title: string;
  /** e.g. "Module: Getting started · Lesson 3 of 8". */
  context: string;
  contentType: LessonContentType;
  required: boolean;
  durationMinutes: number | null;
  status?: LessonStatus | null;
  completedLabel?: string;
}) {
  return (
    <header className="space-y-2">
      <p className="text-sm text-muted">{context}</p>
      <h2 id={id} className="break-words text-2xl font-semibold leading-tight">{title}</h2>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge>
          <ContentTypeIcon type={contentType} className="h-3.5 w-3.5" /> {contentTypeLabel(contentType)}
        </Badge>
        <RequiredBadge required={required} />
        {durationMinutes !== null ? (
          <span className="inline-flex items-center gap-1 text-muted" title={t("learn.lesson.duration", { count: durationMinutes })}>
            <Clock aria-hidden="true" className="h-3.5 w-3.5" />
            <span aria-hidden="true">{t("learn.lesson.minutes", { count: durationMinutes })}</span>
            <span className="sr-only">{t("learn.lesson.duration", { count: durationMinutes })}</span>
          </span>
        ) : null}
        {status ? <StatusBadge status={status} completedLabel={completedLabel} /> : null}
      </div>
    </header>
  );
}

export type LessonLink = { href: string; title: string; locked?: boolean };

/** Previous / next lesson and the way back to the outline. */
export function LessonNav({ prev, next, back }: { prev: LessonLink | null; next: LessonLink | null; back: { href: string; label: string } }) {
  return (
    <nav aria-label={t("learn.lesson.nav")} className="space-y-3 border-t border-line pt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {prev ? (
          <Link href={prev.href} className="flex min-h-11 items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 hover:bg-canvas">
            <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="min-w-0">
              <span className="block text-xs text-muted">{t("learn.lesson.prev")}</span>
              <span className="block break-words font-medium">{prev.title}</span>
            </span>
            {prev.locked ? <LockedMark /> : null}
          </Link>
        ) : (
          <span className="hidden sm:block" />
        )}
        {next ? (
          <Link href={next.href} className="flex min-h-11 items-center justify-end gap-2 rounded-md border border-line bg-panel px-3 py-2 text-right hover:bg-canvas">
            {next.locked ? <LockedMark /> : null}
            <span className="min-w-0">
              <span className="block text-xs text-muted">{t("learn.lesson.next")}</span>
              <span className="block break-words font-medium">{next.title}</span>
            </span>
            <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
          </Link>
        ) : null}
      </div>
      <Link href={back.href} className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary underline underline-offset-2">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" /> {back.label}
      </Link>
    </nav>
  );
}

function LockedMark() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-warning">
      <Lock aria-hidden="true" className="h-3.5 w-3.5" /> {t("learn.status.locked")}
    </span>
  );
}
