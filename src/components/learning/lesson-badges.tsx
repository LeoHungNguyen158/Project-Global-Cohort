import { CheckCircle2, Circle, CircleDot, Download, ExternalLink, FileText, Lock, MonitorPlay, PlayCircle, ScrollText, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { t } from "@/i18n";
import type { LessonContentType } from "@/lib/learning/outline";
import type { LessonStatus } from "@/lib/learning/outline";

const TYPE_ICONS: Record<LessonContentType, LucideIcon> = {
  text: ScrollText,
  pdf: FileText,
  video: PlayCircle,
  file: Download,
  link: ExternalLink,
  embed: MonitorPlay,
};

const TYPE_LABELS = {
  text: "learn.type.text",
  pdf: "learn.type.pdf",
  video: "learn.type.video",
  file: "learn.type.file",
  link: "learn.type.link",
  embed: "learn.type.embed",
} as const;

export function contentTypeLabel(type: LessonContentType): string {
  return t(TYPE_LABELS[type]);
}

export function ContentTypeIcon({ type, className = "h-5 w-5" }: { type: LessonContentType; className?: string }) {
  const Icon = TYPE_ICONS[type] ?? ScrollText;
  return <Icon aria-hidden="true" className={className} />;
}

export function RequiredBadge({ required }: { required: boolean }) {
  return required ? <Badge tone="info">{t("learn.lesson.required")}</Badge> : <Badge>{t("learn.lesson.optional")}</Badge>;
}

/** Lesson status with an icon and text, so status never depends on color alone. */
export function StatusBadge({ status, completedLabel }: { status: LessonStatus; completedLabel?: string }) {
  switch (status) {
    case "completed":
      return (
        <Badge tone="success">
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" /> {completedLabel ?? t("learn.status.completed")}
        </Badge>
      );
    case "in_progress":
      return (
        <Badge tone="info">
          <CircleDot aria-hidden="true" className="h-3.5 w-3.5" /> {t("learn.status.inProgress")}
        </Badge>
      );
    case "locked":
      return (
        <Badge tone="warning">
          <Lock aria-hidden="true" className="h-3.5 w-3.5" /> {t("learn.status.locked")}
        </Badge>
      );
    default:
      return (
        <Badge>
          <Circle aria-hidden="true" className="h-3.5 w-3.5" /> {t("learn.status.notStarted")}
        </Badge>
      );
  }
}
