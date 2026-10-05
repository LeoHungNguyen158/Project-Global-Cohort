import Link from "next/link";
import { t } from "@/i18n";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="bg-sidebar px-4 py-4 text-white sm:px-8">
        <span className="text-lg font-bold tracking-wide">{t("app.wordmark")}</span>{" "}
        <span className="text-sm uppercase tracking-[0.2em] text-sidebar-text">{t("app.tagline")}</span>
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 items-start justify-center px-4 py-10 focus:outline-none sm:py-16">
        <div className="w-full max-w-md rounded-lg border border-line bg-panel p-6 sm:p-8">{children}</div>
      </main>
      <footer className="px-4 py-4 text-center text-sm text-muted">
        <Link className="hover:underline" href="/help">{t("nav.help")}</Link>
        {" • "}
        <Link className="hover:underline" href="/catalog">{t("nav.catalog")}</Link>
        {" • "}
        <Link className="hover:underline" href="/privacy">{t("nav.privacy")}</Link>
        {" • "}
        <Link className="hover:underline" href="/terms">{t("nav.terms")}</Link>
        {" • "}
        <Link className="hover:underline" href="/accessibility">{t("nav.accessibility")}</Link>
      </footer>
    </div>
  );
}
