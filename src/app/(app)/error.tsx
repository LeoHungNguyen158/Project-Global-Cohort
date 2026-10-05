"use client";
import { useEffect } from "react";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // Logged without request data; the digest links to the server log entry.
    console.error("page error", error.digest ?? "");
  }, [error]);
  return (
    <>
      <PageHeader title="Something went wrong" />
      <PageBody>
        <Alert tone="error" title="This page could not be loaded.">
          Nothing was changed. Try again; if it keeps failing, contact support
          {error.digest ? <> and mention reference <code>{error.digest}</code></> : null}.
        </Alert>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => retry()} className={buttonClass("primary")}>Try again</button>
          <a href="/activity" className={buttonClass("secondary")}>Go to Activity</a>
        </div>
      </PageBody>
    </>
  );
}
