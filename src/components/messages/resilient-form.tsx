"use client";
import { createContext, useContext, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import type { ActionResult } from "@/lib/errors";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { t } from "@/i18n";

export type RedirectResult = ActionResult<{ redirectTo?: string } | unknown>;
type Action = (prev: unknown, formData: FormData) => Promise<RedirectResult>;

type FormState = { result: RedirectResult | null; failedToReach: boolean };
const PendingContext = createContext(false);

function redirectOf(result: RedirectResult): string | null {
  if (!result.ok || !result.data || typeof result.data !== "object") return null;
  const target = (result.data as { redirectTo?: unknown }).redirectTo;
  return typeof target === "string" && target.startsWith("/") && !target.startsWith("//") ? target : null;
}

/**
 * Form around a server action for anything a person typed (posts, announcements,
 * topics). The action is called directly so a dropped connection is reported here
 * instead of replacing the page: the text stays in the fields, an offline or
 * server error is announced, and "Try again" resubmits. Success is shown only after
 * the server confirmed it; a `redirectTo` in the result opens that page.
 */
export function ResilientForm({
  action,
  children,
  className,
  resetOnSuccess,
  successMessage,
  failureMessage,
  id,
  "aria-label": ariaLabel,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  successMessage?: string;
  /** Shown when the server could not be reached. */
  failureMessage?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<FormState>({ result: null, failedToReach: false });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const formData = new FormData(form, (event.nativeEvent as SubmitEvent).submitter);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setState({ result: { ok: false, error: t("msg.offline") }, failedToReach: true });
      return;
    }
    startTransition(async () => {
      try {
        const result = await action(null, formData);
        setState({ result, failedToReach: false });
        if (result.ok) {
          if (resetOnSuccess) form.reset();
          const target = redirectOf(result);
          if (target) router.push(target);
        }
      } catch {
        setState({ result: { ok: false, error: failureMessage ?? t("msg.saveUnconfirmed") }, failedToReach: true });
      }
    });
  }

  const result = state.result;
  return (
    <form ref={ref} onSubmit={onSubmit} className={className} id={id} aria-label={ariaLabel} aria-busy={pending || undefined}>
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      <div aria-live="polite" className="mt-3 empty:hidden">
        {result && !result.ok ? (
          <Alert tone="error">
            <p>{result.error}</p>
            {state.failedToReach ? (
              <button type="button" className={`${buttonClass("secondary", "sm")} mt-2`} onClick={() => ref.current?.requestSubmit()}>
                <RotateCcw aria-hidden="true" className="h-4 w-4" /> {t("msg.tryAgain")}
              </button>
            ) : null}
          </Alert>
        ) : null}
        {result && result.ok && !redirectOf(result) && (result.message || successMessage) ? (
          <Alert tone="success">{result.message ?? successMessage}</Alert>
        ) : null}
      </div>
    </form>
  );
}

/** Submit button that reflects the surrounding ResilientForm's pending state. */
export function ResilientSubmit({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className,
  name,
  value,
  disabled,
}: {
  children: ReactNode;
  pendingText: string;
  variant?: "primary" | "secondary" | "danger" | "subtle" | "ghost";
  size?: "sm" | "md";
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const pending = useContext(PendingContext);
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} aria-disabled={pending || disabled || undefined} className={buttonClass(variant, size, className)}>
      {pending ? pendingText : children}
    </button>
  );
}
