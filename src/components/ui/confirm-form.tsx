"use client";
import { useActionState, useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/errors";
import { Dialog } from "./dialog";
import { Alert } from "./alert";
import { buttonClass } from "./button";
import { SubmitButton } from "./submit-button";
import { submitWithoutReset } from "./submit-without-reset";
import { t } from "@/i18n/client/core";

type Action<T> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

/**
 * A button that asks for confirmation in an accessible dialog before running a
 * server action (publishing, deleting, sending to many people). The dialog states
 * the consequence; the result is announced from the server's real response.
 */
export function ConfirmForm<T = unknown>({
  action,
  fields = {},
  trigger,
  title,
  description,
  confirmLabel,
  tone = "primary",
  triggerVariant = "secondary",
  size = "md",
  children,
  disabled,
}: {
  action: Action<T>;
  fields?: Record<string, string>;
  trigger: ReactNode;
  title: string;
  description?: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  triggerVariant?: "primary" | "secondary" | "danger" | "subtle" | "ghost";
  size?: "sm" | "md";
  /** Extra inputs shown inside the dialog (e.g. a reason field). */
  children?: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(async (prev: ActionResult<T> | null, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) setOpen(false);
    return result;
  }, null);
  return (
    <>
      <button type="button" className={buttonClass(triggerVariant, size)} onClick={() => setOpen(true)} disabled={disabled}>
        {trigger}
      </button>
      <div aria-live="polite" className="empty:hidden">
        {state && state.ok && state.message && !open ? <Alert tone="success" className="mt-2">{state.message}</Alert> : null}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="space-y-4">
          {Object.entries(fields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {children}
          {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={buttonClass("secondary")} onClick={() => setOpen(false)}>{t("common.cancel")}</button>
            <SubmitButton variant={tone === "danger" ? "danger" : "primary"} pendingText={t("common.working")}>{confirmLabel}</SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
