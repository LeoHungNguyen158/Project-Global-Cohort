"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveQuestion } from "@/app/actions/quizzes";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { submitWithoutReset } from "@/components/ui/submit-without-reset";
import { t } from "@/i18n/client/assessment";
import type { ActionResult } from "@/lib/errors";
import type { QuestionType } from "@/lib/domain/quiz";

export type EditableQuestion = {
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  choices: { id: string; text: string }[];
  correct: string[];
  explanation: string;
};

type Row = { key: string; text: string };

let counter = 0;
const newKey = () => `new-${Date.now().toString(36)}-${(counter += 1)}`;

function initialRows(q?: EditableQuestion): Row[] {
  if (q && (q.type === "single_choice" || q.type === "multiple_select") && q.choices.length > 0) {
    return q.choices.map((c) => ({ key: c.id, text: c.text }));
  }
  // Fixed keys keep the server and browser renders identical (no hydration mismatch);
  // rows added later in the browser get unique keys from newKey().
  return [
    { key: "new-1", text: "" },
    { key: "new-2", text: "" },
  ];
}

/**
 * Add or edit one question of a draft version. Choices keep their ids when edited; new
 * rows get ids on the server. Correct answers are marked per row (radio for single choice,
 * checkboxes for multiple select). The database validates everything again.
 */
