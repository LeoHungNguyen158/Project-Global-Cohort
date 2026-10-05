"use server";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { int, str } from "@/lib/forms";
import type { ActionResult } from "@/lib/errors";
import { actionAdmin, fail } from "@/lib/admin/action-utils";
import { parseCsv } from "@/lib/admin/csv";
import {
  IMPORT_FIELDS,
  INVITE_ROLES,
  MAX_IMPORT_CHARS,
  MAX_IMPORT_ROWS,
  mergeIssues,
  prepareImportRows,
  rowsForDatabaseCheck,
  summarize,
  type ColumnMapping,
  type ImportDefaults,
  type ImportSummary,
  type InviteRole,
  type PreparedRow,
} from "@/lib/admin/import";
import { expiryFromDays } from "@/lib/admin/validation";
import { deliverInvitation, type DeliveryDecision } from "@/lib/admin/invitations";
import { friendlyError } from "@/lib/errors";
import { t } from "@/i18n";

export type PreviewRow = Omit<PreparedRow, "issues"> & { issues: string[]; existingAccount: boolean };
export type ImportPreview = { rows: PreviewRow[]; summary: ImportSummary };

export type RowOutcome = {
  line: number;
  email: string;
  status: "emailed" | "email_failed" | "notified" | "not_notified" | "not_created" | "skipped";
  detail?: string;
};
export type ImportOutcome = {
  created: number;
  emailed: number;
  emailFailed: number;
  notified: number;
  notCreated: number;
  skipped: number;
  rows: RowOutcome[];
};

type Checked = { rows: PreviewRow[]; resolved: Map<number, { cohort: string | null; offering: string | null }> };

/** Reads the wizard's inputs. Nothing from the browser is trusted beyond being data. */
function readInput(formData: FormData): { text: string; mapping: ColumnMapping; defaults: ImportDefaults; hasHeader: boolean } | { error: string } {
  const raw = formData.get("csv");
  const text = typeof raw === "string" ? raw : "";
  if (!text.trim()) return { error: t("admin.import.error.empty") };
  if (text.length > MAX_IMPORT_CHARS) return { error: t("admin.import.error.tooLarge") };
  let mapping: ColumnMapping = {};
  try {
    const parsed = JSON.parse(str(formData, "mapping", 2000) || "{}") as Record<string, unknown>;
    for (const field of IMPORT_FIELDS) {
      const v = parsed[field];
      if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 200) mapping[field] = v;
    }
  } catch {
    mapping = {};
  }
  if (mapping.email === undefined) return { error: t("admin.import.error.noEmailColumn") };
  const roleRaw = str(formData, "default_role", 20);
  const defaults: ImportDefaults = {
    role: INVITE_ROLES.includes(roleRaw as InviteRole) ? (roleRaw as InviteRole) : null,
    cohortCode: str(formData, "default_cohort", 64),
    offeringCode: str(formData, "default_offering", 64),
  };
  return { text, mapping, defaults, hasHeader: str(formData, "has_header", 1) === "1" };
}

async function checkRows(supabase: SupabaseClient, formData: FormData): Promise<Checked | { error: string }> {
  const input = readInput(formData);
  if ("error" in input) return input;
  const parsed = parseCsv(input.text, { maxRecords: MAX_IMPORT_ROWS + 50 });
  if (parsed.error) return { error: t("admin.import.error.quote", { line: parsed.error.line }) };
  const { rows, dataRowCount } = prepareImportRows(parsed.records, input.mapping, input.defaults, { hasHeader: input.hasHeader });
  if (parsed.truncated || dataRowCount > MAX_IMPORT_ROWS) return { error: t("admin.import.error.tooMany", { max: MAX_IMPORT_ROWS }) };
  if (rows.length === 0) return { error: t("admin.import.error.noRows") };

  const toCheck = rowsForDatabaseCheck(rows);
  const found = new Map<number, string[]>();
  const resolved = new Map<number, { cohort: string | null; offering: string | null }>();
  const existing = new Set<number>();
  if (toCheck.length > 0) {
    const { data, error } = await supabase.rpc("admin_check_import", { p_rows: toCheck });
    if (error) return { error: friendlyError(error, t("admin.common.failed")) };
    for (const r of (data ?? []) as { row_no: number; cohort_id: string | null; offering_id: string | null; existing_account: boolean; errors: string[] }[]) {
      found.set(r.row_no, r.errors ?? []);
      resolved.set(r.row_no, { cohort: r.cohort_id, offering: r.offering_id });
      if (r.existing_account) existing.add(r.row_no);
    }
  }
  const merged = mergeIssues(rows, found).map((r) => ({ ...r, existingAccount: existing.has(r.line) }));
  return { rows: merged, resolved };
}

