import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { cn } from "./cn";

type Tone = "info" | "success" | "warning" | "error";
const styles: Record<Tone, string> = {
  info: "border-[#c7d6fb] bg-primary-soft text-ink",
  success: "border-[#bbf7d0] bg-success-soft text-ink",
  warning: "border-[#fde68a] bg-warning-soft text-ink",
  error: "border-[#fecaca] bg-danger-soft text-ink",
};
const icons = { info: Info, success: CheckCircle2, warning: TriangleAlert, error: AlertCircle };

export function Alert({ tone = "info", title, children, className, live }: { tone?: Tone; title?: string; children?: ReactNode; className?: string; live?: boolean }) {
  const Icon = icons[tone];
  return (
    <div
      role={live ? (tone === "error" ? "alert" : "status") : undefined}
      className={cn("flex gap-3 rounded-md border px-4 py-3 text-sm", styles[tone], className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        {title ? <p className="font-semibold">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}
