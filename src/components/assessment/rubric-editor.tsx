"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { t } from "@/i18n/client/assessment";
import { formatPoints } from "@/lib/domain/grades";
import { RUBRIC_MAX_CRITERIA, RUBRIC_MAX_LEVELS, parseRubric, rubricTotal, shortId, validateRubric, type RubricCriterion } from "@/lib/assessment/rubric";
import { rubricProblemText } from "@/lib/assessment/rubric-text";

type LevelDraft = { id: string; label: string; points: string; description: string };
type CriterionDraft = { id: string; criterion: string; description: string; points: string; levels: LevelDraft[] };

function toDraft(c: RubricCriterion): CriterionDraft {
  return {
    id: c.id,
    criterion: c.criterion,
    description: c.description,
    points: String(c.points),
    levels: c.levels.map((l) => ({ id: l.id, label: l.label, points: String(l.points), description: l.description })),
  };
}

const smallButton =
  "inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-sm text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:text-subtle disabled:hover:bg-transparent";

/**
 * The assignment's points and its optional rubric, edited together so the running rubric
 * total can be compared with the points as the author types. Submits `points` and `rubric`
 * (JSON) with the surrounding form; the server validates both again.
 */
export function PointsAndRubric({ initialPoints, initialRubric }: { initialPoints: number; initialRubric: RubricCriterion[] }) {
  const [points, setPoints] = useState(String(initialPoints));
  const [criteria, setCriteria] = useState<CriterionDraft[]>(() => initialRubric.map(toDraft));

  const parsed = parseRubric(criteria);
  const pointsNumber = Number(points);
  const total = rubricTotal(parsed);
  const problem = criteria.length === 0 ? null : parsed.length !== criteria.length ? null : validateRubric(parsed, Math.round(pointsNumber * 100) / 100);
  const firstIncomplete = parsed.length !== criteria.length ? criteria.findIndex((c) => parseRubric([c]).length === 0) : -1;
  const message =
    firstIncomplete >= 0 ? t("assign.author.err.rubric.criterionPoints", { number: firstIncomplete + 1 }) : problem ? rubricProblemText(problem) : null;
  const matches = criteria.length > 0 && message === null;

  function update(index: number, patch: Partial<CriterionDraft>) {
    setCriteria((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }
  function updateLevel(index: number, levelIndex: number, patch: Partial<LevelDraft>) {
    setCriteria((prev) => prev.map((c, i) => (i === index ? { ...c, levels: c.levels.map((l, j) => (j === levelIndex ? { ...l, ...patch } : l)) } : c)));
  }
  function move(index: number, by: -1 | 1) {
    setCriteria((prev) => {
      const next = [...prev];
      const target = index + by;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const serialized = JSON.stringify(
    criteria.map((c) => ({
      id: c.id,
      criterion: c.criterion.trim(),
      description: c.description.trim(),
      points: c.points.trim(),
      levels: c.levels.map((l) => ({ id: l.id, label: l.label.trim(), points: l.points.trim(), description: l.description.trim() })),
    })),
  );

  return (
    <div className="space-y-4">
      <Field label={t("assign.author.field.points")} htmlFor="asg-points" required>
        <Input
          id="asg-points"
          name="points"
          type="number"
          inputMode="decimal"
          min={0.01}
          max={10000}
          step={0.01}
          required
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          className="sm:max-w-48"
        />
      </Field>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t("assign.author.rubric")}</legend>
        <p className="text-xs text-muted" id="rubric-hint">{t("assign.author.rubricHint")}</p>
        <input type="hidden" name="rubric" value={serialized} />

        {criteria.length === 0 ? <p className="rounded-md border border-dashed border-line px-3 py-3 text-sm text-muted">{t("assign.author.rubricEmpty")}</p> : null}

        <ol className="space-y-4">
          {criteria.map((c, i) => {
            const n = i + 1;
            const base = `rc-${c.id}`;
            const label = t("assign.author.criterion", { number: n });
            return (
              <li key={c.id}>
                <fieldset className="min-w-0 rounded-md border border-line bg-panel p-3 sm:p-4">
                  <legend className="px-1 text-sm font-semibold">{label}</legend>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                    <Field label={t("assign.author.criterionTitle")} htmlFor={`${base}-name`} required>
                      <Input id={`${base}-name`} value={c.criterion} maxLength={300} required onChange={(e) => update(i, { criterion: e.target.value })} />
                    </Field>
                    <Field label={t("assign.author.criterionPoints")} htmlFor={`${base}-points`} required>
                      <Input
                        id={`${base}-points`}
                        type="number"
                        inputMode="decimal"
                        min={0.01}
                        max={10000}
                        step={0.01}
                        required
                        value={c.points}
                        onChange={(e) => update(i, { points: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label={t("assign.author.criterionDescription")} htmlFor={`${base}-desc`} className="mt-3">
                    <Textarea id={`${base}-desc`} rows={2} className="min-h-16" maxLength={2000} value={c.description} onChange={(e) => update(i, { description: e.target.value })} />
                  </Field>

                  <div className="mt-3 space-y-2">
                    <p className="text-sm font-medium">{t("assign.author.levels")}</p>
                    {c.levels.length > 0 ? (
                      <ol className="space-y-2">
                        {c.levels.map((l, j) => {
                          const lb = `${base}-l-${l.id}`;
                          const levelName = t("assign.author.levelOf", { level: j + 1, number: n });
                          return (
                            <li key={l.id} className="rounded-md border border-line px-3 py-2">
                              <p className="sr-only">{levelName}</p>
                              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]">
                                <Field label={t("assign.author.levelLabel")} htmlFor={`${lb}-label`} required>
                                  <Input id={`${lb}-label`} value={l.label} maxLength={120} required onChange={(e) => updateLevel(i, j, { label: e.target.value })} />
                                </Field>
                                <Field label={t("assign.author.levelPoints")} htmlFor={`${lb}-points`} required>
                                  <Input
                                    id={`${lb}-points`}
                                    type="number"
                                    inputMode="decimal"
                                    min={0}
                                    max={10000}
                                    step={0.01}
                                    required
                                    value={l.points}
                                    onChange={(e) => updateLevel(i, j, { points: e.target.value })}
                                  />
                                </Field>
                              </div>
                              <Field label={t("assign.author.levelDescription")} htmlFor={`${lb}-desc`} className="mt-2">
                                <Input id={`${lb}-desc`} value={l.description} maxLength={1000} onChange={(e) => updateLevel(i, j, { description: e.target.value })} />
                              </Field>
                              <div className="mt-1 flex justify-end">
                                <button
                                  type="button"
                                  className={`${smallButton} text-danger hover:bg-danger-soft`}
                                  onClick={() => update(i, { levels: c.levels.filter((_, k) => k !== j) })}
                                >
                                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                                  {t("assign.author.remove")}
                                  <span className="sr-only"> ({levelName})</span>
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    ) : null}
                    <button
                      type="button"
                      className={smallButton}
                      disabled={c.levels.length >= RUBRIC_MAX_LEVELS}
                      onClick={() => update(i, { levels: [...c.levels, { id: shortId("l"), label: "", points: "", description: "" }] })}
                    >
                      <Plus aria-hidden="true" className="h-4 w-4" />
                      {t("assign.author.addLevel")}
                      <span className="sr-only"> ({label})</span>
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1 border-t border-line pt-2">
                    <button type="button" className={smallButton} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp aria-hidden="true" className="h-4 w-4" />
                      {t("assign.author.moveUp")}
                      <span className="sr-only"> ({label})</span>
                    </button>
                    <button type="button" className={smallButton} disabled={i === criteria.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown aria-hidden="true" className="h-4 w-4" />
                      {t("assign.author.moveDown")}
                      <span className="sr-only"> ({label})</span>
                    </button>
                    <button
                      type="button"
                      className={`${smallButton} text-danger hover:bg-danger-soft`}
                      onClick={() => setCriteria((prev) => prev.filter((_, k) => k !== i))}
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                      {t("assign.author.remove")}
                      <span className="sr-only"> ({label})</span>
                    </button>
                  </div>
                </fieldset>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={criteria.length >= RUBRIC_MAX_CRITERIA}
            onClick={() => setCriteria((prev) => [...prev, { id: shortId("c"), criterion: "", description: "", points: "", levels: [] }])}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            {t("assign.author.addCriterion")}
          </Button>
          {criteria.length >= RUBRIC_MAX_CRITERIA ? <span className="text-xs text-muted">{t("assign.author.err.rubric.tooMany")}</span> : null}
        </div>

        {criteria.length > 0 ? (
          <div aria-live="polite" className="space-y-2">
            <p className={matches ? "text-sm font-medium text-success" : "text-sm font-medium text-warning"}>
              {t("assign.author.rubricTotal", { total: formatPoints(total), points: Number.isFinite(pointsNumber) ? formatPoints(pointsNumber) : "–" })}
            </p>
            {message ? <p className="text-sm text-warning">{message}</p> : null}
            {problem?.code === "totalMismatch" && total > 0 ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setPoints(String(total))}>
                {t("assign.author.usePointsFromRubric", { total: formatPoints(total) })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
