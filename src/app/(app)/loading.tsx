import { t } from "@/i18n";

export default function Loading() {
  return (
    <div className="px-4 py-6 sm:px-8" role="status" aria-live="polite">
      <span className="sr-only">{t("common.loading")}</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="h-8 w-64 animate-pulse rounded bg-line" />
        <div className="h-24 w-full animate-pulse rounded bg-line/70" />
        <div className="h-24 w-full animate-pulse rounded bg-line/70" />
      </div>
    </div>
  );
}
