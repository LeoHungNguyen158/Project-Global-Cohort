"use client";
import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { submitWithoutReset } from "@/components/ui/submit-without-reset";
import { cn } from "@/components/ui/cn";
import { createGradeItem, publishGrades, saveGrade, unpublishGrade, updateGradeItem } from "@/app/actions/grades";
import type { ActionResult } from "@/lib/errors";
import { t, type MessageKey } from "@/i18n";
import type { GridCell, GridItem, GridPermissions, GridRow, GridTotal } from "./gradebook-types";

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

const KIND: Record<GridItem["kind"], MessageKey> = {
  assignment: "gradebook.kind.assignment",
  quiz: "gradebook.kind.quiz",
  participation: "gradebook.kind.participation",
  manual: "gradebook.kind.manual",
};

const ENROLL: Record<string, MessageKey> = {
  active: "gradebook.enroll.active",
  completed: "gradebook.enroll.completed",
  withdrawn: "gradebook.enroll.withdrawn",
  suspended: "gradebook.enroll.suspended",
};

const PUBLICATION: Record<Exclude<GridCell["publication"], "none">, { key: MessageKey; className: string }> = {
  unpublished: { key: "gradebook.pub.unpublished", className: "text-warning" },
  published: { key: "gradebook.pub.published", className: "text-success" },
  changed: { key: "gradebook.pub.changed", className: "text-warning" },
};

function entryText(cell: GridCell): string {
  switch (cell.entry) {
    case "graded":
      return cell.points ?? "";
    case "missing":
      return t("gradebook.entry.missing");
    case "exempt":
      return t("gradebook.entry.exempt");
    case "pending":
      return t("gradebook.entry.pending");
    default:
      return t("gradebook.entry.ungraded");
  }
}

/** Full description of a cell for its accessible name. */
function cellDescription(cell: GridCell, item: GridItem): string {
  const parts = [cell.entry === "graded" ? t("grades.score", { points: cell.points ?? "", max: item.maxPoints }) : entryText(cell)];
  if (cell.publication !== "none") parts.push(t(PUBLICATION[cell.publication].key));
  if (cell.needsGrading && cell.entry !== "pending") parts.push(t("gradebook.needsGradingNote"));
  return parts.join(", ");
}

function CellContent({ cell }: { cell: GridCell }) {
  return (
    <span className="flex flex-col items-start gap-0.5 text-left">
      {cell.entry === "ungraded" ? (
        <span className="text-muted" aria-hidden="true">–</span>
      ) : (
        <span className={cn("font-medium tabular-nums", cell.entry === "pending" && "text-primary")}>{entryText(cell)}</span>
      )}
      {cell.publication !== "none" ? (
        <span className={cn("text-xs", PUBLICATION[cell.publication].className)}>{t(PUBLICATION[cell.publication].key)}</span>
      ) : null}
      {cell.needsGrading && cell.entry !== "pending" ? <span className="text-xs text-primary">{t("gradebook.needsGradingNote")}</span> : null}
    </span>
  );
}

function TotalContent({ total }: { total: GridTotal }) {
  if (total.percent === null) {
    return (
      <>
        <span aria-hidden="true" className="text-muted">–</span>
        <span className="sr-only">{t("grades.noReleased")}</span>
      </>
    );
  }
  return (
    <span className="flex flex-col">
      <span className="font-semibold tabular-nums">{total.percent}%</span>
      <span className="text-xs tabular-nums text-muted">{t("grades.score", { points: total.earned, max: total.possible })}</span>
    </span>
  );
}

/** Two-step confirmation inside the grade dialog (no nested dialogs). */
function InlineConfirm({
  action,
  fields,
  label,
  title,
  description,
  confirmLabel,
  tone = "primary",
  onDone,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  onDone: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const panel = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const [state, formAction] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const result = await action(prev, fd);
    if (result.ok) onDone(result.message ?? "");
    return result;
  }, null);
  useEffect(() => {
    if (confirming) panel.current?.focus();
  }, [confirming]);
  if (!confirming) {
    return (
      <button type="button" className={buttonClass(tone === "danger" ? "secondary" : "primary", "sm")} onClick={() => setConfirming(true)}>
        {label}
      </button>
    );
  }
  return (
    <form
      ref={panel}
      tabIndex={-1}
      aria-labelledby={titleId}
      action={formAction}
      onSubmit={submitWithoutReset(formAction)}
      className="w-full space-y-2 rounded-md border border-line bg-canvas p-3 focus:outline-none"
    >
      <p id={titleId} className="font-semibold">{title}</p>
      <p className="text-sm">{description}</p>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setConfirming(false)}>
          {t("common.cancel")}
        </button>
        <SubmitButton size="sm" variant={tone === "danger" ? "danger" : "primary"} pendingText={t("gradebook.saving")}>
          {confirmLabel}
        </SubmitButton>
      </div>
    </form>
  );
}

