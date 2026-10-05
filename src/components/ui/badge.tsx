import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
const tones: Record<Tone, string> = {
  neutral: "bg-[#eef1f5] text-ink border-line",
  info: "bg-primary-soft text-primary border-[#c7d6fb]",
  success: "bg-success-soft text-success border-[#bbf7d0]",
  warning: "bg-warning-soft text-warning border-[#fde68a]",
  danger: "bg-danger-soft text-danger border-[#fecaca]",
};

/** Status badge: always carries text so color never encodes status alone. */
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}
