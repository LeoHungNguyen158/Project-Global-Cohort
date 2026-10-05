import { DateTimeField } from "@/components/ui/datetime-field";
import { Field, Input } from "@/components/ui/field";
import { MarkdownField } from "@/components/ui/markdown-field";
import { PointsAndRubric } from "@/components/assessment/rubric-editor";
import { parseRubric } from "@/lib/assessment/rubric";
import { SUBMISSION_TYPES } from "@/lib/assessment/assignment-status";
import type { AssignmentRow } from "@/lib/assessment/assignment-data";
import { t, type MessageKey } from "@/i18n";

const TYPE_LABEL: Record<string, MessageKey> = { text: "assign.type.text", file: "assign.type.file", url: "assign.type.url" };
const radio = "h-4 w-4 accent-[var(--color-primary)]";

/** Assignment settings inputs shared by the create and edit forms (render inside an ActionForm). */
export function AssignmentFields({ assignment, tz }: { assignment?: AssignmentRow | null; tz: string }) {
  const types = assignment?.submission_types ?? ["text", "file"];
  const status = assignment?.status ?? "draft";
  const late = assignment?.late_policy ?? "accept_flag";
  return (
    <div className="space-y-6">
      <Field label={t("assign.author.field.title")} htmlFor="asg-title" required>
        <Input id="asg-title" name="title" defaultValue={assignment?.title ?? ""} required maxLength={300} />
      </Field>

      <MarkdownField name="instructions" label={t("assign.author.field.instructions")} html={assignment?.instructions_html ?? ""} rows={8} maxLength={50000} />

      <fieldset className="space-y-1" aria-describedby="asg-types-hint">
        <legend className="text-sm font-medium">
          {t("assign.author.field.types")}
          <span className="text-danger"> *<span className="sr-only"> (required)</span></span>
        </legend>
        <p id="asg-types-hint" className="text-xs text-muted">{t("assign.author.field.typesHint")}</p>
        <div className="flex flex-wrap gap-x-6">
          {SUBMISSION_TYPES.map((ty) => (
            <label key={ty} className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" name="submission_types" value={ty} defaultChecked={types.includes(ty)} className="h-4 w-4 rounded border-line accent-[var(--color-primary)]" />
              {t(TYPE_LABEL[ty])}
            </label>
          ))}
        </div>
      </fieldset>

      <PointsAndRubric initialPoints={assignment ? Number(assignment.points) : 100} initialRubric={parseRubric(assignment?.rubric ?? [])} />

      <div className="grid gap-4 md:grid-cols-3">
        <DateTimeField name="available_from" label={t("assign.author.field.available")} tz={tz} defaultValue={assignment?.available_from ?? null} hint={t("assign.author.field.availableHint")} />
        <DateTimeField name="due_at" label={t("assign.author.field.due")} tz={tz} defaultValue={assignment?.due_at ?? null} hint={t("assign.author.field.dueHint")} />
        <DateTimeField name="closes_at" label={t("assign.author.field.closes")} tz={tz} defaultValue={assignment?.closes_at ?? null} hint={t("assign.author.field.closesHint")} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{t("assign.author.field.latePolicy")}</legend>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="radio" name="late_policy" value="accept_flag" defaultChecked={late === "accept_flag"} className={radio} />
            {t("assign.author.late.acceptFlag")}
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="radio" name="late_policy" value="reject" defaultChecked={late === "reject"} className={radio} />
            {t("assign.author.late.reject")}
          </label>
        </fieldset>
        <Field label={t("assign.author.field.maxSubmissions")} htmlFor="asg-max" hint={t("assign.author.field.maxSubmissionsHint")} required>
          <Input
            id="asg-max"
            name="max_submissions"
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            step={1}
            required
            defaultValue={assignment?.max_submissions ?? 3}
            aria-describedby="asg-max-hint"
            className="sm:max-w-32"
          />
        </Field>
      </div>

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{t("assign.author.field.status")}</legend>
        {(["draft", "published", "archived"] as const).map((s) => (
          <label key={s} className="flex min-h-10 items-center gap-2 text-sm">
            <input type="radio" name="status" value={s} defaultChecked={status === s} className={radio} />
            {t(s === "draft" ? "assign.author.status.draft" : s === "published" ? "assign.author.status.published" : "assign.author.status.archived")}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
