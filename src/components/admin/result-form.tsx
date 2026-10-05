"use client";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/errors";
import { Alert } from "@/components/ui/alert";
import { Dialog } from "@/components/ui/dialog";
import { buttonClass } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { submitWithoutReset } from "@/components/ui/submit-without-reset";
import { pushFlash } from "./flash";
import { t } from "@/i18n";

/**
 * Outcome details an administration action can report. Some operations succeed with
 * a caveat (an invitation was created but its email was not accepted by the email
 * service), so the tone comes from the server's real result, not from the button.
 */
export type Notice = { tone?: "success" | "warning" | "info"; details?: string[] };
export type NoticeResult = ActionResult<Notice>;
type AnyResult = ActionResult<unknown>;
type Action<R extends AnyResult> = (prev: R | null, formData: FormData) => Promise<R>;

function noticeOf(result: AnyResult): Notice {
  return result.ok && result.data && typeof result.data === "object" ? (result.data as Notice) : {};
}

function announce(result: AnyResult) {
  if (!result.ok) pushFlash({ tone: "error", message: result.error });
  else if (result.message) pushFlash({ tone: noticeOf(result).tone ?? "success", message: result.message, details: noticeOf(result).details });
}

function Outcome({ state }: { state: AnyResult | null }) {
  if (!state) return null;
  if (!state.ok) return <Alert tone="error">{state.error}</Alert>;
  if (!state.message) return null;
  const notice = noticeOf(state);
  const details = notice.details ?? [];
  return (
    <Alert tone={notice.tone ?? "success"}>
      <p>{state.message}</p>
      {details.length > 0 ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

/**
 * Form around a server action that announces the real outcome, including partial ones.
 * With `flash`, the outcome goes to the page-level announcement instead (for controls
 * inside rows that can disappear once the page refreshes).
 */
export function ResultForm<R extends AnyResult>({
  action,
  children,
  className,
  resetOnSuccess,
  flash,
  id,
  "aria-label": ariaLabel,
}: {
  action: Action<R>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  flash?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  const [state, formAction] = useActionState(async (prev: R | null, formData: FormData) => {
    const result = await action(prev, formData);
    if (flash) announce(result);
    return result;
  }, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} onSubmit={submitWithoutReset(formAction)} className={className} id={id} aria-label={ariaLabel}>
      {children}
      {flash ? null : (
        <div aria-live="polite" className="mt-3 empty:hidden">
          <Outcome state={state} />
        </div>
      )}
    </form>
  );
}

/**
 * Button that opens a confirmation dialog before running a server action. Errors stay
 * in the dialog (with the person's input); success is announced at page level after the
 * dialog closes, because the triggering row may no longer exist.
 */
export function ResultConfirm<R extends AnyResult>({
  action,
  fields = {},
  trigger,
  triggerLabel,
  title,
  description,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  tone = "primary",
  triggerVariant = "secondary",
  size = "sm",
  children,
  disabled,
}: {
  action: Action<R>;
  fields?: Record<string, string>;
  trigger: ReactNode;
  /** Accessible name when the visible trigger text is ambiguous in a list. */
  triggerLabel?: string;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  pendingLabel?: string;
  tone?: "primary" | "danger";
  triggerVariant?: "primary" | "secondary" | "danger" | "subtle" | "ghost";
  size?: "sm" | "md";
  children?: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(async (prev: R | null, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) {
      setOpen(false);
      announce(result);
    }
    return result;
  }, null);
  return (
    <>
      <button type="button" className={buttonClass(triggerVariant, size)} onClick={() => setOpen(true)} disabled={disabled} aria-label={triggerLabel}>
        {trigger}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="space-y-4">
          {Object.entries(fields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {children}
          {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={buttonClass("secondary")} onClick={() => setOpen(false)}>
              {cancelLabel ?? t("admin.common.cancel")}
            </button>
            <SubmitButton variant={tone === "danger" ? "danger" : "primary"} pendingText={pendingLabel ?? t("admin.common.working")}>
              {confirmLabel}
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
