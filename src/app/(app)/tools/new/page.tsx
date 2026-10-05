import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { loadScopeDirectory, managerContext } from "@/components/tools/data";
import { hasScope, manageableScopes } from "@/components/tools/scopes";
import { ToolForm } from "@/components/tools/tool-form";
import { parseToolScope, scopeValue } from "@/components/tools/validation";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("tools.newTitle") };

// Only people who manage at least one scope (platform admins, cohort coordinators,
// course staff) can add resources; everyone else gets a 404 here and the server
// action refuses as well.
export default async function NewToolPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("/tools/new");
  const dir = await loadScopeDirectory();
  const crumbs = [{ label: t("tools.title"), href: "/tools" }, { label: t("tools.newTitle") }];
  if (!dir) {
    return (
      <>
        <PageHeader title={t("tools.newTitle")} crumbs={crumbs} />
        <PageBody>
          <Alert tone="error">{t("tools.loadError")}</Alert>
        </PageBody>
      </>
    );
  }
  const scopes = manageableScopes(managerContext(user), dir);
  if (scopes.length === 0) notFound();
  const requested = parseToolScope(sp.scope);
  const defaultScope = requested && hasScope(scopes, requested) ? scopeValue(requested) : scopeValue(scopes[0]);

  return (
    <>
      <PageHeader title={t("tools.newTitle")} crumbs={crumbs} />
      <PageBody>
        <ToolForm row={null} scopes={scopes} dir={dir} defaultScope={defaultScope} returnTo="/tools" />
      </PageBody>
    </>
  );
}
