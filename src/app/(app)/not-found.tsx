import Link from "next/link";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { buttonClass } from "@/components/ui/button";

// Shown for unknown pages and for records the signed-in person may not access;
// both look the same so the existence of other people's records is not revealed.
export default function NotFound() {
  return (
    <>
      <PageHeader title="Page not available" />
      <PageBody>
        <p className="max-w-2xl">
          This page does not exist, or your account does not have access to it. If you expected to see it, contact your
          instructor or program administrator.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/activity" className={buttonClass("primary")}>Go to Activity</Link>
          <Link href="/courses" className={buttonClass("secondary")}>Go to Courses</Link>
        </div>
      </PageBody>
    </>
  );
}
