"use client";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { ActionResult } from "@/lib/errors";
import { Alert } from "./alert";

type Action = (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;

/**
 * Wraps a server action form and announces the real outcome. Success text is shown
 * only when the server confirmed the change; failures keep the user's input.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  successMessage,
  id,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  successMessage?: string;
  id?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} id={id} noValidate={false}>
      {children}
      <div aria-live="polite" className="mt-3 empty:hidden">
        {state && !state.ok ? <Alert tone="error">{state.error}</Alert> : null}
        {state && state.ok && (state.message || successMessage) ? <Alert tone="success">{state.message ?? successMessage}</Alert> : null}
      </div>
    </form>
  );
}
