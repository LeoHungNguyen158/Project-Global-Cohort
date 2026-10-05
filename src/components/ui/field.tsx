import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const control =
  "block w-full rounded-md border border-line bg-white px-3 py-2 text-ink placeholder:text-subtle min-h-10 disabled:bg-canvas aria-[invalid=true]:border-danger";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  required,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
        {required ? <span className="text-danger"> *<span className="sr-only"> (required)</span></span> : null}
      </label>
      {hint ? <p id={`${htmlFor}-hint`} className="text-xs text-muted">{hint}</p> : null}
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-danger" role="alert">{error}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-28", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, "pr-8", className)} {...props} />;
}

export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("flex min-h-10 items-center gap-2 text-sm", className)}>
      <input type="checkbox" className="h-4 w-4 rounded border-line accent-[var(--color-primary)]" {...props} />
      <span>{label}</span>
    </label>
  );
}