export function QuestionEditor({ versionId, question, number }: { versionId: string; question?: EditableQuestion; number?: number }) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState<QuestionType>(question?.type ?? "single_choice");
  const [rows, setRows] = useState<Row[]>(() => initialRows(question));
  const [correct, setCorrect] = useState<Set<string>>(() => new Set(question && question.type !== "true_false" ? question.correct : []));
  const [tf, setTf] = useState<string>(question?.type === "true_false" ? (question.correct[0] ?? "") : "");
  const [state, formAction] = useActionState<ActionResult | null, FormData>(saveQuestion, null);
  const handled = useRef<ActionResult | null>(null);

  // After adding a question, clear the form for the next one (edits keep their values).
  useEffect(() => {
    if (!state || handled.current === state || !state.ok || question) return;
    handled.current = state;
    formRef.current?.reset();
    const reset = window.setTimeout(() => {
      setRows(initialRows());
      setCorrect(new Set());
      setTf("");
    }, 0);
    return () => window.clearTimeout(reset);
  }, [state, question]);

  const choiceBased = type === "single_choice" || type === "multiple_select";
  const id = (s: string) => `${uid}-${s}`;

  function toggleCorrect(key: string, checked: boolean) {
    setCorrect((prev) => {
      if (type === "single_choice") return new Set(checked ? [key] : []);
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={submitWithoutReset(formAction)} className="space-y-4">
      <input type="hidden" name="version_id" value={versionId} />
      {question ? <input type="hidden" name="question_id" value={question.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="space-y-1">
          <label htmlFor={id("type")} className="block text-sm font-medium">{t("quiz.author.field.type")}</label>
          <select
            id={id("type")}
            name="type"
            value={type}
            onChange={(e) => {
              const next = e.target.value as QuestionType;
              setType(next);
              if (next === "single_choice" && correct.size > 1) setCorrect(new Set([Array.from(correct)[0]]));
            }}
            className="block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2"
          >
            <option value="single_choice">{t("quiz.type.singleChoice")}</option>
            <option value="multiple_select">{t("quiz.type.multipleSelect")}</option>
            <option value="true_false">{t("quiz.type.trueFalse")}</option>
            <option value="short_answer">{t("quiz.type.shortAnswer")}</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={id("points")} className="block text-sm font-medium">
            {t("quiz.author.field.points")}
            <span className="text-danger"> *<span className="sr-only"> ({t("common.required")})</span></span>
          </label>
          <input
            id={id("points")}
            name="points"
            type="number"
            inputMode="decimal"
            min={0.01}
            max={1000}
            step={0.01}
            required
            defaultValue={question?.points ?? 1}
            className="block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor={id("prompt")} className="block text-sm font-medium">
          {t("quiz.author.field.prompt")}
          <span className="text-danger"> *<span className="sr-only"> ({t("common.required")})</span></span>
        </label>
        <textarea
          id={id("prompt")}
          name="prompt"
          required
          maxLength={10000}
          rows={3}
          defaultValue={question?.prompt ?? ""}
          className="block min-h-24 w-full rounded-md border border-line bg-white px-3 py-2"
        />
      </div>

      {choiceBased ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("quiz.author.field.choices")}</legend>
          <p className="text-xs text-muted">{type === "single_choice" ? t("quiz.author.choicesHintSingle") : t("quiz.author.choicesHintMulti")}</p>
          <ol className="space-y-2">
            {rows.map((row, i) => (
              <li key={row.key} className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-canvas p-2 sm:flex-nowrap">
                <input type="hidden" name="choice_key" value={row.key} />
                <label htmlFor={id(`choice-${row.key}`)} className="sr-only">{t("quiz.author.field.choice", { number: i + 1 })}</label>
                <input
                  id={id(`choice-${row.key}`)}
                  name="choice_text"
                  required
                  maxLength={2000}
                  value={row.text}
                  placeholder={t("quiz.author.field.choice", { number: i + 1 })}
                  onChange={(e) => setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, text: e.target.value } : r)))}
                  className="block min-h-10 min-w-0 flex-1 basis-48 rounded-md border border-line bg-white px-3 py-2"
                />
                <label className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm">
                  <input
                    type={type === "single_choice" ? "radio" : "checkbox"}
                    name="correct"
                    value={row.key}
                    checked={correct.has(row.key)}
                    onChange={(e) => toggleCorrect(row.key, e.target.checked)}
                    className="h-4 w-4 accent-[var(--color-primary)]"
                  />
                  {type === "single_choice" ? t("quiz.author.field.correctSingle") : t("quiz.author.field.correctMulti")}
                  <span className="sr-only"> ({t("quiz.author.field.choice", { number: i + 1 })})</span>
                </label>
                <button
                  type="button"
                  disabled={rows.length <= 2}
                  onClick={() => {
                    setRows((prev) => prev.filter((r) => r.key !== row.key));
                    setCorrect((prev) => {
                      const next = new Set(prev);
                      next.delete(row.key);
                      return next;
                    });
                  }}
                  className={buttonClass("ghost", "sm")}
                  aria-label={t("quiz.author.removeChoice", { number: i + 1 })}
                  title={rows.length <= 2 ? t("quiz.author.minChoices") : undefined}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ol>
          {rows.length <= 2 ? <p className="text-xs text-muted">{t("quiz.author.minChoices")}</p> : null}
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, { key: newKey(), text: "" }])}
            disabled={rows.length >= 20}
            className={buttonClass("secondary", "sm")}
          >
            <Plus aria-hidden="true" className="h-4 w-4" /> {t("quiz.author.addChoice")}
          </button>
        </fieldset>
      ) : null}

      {type === "true_false" ? (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{t("quiz.author.field.tfCorrect")}</legend>
          <div className="flex flex-wrap gap-4">
            {(["true", "false"] as const).map((v) => (
              <label key={v} className="inline-flex min-h-10 items-center gap-2 text-sm">
                <input type="radio" name="tf_correct" value={v} checked={tf === v} onChange={() => setTf(v)} required className="h-4 w-4 accent-[var(--color-primary)]" />
                {v === "true" ? t("quiz.author.true") : t("quiz.author.false")}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="space-y-1">
        <label htmlFor={id("explanation")} className="block text-sm font-medium">
          {type === "short_answer" ? t("quiz.author.field.modelAnswer") : t("quiz.author.field.explanation")}
        </label>
        <p id={id("explanation-hint")} className="text-xs text-muted">
          {type === "short_answer" ? t("quiz.author.field.modelAnswerHint") : t("quiz.author.field.explanationHint")}
        </p>
        <textarea
          id={id("explanation")}
          name="explanation"
          maxLength={5000}
          rows={2}
          defaultValue={question?.explanation ?? ""}
          aria-describedby={id("explanation-hint")}
          className="block min-h-20 w-full rounded-md border border-line bg-white px-3 py-2"
        />
      </div>

      <div aria-live="polite" className="empty:hidden">
        {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
        {state && state.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}
      </div>
      <SubmitButton pendingText={t("common.saving")}>
        {question ? t("quiz.author.saveQuestion") : t("quiz.author.addQuestionButton")}
        {number ? <span className="sr-only"> {t("quiz.author.questionHeading", { number })}</span> : null}
      </SubmitButton>
    </form>
  );
}
