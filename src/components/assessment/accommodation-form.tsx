import { setAccommodation } from "@/app/actions/quizzes";
import { ActionForm } from "@/components/ui/action-form";
import { DateTimeField } from "@/components/ui/datetime-field";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { t } from "@/i18n";

export type AccommodationValues = {
  user_id: string;
  extra_minutes: number;
  extra_attempts: number;
  extended_closes_at: string | null;
  note: string;
};

/** Grant or change one learner's accommodation (instructors and administrators only; the database checks). */
export function AccommodationForm({
  quizId,
  learners,
  current,
  tz,
  hasCloseDate,
  idPrefix,
}: {
  quizId: string;
  learners: { user_id: string; name: string }[];
  current?: AccommodationValues;
  tz: string;
  hasCloseDate: boolean;
  idPrefix: string;
}) {
  const id = (s: string) => `${idPrefix}-${s}`;
  return (
    <ActionForm action={setAccommodation} className="space-y-4">
      <input type="hidden" name="quiz_id" value={quizId} />
      {current ? (
        <input type="hidden" name="user_id" value={current.user_id} />
      ) : (
        <Field label={t("quiz.grade.acc.learner")} htmlFor={id("learner")} required>
          <Select id={id("learner")} name="user_id" required defaultValue="">
            <option value="" disabled>
              {t("quiz.grade.acc.chooseLearner")}
            </option>
            {learners.map((l) => (
              <option key={l.user_id} value={l.user_id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("quiz.grade.acc.extraMinutes")} htmlFor={id("minutes")}>
          <Input id={id("minutes")} name="extra_minutes" type="number" inputMode="numeric" min={0} max={10000} step={1} defaultValue={current?.extra_minutes ?? 0} />
        </Field>
        <Field label={t("quiz.grade.acc.extraAttempts")} htmlFor={id("attempts")}>
          <Input id={id("attempts")} name="extra_attempts" type="number" inputMode="numeric" min={0} max={100} step={1} defaultValue={current?.extra_attempts ?? 0} />
        </Field>
      </div>
      {hasCloseDate ? (
        <DateTimeField name="extended_closes_at" label={t("quiz.grade.acc.extendedClose")} tz={tz} defaultValue={current?.extended_closes_at ?? null} hint={t("quiz.grade.acc.extendedCloseHint")} />
      ) : (
        <p className="text-sm text-muted">{t("quiz.grade.acc.noCloseDate")}</p>
      )}
      <Field label={t("quiz.grade.acc.note")} htmlFor={id("note")}>
        <Input id={id("note")} name="note" maxLength={1000} defaultValue={current?.note ?? ""} />
      </Field>
      <SubmitButton pendingText={t("common.saving")}>{t("quiz.grade.acc.save")}</SubmitButton>
    </ActionForm>
  );
}
