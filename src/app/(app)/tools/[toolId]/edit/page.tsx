import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isUuid } from "@/lib/forms";
import { restoreToolResource } from "@/app/actions/tools";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { loadScopeDirectory, loadTool, managerContext } from "@/components/tools/data";
import { canManageScope, hasScope, manageableScopes } from "@/components/tools/scopes";
import { ToolForm } from "@/components/tools/tool-form";
import { scopeOfRow, scopeValue } from "@/components/tools/validation";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("tools.editTitle") };

// Staff can edit entries in scopes they manage. Unknown entries, entries this person
// cannot see, and entries they cannot manage all return 404.
export default async function EditToolPage({ params }: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await params;
  if (!isUuid(toolId)) notFound();
  const user = await requireUser(`/tools/${toolId}/edit`);
  const [row, dir] = await Promise.all([loadTool(toolId.toLowerCase()), loadScopeDirectory()]);
  if (!row || !dir) notFound();
  const ctx = managerContext(user);
  const current = scopeOfRow(row);
  if (!canManageScope(ctx, current, dir)) notFound();
  const scopes = manageableScopes(ctx, dir);
  if (!hasScope(scopes, current)) scopes.unshift(current);
  const crumbs = [{ label: t("tools.title"), href: "/tools" }, { label: row.title }];

  return (
    <>
      <PageHeader title={t("tools.editTitle")} crumbs={crumbs} />
      <PageBody>
        {row.archived_at ? (
          <Alert tone="warning" className="max-w-3xl">
            <p>{t("tools.archivedEditNote")}</p>
            <ActionForm action={restoreToolResource} className="mt-3">
              <input type="hidden" name="tool_id" value={row.id} />
              <input type="hidden" name="return_to" value="/tools" />
              <SubmitButton size="sm" variant="secondary" pendingText={t("common.working")}>{t("tools.restore")}</SubmitButton>
            </ActionForm>
          </Alert>
        ) : (
          <ToolForm row={row} scopes={scopes} dir={dir} defaultScope={scopeValue(current)} returnTo="/tools" />
        )}
      </PageBody>
    </>
  );
}
