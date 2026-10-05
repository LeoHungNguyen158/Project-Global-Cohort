import type { Metadata, Viewport } from "next";
import "./globals.css";
import { t } from "@/i18n";

export const metadata: Metadata = {
  title: { default: t("app.name"), template: `%s · ${t("app.name")}` },
  description: t("app.description"),
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <a href="#main" className="skip-link">{t("app.skip")}</a>
        {children}
      </body>
    </html>
  );
}
