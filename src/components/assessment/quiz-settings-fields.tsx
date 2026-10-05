import { DateTimeField } from "@/components/ui/datetime-field";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { t } from "@/i18n";
import type { QuizRow } from "@/lib/assessment/quiz-data";

/**
 * Quiz settings inputs shared by the create and edit forms (server component; render
 * inside an ActionForm). Multiple-select scoring is shown as the one rule the platform
 * supports rather than as a choice that would do nothing.
 */
export function QuizSettingsFields({
  quiz,
  gradePoints,
  practice,
  tz,
  scoringLocked,
}: {
  quiz?: QuizRow | null;
  gradePoints: number;
  practice: boolean;
  tz: string;
  scoringLocked?: boolean;
}) {
  return (
    <div className="space-y-5">
      <Field label={t("quiz.author.field.title")} htmlFor="quiz-title" required>
        <Input id="quiz-title" name="title" defaultValue={quiz?.title ?? ""} required maxLength={300} />
      </Field>

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{t("quiz.author.field.mode")}</legend>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="radio" name="mode" value="graded" defaultChecked={!practice} className="h-4 w-4 accent-[var(--color-primary)]" />
          {t("quiz.author.field.modeGraded")}
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="radio" name="mode" value="practice" defaultChecked={practice} className="h-4 w-4 accent-[var(--color-primary)]" />
          {t("quiz.author.field.modePractice")}
        </label>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("quiz.author.field.gradePoints")} htmlFor="quiz-grade-points" hint={t("quiz.author.field.gradePointsHint")} required>
          <Input id="quiz-grade-points" name="grade_points" type="number" inputMode="decimal" min={0.01} max={10000} step={0.01} defaultValue={gradePoints} required aria-describedby="quiz-grade-points-hint" />
        </Field>
        <Field label={t("quiz.author.field.passPct")} htmlFor="quiz-pass" required>
          <Input id="quiz-pass" name="pass_pct" type="number" inputMode="decimal" min={0} max={100} step={0.01} defaultValue={quiz?.pass_pct ?? 70} required />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <DateTimeField name="available_from" label={t("quiz.author.field.opens")} tz={tz} defaultValue={quiz?.available_from ?? null} hint={t("quiz.author.field.opensHint")} />
        <DateTimeField name="closes_at" label={t("quiz.author.field.closes")} tz={tz} defaultValue={quiz?.closes_at ?? null} hint={t("quiz.author.field.closesHint")} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("quiz.author.field.timeLimit")} htmlFor="quiz-time-limit" hint={t("quiz.author.field.timeLimitHint")}>
          <Input id="quiz-time-limit" name="time_limit_minutes" type="number" inputMode="numeric" min={1} max={1440} step={1} defaultValue={quiz?.time_limit_minutes ?? ""} aria-describedby="quiz-time-limit-hint" />
        </Field>
        <Field label={t("quiz.author.field.attemptLimit")} htmlFor="quiz-attempts" required>
          <Input id="quiz-attempts" name="attempt_limit" type="number" inputMode="numeric" min={1} max={100} step={1} defaultValue={quiz?.attempt_limit ?? 1} required />
        </Field>
      </div>

      <div>
        <Checkbox name="truncate_at_close" label={t("quiz.author.field.truncate")} defaultChecked={quiz?.truncate_at_close ?? true} aria-describedby="quiz-truncate-hint" />
        <p id="quiz-truncate-hint" className="ml-6 text-xs text-muted">{t("quiz.author.field.truncateHint")}</p>
        <Checkbox name="shuffle_questions" label={t("quiz.author.field.shuffleQuestions")} defaultChecked={quiz?.shuffle_questions ?? false} />
        <Checkbox name="shuffle_choices" label={t("quiz.author.field.shuffleChoices")} defaultChecked={quiz?.shuffle_choices ?? false} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("quiz.author.field.review")} htmlFor="quiz-review">
          <Select id="quiz-review" name="review_policy" defaultValue={quiz?.review_policy ?? "after_close"}>
            <option value="after_submit">{t("quiz.author.review.afterSubmit")}</option>
            <option value="after_close">{t("quiz.author.review.afterClose")}</option>
            <option value="manual">{t("quiz.author.review.manual")}</option>
            <option value="never">{t("quiz.author.review.never")}</option>
          </Select>
        </Field>
        <Field label={t("quiz.author.field.scoreRelease")} htmlFor="quiz-release">
          <Select id="quiz-release" name="score_release" defaultValue={quiz?.score_release ?? "manual"}>
            <option value="manual">{t("quiz.author.scoreRelease.manual")}</option>
            <option value="immediate">{t("quiz.author.scoreRelease.immediate")}</option>
          </Select>
        </Field>
        <Field label={t("quiz.author.field.scoringRule")} htmlFor="quiz-scoring" hint={scoringLocked ? t("quiz.author.scoringLocked") : undefined}>
          {scoringLocked ? (
            <>
              <Select id="quiz-scoring" defaultValue={quiz?.scoring_rule ?? "highest"} disabled aria-describedby="quiz-scoring-hint">
                <option value="highest">{t("quiz.author.scoring.highest")}</option>
                <option value="latest">{t("quiz.author.scoring.latest")}</option>
              </Select>
              <input type="hidden" name="scoring_rule" value={quiz?.scoring_rule ?? "highest"} />
            </>
          ) : (
            <Select id="quiz-scoring" name="scoring_rule" defaultValue={quiz?.scoring_rule ?? "highest"}>
              <option value="highest">{t("quiz.author.scoring.highest")}</option>
              <option value="latest">{t("quiz.author.scoring.latest")}</option>
            </Select>
          )}
        </Field>
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("quiz.author.field.mcScoring")}</p>
          <p className="flex min-h-10 items-center rounded-md border border-line bg-canvas px-3 text-sm">{t("quiz.author.mcScoring.allOrNothing")}</p>
          <p className="text-xs text-muted">{t("quiz.author.mcScoringHint")}</p>
        </div>
      </div>
    </div>
  );
}
