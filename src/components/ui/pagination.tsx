import Link from "next/link";
import { t } from "@/i18n";

export function Pagination({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (p: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={t("common.pagination")} className="mt-6 flex items-center justify-between gap-2 text-sm">
      {page > 1 ? (
        <Link className="rounded-md border border-line bg-panel px-3 py-2 hover:bg-canvas" href={hrefFor(page - 1)} rel="prev">
          {t("common.previous")}
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      <span aria-current="page">{t("common.page", { page, pages })}</span>
      {page < pages ? (
        <Link className="rounded-md border border-line bg-panel px-3 py-2 hover:bg-canvas" href={hrefFor(page + 1)} rel="next">
          {t("common.next")}
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}
