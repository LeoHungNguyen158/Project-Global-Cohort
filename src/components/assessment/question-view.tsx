"use client";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { t, type AssessmentKey as MessageKey } from "@/i18n/client/assessment";
import { SHORT_ANSWER_MAX, type QuestionType, type QuizResponse } from "@/lib/domain/quiz";
import { pointsLabel } from "@/lib/assessment/quiz-text";

/** What a learner may see of a question: no answer keys, explanations or scoring flags. */
export type LearnerQuestion = {
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  choices: { id: string; text: string }[];
};

const HINT: Record<QuestionType, MessageKey> = {
  single_choice: "quiz.attempt.hint.singleChoice",
  multiple_select: "quiz.attempt.hint.multipleSelect",
  true_false: "quiz.attempt.hint.trueFalse",
  short_answer: "quiz.attempt.hint.shortAnswer",
};

/** One question of an attempt (or preview). Controlled: the parent owns the answer and its save state. */
export function QuestionView({
  question,
  index,
  total,
  value,
  onChange,
  disabled,
  status,
}: {
  question: LearnerQuestion;
  index: number;
  total: number;
  value: QuizResponse;
  onChange: (value: QuizResponse) => void;
  disabled?: boolean;
  status?: ReactNode;
}) {
  const q = question;
  const number = index + 1;
  const headingId = `q-${q.id}-heading`;
  const promptId = `q-${q.id}-prompt`;
  const hintId = `q-${q.id}-hint`;
  const choice = value && "choice" in value ? value.choice : null;
  const selected = new Set(value && "choices" in value ? value.choices : []);
  const text = value && "text" in value ? value.text : "";

  return (
    <section aria-labelledby={headingId} className="rounded-[var(--radius-panel)] border border-line bg-panel px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={headingId} className="text-base font-semibold">
          {t("quiz.attempt.questionOf", { number, total })}
        </h3>
        <span className="text-sm text-muted">{pointsLabel(q.points)}</span>
      </div>

      {q.type === "short_answer" ? (
        <div className="mt-2 space-y-2">
          <p id={promptId} className="whitespace-pre-wrap break-words text-[0.95rem]">{q.prompt}</p>
          <p id={hintId} className="text-xs text-muted">{t(HINT[q.type])}</p>
          <label htmlFor={`q-${q.id}-text`} className="block text-sm font-medium">
            {t("quiz.attempt.answerLabel", { number })}
          </label>
          <textarea
            id={`q-${q.id}-text`}
            value={text}
            disabled={disabled}
            maxLength={SHORT_ANSWER_MAX}
            rows={6}
            aria-describedby={`${promptId} ${hintId} q-${q.id}-count`}
            onChange={(e) => onChange(e.target.value === "" ? null : { text: e.target.value })}
            className="block min-h-32 w-full rounded-md border border-line bg-white px-3 py-2 text-ink disabled:bg-canvas"
          />
          <p id={`q-${q.id}-count`} className="text-right text-xs text-muted">
            {t("quiz.attempt.characters", { count: text.length, max: SHORT_ANSWER_MAX })}
          </p>
        </div>
      ) : (
        <fieldset className="mt-2 min-w-0" aria-describedby={hintId} disabled={disabled}>
          <legend id={promptId} className="whitespace-pre-wrap break-words text-[0.95rem]">{q.prompt}</legend>
          <p id={hintId} className="mt-1 text-xs text-muted">{t(HINT[q.type])}</p>
          <div className="mt-3 space-y-2">
            {q.choices.map((c) => {
              const multi = q.type === "multiple_select";
              const checked = multi ? selected.has(c.id) : choice === c.id;
              return (
                <label
                  key={c.id}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-[0.95rem]",
                    checked ? "border-primary bg-primary-soft" : "border-line bg-white hover:bg-canvas",
                    disabled && "cursor-not-allowed opacity-80",
                  )}
                >
                  <input
                    type={multi ? "checkbox" : "radio"}
                    name={`q-${q.id}`}
                    value={c.id}
                    checked={checked}
                    onChange={(e) => {
                      if (!multi) {
                        onChange({ choice: c.id });
                        return;
                      }
                      const next = new Set(selected);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      // Keep the authored/shuffled display order in the saved selection.
                      const ordered = q.choices.map((x) => x.id).filter((id) => next.has(id));
                      onChange(ordered.length === 0 ? null : { choices: ordered });
                    }}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                  />
                  <span className="min-w-0 whitespace-pre-wrap break-words">{q.type === "true_false" ? trueFalseLabel(c) : c.text}</span>
                </label>
              );
            })}
          </div>
          {q.type !== "multiple_select" && choice !== null && !disabled ? (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="mt-2 inline-flex min-h-10 items-center rounded-md px-2 text-sm text-primary underline-offset-2 hover:underline"
            >
              {t("quiz.attempt.clear")}
              <span className="sr-only"> ({t("quiz.attempt.questionOf", { number, total })})</span>
            </button>
          ) : null}
        </fieldset>
      )}
      {status ? <div className="mt-3 border-t border-line pt-2 text-sm">{status}</div> : null}
    </section>
  );
}

function trueFalseLabel(c: { id: string; text: string }) {
  if (c.id === "true") return t("quiz.author.true");
  if (c.id === "false") return t("quiz.author.false");
  return c.text;
}
