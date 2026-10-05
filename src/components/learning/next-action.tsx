import Link from "next/link";
import { ArrowRight, CheckCircle2, Lock } from "lucide-react";
import type { NextAction } from "@/lib/learning/outline";
import { ButtonLink } from "@/components/ui/button";
import { LockReasonList } from "./lock-reasons";
import { t } from "@/i18n";

/** The learner's next step: Start, Continue learning, a locked explanation, or all done. */
export function NextActionBlock({
  offeringId,
  action,
  tz,
  courseTz,
}: {
  offeringId: string;
  action: NextAction;
  tz: string;
  courseTz: string;
}) {
  const lessonHref = (id: string) => `/courses/${offeringId}/content/${id}`;
  const contentHref = `/courses/${offeringId}/content`;
  switch (action.kind) {
    case "empty":
      return <p className="text-sm text-muted">{t("learn.next.empty")}</p>;
    case "done":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="inline-flex items-center gap-2 font-medium">
            <CheckCircle2 aria-hidden="true" className="h-5 w-5 text-success" /> {t("learn.next.allDone")}
          </p>
          <Link href={contentHref} className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary underline underline-offset-2">
            {t("learn.next.review")} <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
      );
    case "optional":
      return (
        <div className="space-y-2">
          <p className="text-sm text-muted">{t("learn.progress.noRequired")}</p>
          <ButtonLink href={action.lesson ? lessonHref(action.lesson.id) : contentHref} variant="secondary">
            {t("learn.next.browse")} <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </ButtonLink>
        </div>
      );
    case "start":
    case "continue": {
      const label = action.kind === "start" ? t("learn.next.start") : t("learn.next.continue");
      const detail = action.kind === "start" ? t("learn.next.firstLabel", { title: action.lesson.title }) : t("learn.next.lessonLabel", { title: action.lesson.title });
      const detailId = `next-${action.lesson.id}`;
      return (
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href={lessonHref(action.lesson.id)} aria-describedby={detailId}>
            {label} <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </ButtonLink>
          <p id={detailId} className="min-w-0 break-words text-sm text-muted">{detail}</p>
        </div>
      );
    }
    case "locked":
      return (
        <div className="rounded-md border border-[#fde68a] bg-warning-soft px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <Lock aria-hidden="true" className="h-4 w-4" /> {t("learn.next.lockedTitle")}
          </p>
          <p className="mt-1">{t("learn.next.lockedLesson", { title: action.lesson.title })}</p>
          <LockReasonList reasons={action.lesson.lock_reasons} offeringId={offeringId} tz={tz} courseTz={courseTz} className="mt-1" />
        </div>
      );
  }
}
