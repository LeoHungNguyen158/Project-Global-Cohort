"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { bool, str, uuid } from "@/lib/forms";
import { markdownToSafeHtml } from "@/lib/markdown";
import { safeNextPath } from "@/lib/safe-redirect";
import { cleanText } from "@/components/public/text";
import { loadScopeDirectory, managerContext } from "@/components/tools/data";
import { canManageScope, hasScope, manageableScopes } from "@/components/tools/scopes";
import {
  TOOL_BODY_MAX,
  TOOL_DESCRIPTION_MAX,
  TOOL_TITLE_MAX,
  checkPosition,
  checkResourceUrl,
  isToolCategory,
  parseToolScope,
  scopeOfRow,
} from "@/components/tools/validation";
import { t } from "@/i18n";

const length = (s: string) => Array.from(s).length;

/** Where to go after a change: the list the person came from (Tools only), with a notice. */
function listPath(formData: FormData, notice: "saved" | "archived" | "restored", toolId: string): string {
  const back = new URL(safeNextPath(str(formData, "return_to", 1000), "/tools"), "http://local.invalid");
  const url = back.pathname === "/tools" ? back : new URL("/tools", "http://local.invalid");
  url.searchParams.delete("notice");
  url.searchParams.delete("tool");
  url.searchParams.delete("page");
  url.searchParams.set("notice", notice);
  url.searchParams.set("tool", toolId);
  return `${url.pathname}${url.search}`;
}

/**
 * Creates or updates a Tools entry. The scope must be one the person manages (checked
 * here for a clear message, and again by the tools_write policy). Markdown details are
 * converted to sanitized HTML on the server; links must be https.
 */
export async function saveToolResource(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: t("tools.error.signIn") };

  const editing = formData.has("tool_id");
  const toolId = uuid(formData, "tool_id");
  if (editing && !toolId) return { ok: false, error: t("tools.error.notFound") };

  const scope = parseToolScope(str(formData, "scope", 100));
  if (!scope) return { ok: false, error: t("tools.error.scope") };
  const category = str(formData, "category", 20);
  if (!isToolCategory(category)) return { ok: false, error: t("tools.error.category") };

  const rawTitle = formData.get("title");
  const title = cleanText(typeof rawTitle === "string" ? rawTitle : "").replace(/\s+/g, " ");
  if (!title || length(title) > TOOL_TITLE_MAX) return { ok: false, error: t("tools.error.title") };

  const rawDescription = formData.get("description");
  const description = cleanText(typeof rawDescription === "string" ? rawDescription : "", { multiline: true });
  if (length(description) > TOOL_DESCRIPTION_MAX) return { ok: false, error: t("tools.error.description") };

  const rawBody = formData.get("body");
  const body = typeof rawBody === "string" ? rawBody : "";
  if (length(body) > TOOL_BODY_MAX) return { ok: false, error: t("tools.error.body") };

  const link = checkResourceUrl(formData.get("url"));
  if (!link.ok) return { ok: false, error: t("tools.error.url") };
  const position = checkPosition(formData.get("position"));
  if (position === null) return { ok: false, error: t("tools.error.position") };

  const dir = await loadScopeDirectory();
  if (!dir) return { ok: false, error: t("tools.error.saveFailed") };
  const ctx = managerContext(user);
  if (!hasScope(manageableScopes(ctx, dir), scope)) return { ok: false, error: t("tools.error.scopeNotAllowed") };

  const values = {
    offering_id: scope.kind === "offering" ? scope.id : null,
    cohort_id: scope.kind === "cohort" ? scope.id : null,
    category,
    title,
    description,
    body_html: markdownToSafeHtml(body),
    url: link.url,
    position,
    published: bool(formData, "published"),
  };

  const supabase = await createClient();
  let savedId: string;
  if (toolId) {
    const { data: existing } = await supabase.from("tool_resources").select("id, offering_id, cohort_id, archived_at").eq("id", toolId).maybeSingle();
    if (!existing || !canManageScope(ctx, scopeOfRow(existing), dir)) return { ok: false, error: t("tools.error.notFound") };
    if (existing.archived_at) return { ok: false, error: t("tools.archivedEditNote") };
    const { data, error } = await supabase.from("tool_resources").update(values).eq("id", toolId).select("id").maybeSingle();
    if (error) return { ok: false, error: friendlyError(error, t("tools.error.saveFailed")) };
    if (!data) return { ok: false, error: t("tools.error.notFound") };
    savedId = data.id as string;
  } else {
    const { data, error } = await supabase.from("tool_resources").insert(values).select("id").single();
    if (error || !data) return { ok: false, error: friendlyError(error, t("tools.error.saveFailed")) };
    savedId = data.id as string;
  }
  revalidatePath("/tools");
  redirect(listPath(formData, "saved", savedId));
}

/** Hides an entry from participants (unpublished + archived). Staff can restore it later. */
export async function archiveToolResource(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const toolId = uuid(formData, "tool_id");
  if (!toolId) return { ok: false, error: t("tools.error.notFound") };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: t("tools.error.signIn") };
  // RLS (tools_write) limits this to people who manage the entry's scope; anyone else
  // matches no row and gets "not found".
  const { data, error } = await supabase
    .from("tool_resources")
    .update({ published: false, archived_at: new Date().toISOString() })
    .eq("id", toolId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: friendlyError(error, t("tools.error.archiveFailed")) };
  if (!data) return { ok: false, error: t("tools.error.notFound") };
  revalidatePath("/tools");
  redirect(listPath(formData, "archived", toolId));
}

/** Brings an archived entry back as a draft, so staff review it before publishing. */
export async function restoreToolResource(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const toolId = uuid(formData, "tool_id");
  if (!toolId) return { ok: false, error: t("tools.error.notFound") };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: t("tools.error.signIn") };
  const { data, error } = await supabase
    .from("tool_resources")
    .update({ archived_at: null, published: false })
    .eq("id", toolId)
    .not("archived_at", "is", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: friendlyError(error, t("tools.error.restoreFailed")) };
  if (!data) return { ok: false, error: t("tools.error.notFound") };
  revalidatePath("/tools");
  redirect(listPath(formData, "restored", toolId));
}
