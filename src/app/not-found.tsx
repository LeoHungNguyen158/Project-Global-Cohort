import Link from "next/link";
import type { Metadata } from "next";
import { AppShell, PublicShell } from "@/components/layout/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { buttonClass } from "@/components/ui/button";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("common.notFoundTitle") };

// Shown for addresses that match no page; signed-in people keep their navigation.
// Records someone may not access inside the app use (app)/not-found.tsx, with the
// same wording, so a missing page and a forbidden record look alike.
export default async function RootNotFound() {
  const user = await getCurrentUser();
  const body = (
    <div className="px-4 py-10 sm:px-8">
      <h1 className="text-[1.85rem] leading-tight [font-family:Georgia,'Times_New_Roman',serif]">{t("common.notFoundTitle")}</h1>
      <p className="mt-3 max-w-2xl">{t("common.notFoundBody")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/activity" className={buttonClass("primary")}>{t("common.goActivity")}</Link>
        <Link href="/courses" className={buttonClass("secondary")}>{t("common.goCourses")}</Link>
      </div>
    </div>
  );
  return user ? <AppShell user={user}>{body}</AppShell> : <PublicShell>{body}</PublicShell>;
}
