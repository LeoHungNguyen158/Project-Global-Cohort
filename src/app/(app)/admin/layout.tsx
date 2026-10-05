import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";
import { AdminNav, type AdminTab } from "@/components/admin/admin-nav";
import { FlashRegion } from "@/components/admin/flash";
import { t } from "@/i18n";

// Administration is for platform administrators and cohort coordinators; anyone else
// gets the ordinary "page not available" response. Every page checks again, and the
// database authorizes every read and change.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await requireAdmin("/admin");
  const platform = ctx.isPlatformAdmin;
  const supabase = await createClient();
  const { data: program } = await supabase.from("platform_settings").select("value").eq("key", "program_name").maybeSingle();
  const programName = (program?.value ?? "").trim();
  const tabs: AdminTab[] = [
    { href: "/admin", label: t("admin.nav.overview") },
    ...(platform ? [{ href: "/admin/users", label: t("admin.nav.users") }] : []),
    { href: "/admin/invitations", label: t("admin.nav.invitations") },
    { href: "/admin/import", label: t("admin.nav.import") },
    { href: "/admin/access-requests", label: t("admin.nav.accessRequests") },
    { href: "/admin/cohorts", label: t("admin.nav.cohorts") },
    ...(platform ? [{ href: "/admin/courses", label: t("admin.nav.courses") }] : []),
    { href: "/admin/offerings", label: t("admin.nav.offerings") },
    { href: "/admin/reports", label: t("admin.nav.reports") },
    { href: "/admin/audit", label: t("admin.nav.audit") },
    ...(platform
      ? [
          { href: "/admin/uploads", label: t("admin.nav.uploads") },
          { href: "/admin/settings", label: t("admin.nav.settings") },
        ]
      : []),
  ];
  return (
    <div>
      <header className="border-b border-line bg-panel">
        <div className="px-4 pb-3 pt-4 sm:px-8">
          {programName ? <p className="text-xs font-semibold uppercase tracking-wide text-muted [overflow-wrap:anywhere]">{programName}</p> : null}
          <h1 className="text-[1.75rem] leading-tight [font-family:Georgia,'Times_New_Roman',serif]">{t("admin.title")}</h1>
          <p className="mt-1 text-sm text-muted">
            {platform ? t("admin.scope.platform") : t("admin.scope.coordinator", { count: ctx.cohortIds.length })}
          </p>
        </div>
        <AdminNav label={t("admin.nav.label")} tabs={tabs} />
      </header>
      {children}
      <FlashRegion />
    </div>
  );
}