/** Dry run: validates every row (locally and against the database) and creates nothing. */
export async function previewImport(_prev: ActionResult<ImportPreview> | null, formData: FormData): Promise<ActionResult<ImportPreview>> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const supabase = await createClient();
  const checked = await checkRows(supabase, formData);
  if ("error" in checked) return fail(checked.error);
  return { ok: true, data: { rows: checked.rows, summary: summarize(checked.rows as PreparedRow[]) } };
}

/**
 * Creates invitations for the rows that pass every check (re-run here, never taken
 * from the preview) and sends invitation emails. Rows with problems are skipped.
 */
export async function confirmImport(_prev: ActionResult<ImportOutcome> | null, formData: FormData): Promise<ActionResult<ImportOutcome>> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const days = int(formData, "expires_days");
  const expiresAt = days === null ? null : expiryFromDays(days);
  if (!expiresAt) return fail(t("admin.invite.error.expiry"));

  const supabase = await createClient();
  const checked = await checkRows(supabase, formData);
  if ("error" in checked) return fail(checked.error);
  const valid = checked.rows.filter((r) => r.issues.length === 0 && r.role);
  if (valid.length === 0) return fail(t("admin.import.error.nothingValid"));

  const outcome: ImportOutcome = { created: 0, emailed: 0, emailFailed: 0, notified: 0, notCreated: 0, skipped: 0, rows: [] };
  for (const r of checked.rows) {
    if (r.issues.length > 0) {
      outcome.skipped++;
      outcome.rows.push({ line: r.line, email: r.email, status: "skipped" });
    }
  }

  // Small worker pool: keeps the request reasonably fast without flooding the email service.
  const resolvedIds = checked.resolved;
  const queue = [...valid];
  const results: RowOutcome[] = [];
  async function worker() {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const ids = resolvedIds.get(row.line);
      const { data, error } = await supabase.rpc("admin_create_invitation", {
        p_email: row.email,
        p_role: row.role,
        p_cohort: ids?.cohort ?? null,
        p_offering: ids?.offering ?? null,
        p_expires_at: expiresAt,
      });
      if (error) {
        results.push({ line: row.line, email: row.email, status: "not_created", detail: friendlyError(error, t("admin.common.failed")) });
        continue;
      }
      const delivery = await deliverInvitation(supabase, data as DeliveryDecision, row.displayName || null);
      if (delivery.status === "accepted_by_provider") results.push({ line: row.line, email: row.email, status: "emailed" });
      else if (delivery.status === "failed") results.push({ line: row.line, email: row.email, status: "email_failed", detail: delivery.error });
      else if (delivery.status === "existing_account_notified") results.push({ line: row.line, email: row.email, status: "notified" });
      else results.push({ line: row.line, email: row.email, status: "not_notified" });
    }
  }
  await Promise.all([worker(), worker(), worker()]);

  for (const r of results) {
    if (r.status !== "not_created") outcome.created++;
    if (r.status === "emailed") outcome.emailed++;
    if (r.status === "email_failed") outcome.emailFailed++;
    if (r.status === "notified") outcome.notified++;
    if (r.status === "not_created") outcome.notCreated++;
  }
  outcome.rows = [...outcome.rows, ...results].sort((a, b) => a.line - b.line);
  revalidatePath("/admin/invitations");
  revalidatePath("/admin");
  return { ok: true, message: t("admin.import.done", { created: outcome.created }), data: outcome };
}
