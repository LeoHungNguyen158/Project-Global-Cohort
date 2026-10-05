"use client";
import { useActionState, useEffect, useRef } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { ActionResult } from "@/lib/errors";
import { buttonClass } from "@/components/ui/button";
import { submitWithoutReset } from "@/components/ui/submit-without-reset";
import { t } from "@/i18n";

type Action = (prev: ActionResult<{ id?: string }> | null, formData: FormData) => Promise<ActionResult<{ id?: string }>>;

/**
 * Keyboard-operable reordering: move an item one place up or down. After the move the
 * focus stays on the same control (it moves with the item) and the new position is announced.
 */
export function MoveButtons({
  action,
  fields,
  title,
  canUp,
  canDown,
}: {
  action: Action;
  fields: Record<string, string>;
  title: string;
  canUp: boolean;
  canDown: boolean;
}) {
  const [state, formAction, pending] = useActionState(async (prev: ActionResult<{ id?: string }> | null, formData: FormData) => {
    try {
      return await action(prev, formData);
    } catch {
      return { ok: false as const, error: t("author.err.generic") };
    }
  }, null);
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const lastDirection = useRef<"up" | "down" | null>(null);

  useEffect(() => {
    if (!state || !lastDirection.current) return;
    const preferred = lastDirection.current === "up" ? upRef.current : downRef.current;
    const other = lastDirection.current === "up" ? downRef.current : upRef.current;
    const target = preferred && !preferred.disabled ? preferred : other && !other.disabled ? other : null;
    target?.focus();
  }, [state, canUp, canDown]);

  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="flex flex-wrap items-center gap-1">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button
        ref={upRef}
        type="submit"
        name="direction"
        value="up"
        disabled={!canUp || pending}
        onClick={() => {
          lastDirection.current = "up";
        }}
        aria-label={t("author.move.upNamed", { title })}
        title={t("author.move.up")}
        className={buttonClass("secondary", "sm", "w-10 px-0")}
      >
        <ArrowUp aria-hidden="true" className="h-4 w-4" />
      </button>
      <button
        ref={downRef}
        type="submit"
        name="direction"
        value="down"
        disabled={!canDown || pending}
        onClick={() => {
          lastDirection.current = "down";
        }}
        aria-label={t("author.move.downNamed", { title })}
        title={t("author.move.down")}
        className={buttonClass("secondary", "sm", "w-10 px-0")}
      >
        <ArrowDown aria-hidden="true" className="h-4 w-4" />
      </button>
      <span aria-live="polite" className="sr-only">
        {state?.ok ? (state.message ?? "") : ""}
      </span>
      {state && !state.ok ? (
        <span role="alert" className="basis-full text-sm text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
