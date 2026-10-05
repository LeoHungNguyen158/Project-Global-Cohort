"use client";
import { useState } from "react";
import Decimal from "decimal.js";
import { gradeSubmission } from "@/app/actions/assignments";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/components/ui/cn";
import { t } from "@/i18n/client/assessment";
import { formatPoints } from "@/lib/domain/grades";
import type { RubricCriterion } from "@/lib/assessment/rubric";

/**
 * Grades one submitted version. With a rubric, each criterion is scored (levels fill the
 * score in one click) and the total is their sum; without one, points are entered directly.
 * The version number goes with the grade so a newer submission is never graded unseen.
 */
export function SubmissionGrader({
  submissionId,
  versionNo,
  maxPoints,
  rubric,
  initialScores,
  initialPoints,
  initialFeedback,
}: {
  submissionId: string;
  versionNo: number;
  maxPoints: number;
  rubric: RubricCriterion[];
  initialScores: Record<string, number>;
  initialPoints: number | null;
  initialFeedback: string;
}) {
  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(rubric.map((c) => [c.id, initialScores[c.id] === undefined ? "" : String(initialScores[c.id])])),
  );
  let total = new Decimal(0);
  let complete = rubric.length > 0;
  for (const c of rubric) {
    const v = scores[c.id];
    const n = v === undefined || v.trim() === "" ? NaN : Number(v);
    if (Number.isFinite(n)) total = total.plus(n);
    else complete = false;
  }

  return (
    <ActionForm action={gradeSubmission}>
      <input type="hidden" name="submission_id" value={submissionId} />
      <input type="hidden" name="version_no" value={versionNo} />
      <div className="space-y-4">
        {rubric.length > 0 ? (
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold">{t("assign.grade.rubricScoring")}</legend>
            {rubric.map((c) => {
              const id = `score-${c.id}`;
              const current = scores[c.id] ?? "";
              return (
                <div key={c.id} className="space-y-2 rounded-md border border-line px-3 py-3">
                  <Field label={t("assign.grade.criterionScore", { criterion: c.criterion, max: formatPoints(c.points) })} htmlFor={id} required hint={c.description || undefined}>
                    <Input
                      id={id}
                      name={`criterion_${c.id}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={c.points}
                      step={0.01}
                      required
                      value={current}
                      onChange={(e) => setScores((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      aria-describedby={c.description ? `${id}-hint` : undefined}
                      className="sm:max-w-40"
                    />
                  </Field>
                  {c.levels.length > 0 ? (
                    <div role="group" aria-label={t("assign.grade.rubricLevels", { criterion: c.criterion })} className="flex flex-wrap gap-2">
                      {c.levels.map((l) => {
                        const pressed = current.trim() !== "" && Number.isFinite(Number(current)) && new Decimal(current).eq(l.points);
                        return (
                          <button
                            key={l.id}
                            type="button"
                            aria-pressed={pressed}
                            title={l.description || undefined}
                            onClick={() => setScores((prev) => ({ ...prev, [c.id]: String(l.points) }))}
                            className={cn(
                              "inline-flex min-h-10 items-center rounded-md border px-3 text-left text-sm",
                              pressed ? "border-primary bg-primary-soft font-semibold text-ink" : "border-line bg-panel text-ink hover:bg-canvas",
                            )}
                          >
                            {t("assign.grade.levelButton", { label: l.label, points: formatPoints(l.points) })}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <p className="text-sm font-semibold" aria-live="polite">
              {t("assign.grade.total", { total: complete ? formatPoints(total.toDecimalPlaces(2).toNumber()) : "–", max: formatPoints(maxPoints) })}
            </p>
          </fieldset>
        ) : (
          <Field label={t("assign.grade.pointsLabel", { max: formatPoints(maxPoints) })} htmlFor="grade-points" required>
            <Input
              id="grade-points"
              name="points"
              type="number"
              inputMode="decimal"
              min={0}
              max={maxPoints}
              step={0.01}
              required
              defaultValue={initialPoints ?? ""}
              className="sm:max-w-40"
            />
          </Field>
        )}
        <Field label={t("assign.grade.feedbackLabel")} htmlFor="grade-feedback">
          <Textarea id="grade-feedback" name="feedback" rows={6} maxLength={20000} defaultValue={initialFeedback} />
        </Field>
        <SubmitButton pendingText={t("assign.author.saving")}>{t("assign.grade.save")}</SubmitButton>
      </div>
    </ActionForm>
  );
}
