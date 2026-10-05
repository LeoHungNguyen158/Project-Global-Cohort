import Link from "next/link";
import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Sidebar } from "./sidebar";
import { signOut } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { isAdminish, type UserContext } from "@/lib/auth";
import { t } from "@/i18n";

export async function AppShell({ user, children }: { user: UserContext; children: ReactNode }) {
  const supabase = await createClient();
  const { data: unread } = await supabase.rpc("unread_message_count");
  return (
    <div className="min-h-screen">
      <Sidebar displayName={user.displayName} unreadMessages={Number(unread ?? 0)} showAdmin={isAdminish(user)} signOutAction={signOut} />
      <div className="lg:pl-[232px]">
        <main id="main" tabIndex={-1} className="min-h-screen focus:outline-none">
          {children}
        </main>
      </div>
      <Link
        href="/help"
        className="fixed bottom-4 right-4 z-10 inline-flex h-12 w-12 items-center justify-center rounded-full border border-line bg-panel text-ink shadow-sm hover:bg-canvas"
      >
        <CircleHelp aria-hidden="true" className="h-6 w-6" />
        <span className="sr-only">{t("nav.help")}</span>
      </Link>
    </div>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="bg-sidebar px-4 py-3 text-white sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/login" className="font-bold tracking-wide">{t("app.name")}</Link>
          <nav aria-label="Site" className="flex gap-4 text-sm">
            <Link className="hover:underline" href="/catalog">{t("nav.catalog")}</Link>
            <Link className="hover:underline" href="/help">{t("nav.help")}</Link>
            <Link className="hover:underline" href="/login">{t("auth.signIn")}</Link>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="focus:outline-none">{children}</main>
      <footer className="border-t border-line px-4 py-4 text-sm text-muted sm:px-8">
        <Link className="hover:underline" href="/privacy">{t("nav.privacy")}</Link>
        {" • "}
        <Link className="hover:underline" href="/terms">{t("nav.terms")}</Link>
        {" • "}
        <Link className="hover:underline" href="/accessibility">{t("nav.accessibility")}</Link>
      </footer>
    </div>
  );
}
