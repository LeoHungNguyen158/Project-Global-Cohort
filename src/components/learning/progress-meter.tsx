import { t } from "@/i18n";
import { cn } from "@/components/ui/cn";

/** Required-item progress as text plus an accessible progress bar (never color alone). */
export function ProgressMeter({ done, total, percent, className }: { done: number; total: number; percent?: number | null; className?: string }) {
  const pct = percent ?? (total > 0 ? Math.round((done / total) * 100) : 0);
  const summary = t("learn.progress.summary", { done, total });
  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>{summary}</span>
        <span className="font-semibold" aria-hidden="true">{t("learn.progress.percent", { percent: pct })}</span>
      </div>
      <div
        role="progressbar"
        aria-label={t("learn.progress.label")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}% · ${summary}`}
        className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-[#e5e7eb]"
      >
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-success" : "bg-primary")} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  );
}