function GradeForm({
  offeringId,
  row,
  item,
  cell,
  permissions,
  onDone,
}: {
  offeringId: string;
  row: GridRow;
  item: GridItem;
  cell: GridCell;
  permissions: GridPermissions;
  onDone: (message: string) => void;
}) {
  const initial = cell.entry === "missing" ? "missing" : cell.entry === "exempt" ? "exempt" : "points";
  const [result, setResult] = useState<"points" | "missing" | "exempt">(initial);
  const [state, formAction] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const r = await saveGrade(prev, fd);
    if (r.ok) onDone(r.message ?? "");
    return r;
  }, null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  const base = useId();
  const pointsId = `${base}-points`;
  const feedbackId = `${base}-feedback`;
  const current = cellDescription(cell, item);
  return (
    <div className="space-y-4">
      <p className="text-sm">
        {t("gradebook.currentState", { state: current })}
        {cell.publishedAt ? <span className="block text-xs text-muted">{t("gradebook.publishedOn", { date: cell.publishedAt })}</span> : null}
      </p>
      {item.kind === "quiz" ? <Alert tone="info">{t("gradebook.quizNote")}</Alert> : null}
      {item.kind === "assignment" ? (
        <Alert tone="info">
          {t("gradebook.assignmentNote")}{" "}
          {item.workHref ? (
            <Link className="underline underline-offset-2" href={item.workHref}>
              {t("gradebook.openGrading")}
            </Link>
          ) : null}
        </Alert>
      ) : null}
      <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="space-y-4" noValidate>
        <input type="hidden" name="item_id" value={item.id} />
        <input type="hidden" name="user_id" value={row.userId} />
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{t("gradebook.result")}</legend>
          {(
            [
              ["points", "gradebook.resultPoints"],
              ["missing", "gradebook.resultMissing"],
              ["exempt", "gradebook.resultExempt"],
            ] as const
          ).map(([value, key]) => (
            <label key={value} className="flex min-h-10 items-center gap-2 text-sm">
              <input
                type="radio"
                name="result"
                value={value}
                checked={result === value}
                onChange={() => setResult(value)}
                className="h-4 w-4 accent-[var(--color-primary)]"
              />
              {t(key)}
            </label>
          ))}
        </fieldset>
        <Field label={t("gradebook.points", { max: item.maxPoints })} htmlFor={pointsId} error={fe.points}>
          <Input
            id={pointsId}
            name="points"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={cell.entry === "graded" ? cell.points ?? "" : ""}
            disabled={result !== "points"}
            required={result === "points"}
            aria-invalid={fe.points ? true : undefined}
            aria-describedby={fe.points ? `${pointsId}-error` : undefined}
            className="max-w-[10rem]"
          />
        </Field>
        <Field label={t("gradebook.feedback")} htmlFor={feedbackId} hint={t("gradebook.feedbackHint")} error={fe.feedback}>
          <Textarea
            id={feedbackId}
            name="feedback"
            defaultValue={cell.feedback}
            maxLength={20000}
            aria-describedby={`${feedbackId}-hint${fe.feedback ? ` ${feedbackId}-error` : ""}`}
            aria-invalid={fe.feedback ? true : undefined}
          />
        </Field>
        {state && !state.ok && !fe.points && !fe.feedback ? <Alert tone="error">{state.error}</Alert> : null}
        <div className="flex justify-end">
          <SubmitButton pendingText={t("gradebook.saving")}>{t("gradebook.save")}</SubmitButton>
        </div>
      </form>
      {cell.gradeId && !permissions.readOnly ? (
        <div className="space-y-2 border-t border-line pt-4">
          {permissions.canPublish ? (
            <div className="flex flex-wrap gap-2">
              {cell.publishable ? (
                <InlineConfirm
                  action={publishGrades}
                  fields={{ offering_id: offeringId, grade_id: cell.gradeId }}
                  label={t("gradebook.publishThis")}
                  title={t("gradebook.publishThisTitle")}
                  description={t("gradebook.publishThisDescription", { learner: row.name })}
                  confirmLabel={t("gradebook.publishThis")}
                  onDone={onDone}
                />
              ) : null}
              {cell.publication === "published" || cell.publication === "changed" ? (
                <InlineConfirm
                  action={unpublishGrade}
                  fields={{ grade_id: cell.gradeId }}
                  label={t("gradebook.unpublish")}
                  title={t("gradebook.unpublishTitle")}
                  description={t("gradebook.unpublishDescription")}
                  confirmLabel={t("gradebook.unpublish")}
                  tone="danger"
                  onDone={onDone}
                />
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">{t("gradebook.noPublishPermission")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Add (no item) or edit (item) a manual or participation grade item. */
export function GradeItemForm({ offeringId, item, onDone }: { offeringId: string; item?: GridItem; onDone: (message: string) => void }) {
  const [state, formAction] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const r = await (item ? updateGradeItem(prev, fd) : createGradeItem(prev, fd));
    if (r.ok) onDone(r.message ?? "");
    return r;
  }, null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  const base = useId();
  const maxLocked = Boolean(item?.hasGrades);
  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="space-y-4" noValidate>
      {item ? <input type="hidden" name="item_id" value={item.id} /> : <input type="hidden" name="offering_id" value={offeringId} />}
      <Field label={t("gradebook.itemTitle")} htmlFor={`${base}-title`} required error={fe.title}>
        <Input
          id={`${base}-title`}
          name="title"
          defaultValue={item?.title ?? ""}
          maxLength={300}
          required
          aria-invalid={fe.title ? true : undefined}
          aria-describedby={fe.title ? `${base}-title-error` : undefined}
        />
      </Field>
      {item ? null : (
        <Field label={t("gradebook.itemKind")} htmlFor={`${base}-kind`} error={fe.kind}>
          <Select id={`${base}-kind`} name="kind" defaultValue="manual">
            <option value="manual">{t("gradebook.kind.manual")}</option>
            <option value="participation">{t("gradebook.kind.participation")}</option>
          </Select>
        </Field>
      )}
      <Field
        label={t("gradebook.itemMax")}
        htmlFor={`${base}-max`}
        required={!maxLocked}
        hint={maxLocked ? t("gradebook.itemMaxLocked") : undefined}
        error={fe.max_points}
      >
        <Input
          id={`${base}-max`}
          name="max_points"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={item?.maxPoints ?? ""}
          readOnly={maxLocked}
          required={!maxLocked}
          aria-invalid={fe.max_points ? true : undefined}
          aria-describedby={[maxLocked ? `${base}-max-hint` : "", fe.max_points ? `${base}-max-error` : ""].filter(Boolean).join(" ") || undefined}
          className="max-w-[10rem]"
        />
      </Field>
      <div>
        <Checkbox name="counts_toward_total" label={t("gradebook.itemCounts")} defaultChecked={item ? item.counts : true} />
        <Checkbox name="visible_to_learners" label={t("gradebook.itemVisible")} defaultChecked={item ? item.visible : true} />
      </div>
      {state && !state.ok && Object.keys(fe).length === 0 ? <Alert tone="error">{state.error}</Alert> : null}
      <div className="flex justify-end">
        <SubmitButton>{item ? t("gradebook.itemSave") : t("gradebook.itemCreate")}</SubmitButton>
      </div>
    </form>
  );
}

/** Toolbar button that opens the add-item dialog and announces the server's result. */
export function AddGradeItemButton({ offeringId }: { offeringId: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <button type="button" className={buttonClass("secondary")} onClick={() => setOpen(true)}>
        {t("gradebook.addItem")}
      </button>
      <div aria-live="polite" className="basis-full empty:hidden">
        {message ? <Alert tone="success">{message}</Alert> : null}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("gradebook.addItemTitle")} description={t("gradebook.addItemDescription")}>
        {open ? (
          <GradeItemForm
            offeringId={offeringId}
            onDone={(m) => {
              setMessage(m);
              setOpen(false);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

/**
 * The gradebook table: learners × grade items in a labeled scroll region with a sticky
 * learner column. Each cell opens a dialog to enter points, missing or exempt with
 * feedback (saved unpublished), and to publish or unpublish that one grade.
 */
export function GradebookGrid({
  offeringId,
  caption,
  items,
  rows,
  permissions,
  filterActive,
  children,
}: {
  offeringId: string;
  caption: string;
  items: GridItem[];
  rows: GridRow[];
  permissions: GridPermissions;
  filterActive: boolean;
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState<{ userId: string; itemId: string } | null>(null);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const captionId = useId();
  const canEdit = permissions.canGrade && !permissions.readOnly;

  const row = editing ? rows.find((r) => r.userId === editing.userId) ?? null : null;
  const item = editing ? items.find((i) => i.id === editing.itemId) ?? null : null;
  const cell = row && item ? row.cells.find((c) => c.itemId === item.id) ?? null : null;
  const itemBeingEdited = editingItem ? items.find((i) => i.id === editingItem) ?? null : null;

  const done = (m: string) => {
    setMessage(m || null);
    setEditing(null);
    setEditingItem(null);
  };

  return (
    <div className="space-y-3">
      <div aria-live="polite" className="empty:hidden">
        {message ? <Alert tone="success">{message}</Alert> : null}
      </div>
      {children}
      <div
        role="region"
        aria-label={t("gradebook.region")}
        tabIndex={0}
        className="relative max-h-[70vh] overflow-auto rounded-[var(--radius-panel)] border border-line bg-panel focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <table className="w-max min-w-full border-separate border-spacing-0 text-left text-sm" aria-describedby={captionId}>
          <caption id={captionId} className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 top-0 z-30 min-w-[10rem] max-w-[13rem] border-b border-r border-line bg-canvas px-3 py-2 align-bottom text-xs font-semibold uppercase tracking-wide text-muted"
              >
                {t("gradebook.learner")}
              </th>
              {items.map((it) => (
                <th key={it.id} scope="col" className="sticky top-0 z-20 min-w-[8.5rem] max-w-[12rem] border-b border-line bg-canvas px-3 py-2 align-bottom font-normal">
                  <span className="block font-semibold text-ink [overflow-wrap:anywhere]">{it.title}</span>
                  <span className="block text-xs text-muted">
                    {t(KIND[it.kind])} · {t("gradebook.pointsShort", { max: it.maxPoints })}
                  </span>
                  {!it.visible ? <span className="block text-xs text-warning">{t("gradebook.hidden")}</span> : null}
                  {!it.counts ? <span className="block text-xs text-muted">{t("gradebook.notCounted")}</span> : null}
                  {it.editable ? (
                    <button
                      type="button"
                      onClick={() => setEditingItem(it.id)}
                      aria-label={t("gradebook.itemEdit", { title: it.title })}
                      className="mt-1 inline-flex min-h-8 items-center gap-1 rounded px-1 text-xs text-primary hover:underline"
                    >
                      <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                      {t("gradebook.editShort")}
                    </button>
                  ) : null}
                </th>
              ))}
              <th scope="col" className="sticky top-0 z-20 min-w-[7rem] border-b border-l border-line bg-canvas px-3 py-2 align-bottom text-xs font-semibold uppercase tracking-wide text-muted">
                {t("gradebook.releasedTotal")}
              </th>
              <th scope="col" className="sticky top-0 z-20 min-w-[7rem] border-b border-line bg-canvas px-3 py-2 align-bottom text-xs font-semibold uppercase tracking-wide text-muted">
                {t("gradebook.workingTotal")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId}>
                <th scope="row" className="sticky left-0 z-10 min-w-[10rem] max-w-[13rem] border-b border-r border-line bg-panel px-3 py-2 text-left align-top font-medium">
                  <span className="block [overflow-wrap:anywhere]">{r.name}</span>
                  {r.enrollmentStatus !== "active" ? (
                    <Badge className="mt-1">{t(ENROLL[r.enrollmentStatus] ?? "gradebook.enroll.active")}</Badge>
                  ) : null}
                </th>
                {r.cells.map((c) => {
                  const it = items.find((i) => i.id === c.itemId)!;
                  const highlight = filterActive && c.match;
                  return (
                    <td key={c.itemId} className={cn("border-b border-line p-0 align-top", highlight && "bg-primary-soft")}>
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => setEditing({ userId: r.userId, itemId: c.itemId })}
                          aria-label={t("gradebook.cellEdit", { learner: r.name, item: it.title, value: cellDescription(c, it) })}
                          className="block h-full min-h-12 w-full px-3 py-2 text-left hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                        >
                          <CellContent cell={c} />
                        </button>
                      ) : (
                        <div className="px-3 py-2">
                          <span className="sr-only">{t("gradebook.cellView", { learner: r.name, item: it.title, value: cellDescription(c, it) })}</span>
                          <span aria-hidden="true">
                            <CellContent cell={c} />
                          </span>
                        </div>
                      )}
                    </td>
                  );
                })}
                <td className="border-b border-l border-line px-3 py-2 align-top">
                  <TotalContent total={r.released} />
                </td>
                <td className="border-b border-line px-3 py-2 align-top">
                  <TotalContent total={r.working} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog
        open={Boolean(row && item && cell)}
        onClose={() => setEditing(null)}
        title={item ? t("gradebook.editTitle", { item: item.title }) : ""}
        description={row && item ? t("gradebook.editDescription", { learner: row.name, max: item.maxPoints }) : undefined}
      >
        {row && item && cell ? (
          <GradeForm key={`${row.userId}:${item.id}`} offeringId={offeringId} row={row} item={item} cell={cell} permissions={permissions} onDone={done} />
        ) : null}
      </Dialog>

      <Dialog open={Boolean(itemBeingEdited)} onClose={() => setEditingItem(null)} title={t("gradebook.itemEditTitle")}>
        {itemBeingEdited ? <GradeItemForm key={itemBeingEdited.id} offeringId={offeringId} item={itemBeingEdited} onDone={done} /> : null}
      </Dialog>
    </div>
  );
}
