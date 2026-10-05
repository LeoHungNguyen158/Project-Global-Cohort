import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { t, type MessageKey } from "@/i18n";
import type { AttemptStatus, LearnerQuizState } from "@/lib/domain/quiz";
import type { LearnerAssignmentState } from "@/lib/assessment/assignment-status";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const QUIZ_STATE: Record<LearnerQuizState, { key: MessageKey; tone: Tone }> = {
  not_started: { key: "quiz.status.notStarted", tone: "neutral" },
  in_progress: { key: "quiz.status.inProgress", tone: "info" },
  pending_manual: { key: "quiz.status.pendingManual", tone: "warning" },
  awaiting_release: { key: "quiz.status.awaitingRelease", tone: "neutral" },
  released: { key: "quiz.status.released", tone: "success" },
  voided: { key: "quiz.status.voided", tone: "danger" },
};

export function LearnerQuizStateBadge({ state }: { state: LearnerQuizState }) {
  const s = QUIZ_STATE[state];
  return <Badge tone={s.tone}>{t(s.key)}</Badge>;
}

const ATTEMPT: Record<AttemptStatus, { key: MessageKey; tone: Tone }> = {
  in_progress: { key: "quiz.attempt.inProgress", tone: "info" },
  submitted: { key: "quiz.attempt.submitted", tone: "warning" },
  graded: { key: "quiz.attempt.graded", tone: "success" },
  voided: { key: "quiz.attempt.voided", tone: "danger" },
};

export function AttemptStatusBadge({ status }: { status: AttemptStatus }) {
  const s = ATTEMPT[status] ?? ATTEMPT.in_progress;
  return <Badge tone={s.tone}>{t(s.key)}</Badge>;
}

export function ModeBadge({ practice }: { practice: boolean }) {
  return practice ? <Badge tone="info">{t("quiz.practice")}</Badge> : <Badge>{t("quiz.graded")}</Badge>;
}

const PUBLICATION: Record<string, { key: MessageKey; tone: Tone }> = {
  draft: { key: "quiz.state.draft", tone: "warning" },
  published: { key: "quiz.state.published", tone: "success" },
  archived: { key: "quiz.state.archived", tone: "neutral" },
};

export function PublicationBadge({ status, children }: { status: string; children?: ReactNode }) {
  const s = PUBLICATION[status] ?? PUBLICATION.draft;
  return (
    <Badge tone={s.tone}>
      {t(s.key)}
      {children}
    </Badge>
  );
}

const ASSIGNMENT: Record<LearnerAssignmentState, { key: MessageKey; tone: Tone }> = {
  not_started: { key: "assign.status.notStarted", tone: "neutral" },
  draft: { key: "assign.status.draft", tone: "warning" },
  submitted: { key: "assign.status.submitted", tone: "info" },
  late: { key: "assign.status.late", tone: "warning" },
  returned: { key: "assign.status.returned", tone: "danger" },
  graded_unreleased: { key: "assign.status.gradedUnreleased", tone: "neutral" },
  graded: { key: "assign.status.graded", tone: "success" },
};

export function AssignmentStateBadge({ state }: { state: LearnerAssignmentState }) {
  const s = ASSIGNMENT[state];
  return <Badge tone={s.tone}>{t(s.key)}</Badge>;
}

export function RoleNotice({ children }: { children: ReactNode }) {
  return <Badge tone="info">{children}</Badge>;
}
