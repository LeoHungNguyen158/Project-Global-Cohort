"use client";
import { useEffect } from "react";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { t } from "@/i18n";
import { tRich } from "@/i18n/rich";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // Logged without request data; the digest links to the server log entry.
    console.error("page error", error.digest ?? "");
  }, [error]);
  return (
    <>
      <PageHeader title={t("common.errorHeading")} />
      <PageBody>
        <Alert tone="error" title={t("common.errorLoad")}>
          {error.digest ? tRich("common.errorBodyRef", { ref: <code>{error.digest}</code> }) : t("common.errorBody")}
        </Alert>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => retry()} className={buttonClass("primary")}>{t("common.retry")}</button>
          <a href="/activity" className={buttonClass("secondary")}>{t("common.goActivity")}</a>
        </div>
      </PageBody>
    </>
  );
}
