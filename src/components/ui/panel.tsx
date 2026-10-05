import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export function Panel({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-[var(--radius-panel)] border border-line bg-panel", className)} {...props} />;
}

export function PanelHeader({ title, actions, level = 2, id }: { title: ReactNode; actions?: ReactNode; level?: 2 | 3; id?: string }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-6">
      <H id={id} className="text-lg font-semibold">{title}</H>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function AccentBar({ color }: { color: string }) {
  return <span aria-hidden="true" className="w-1.5 shrink-0 self-stretch rounded-l-[var(--radius-panel)]" style={{ backgroundColor: color }} />;
}
