import Link from "next/link";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { buttonClass } from "@/components/ui/button";
import { t } from "@/i18n";

// Shown for unknown pages and for records the signed-in person may not access;
// both look the same so the existence of other people's records is not revealed.
export default function NotFound() {
  return (
    <>
      <PageHeader title={t("common.notFoundTitle")} />
      <PageBody>
        <p className="max-w-2xl">{t("common.notFoundBody")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/activity" className={buttonClass("primary")}>{t("common.goActivity")}</Link>
          <Link href="/courses" className={buttonClass("secondary")}>{t("common.goCourses")}</Link>
        </div>
      </PageBody>
    </>
  );
}
