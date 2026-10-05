"use client";
import { useId, useMemo, useState, useTransition, type ChangeEvent } from "react";
import Link from "next/link";
import { parseCsv } from "@/lib/admin/csv";
import { IMPORT_FIELDS, MAX_IMPORT_CHARS, MAX_IMPORT_ROWS, guessMapping, type ColumnMapping, type ImportField, type ImportIssue } from "@/lib/admin/import";
import { confirmImport, previewImport, type ImportOutcome, type ImportPreview, type PreviewRow, type RowOutcome } from "@/app/actions/admin/import";
import type { ActionResult } from "@/lib/errors";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { Table, td, th } from "@/components/admin/scroll-table";
import { t } from "@/i18n/client/admin";

export type CodeOption = { code: string; label: string };

const EXPIRY_DAYS = [3, 7, 14, 30, 60, 90];

function issueText(row: PreviewRow, code: string): string {
  if (code === "duplicate_email" && row.duplicateOfLine) return t("admin.import.issue.duplicate_email_line", { line: row.duplicateOfLine });
  return t(`admin.import.issue.${code as ImportIssue}`);
}

function outcomeText(o: RowOutcome): string {
  switch (o.status) {
    case "emailed":
      return t("admin.import.outcome.emailed");
    case "email_failed":
      return t("admin.import.outcome.emailFailed", { error: o.detail ?? "" });
    case "notified":
      return t("admin.import.outcome.notified");
    case "not_notified":
      return t("admin.import.outcome.notNotified");
    case "not_created":
      return t("admin.import.outcome.notCreated", { error: o.detail ?? "" });
    default:
      return t("admin.import.outcome.skipped");
  }
}

const OUTCOME_TONE: Record<RowOutcome["status"], "success" | "warning" | "danger" | "info" | "neutral"> = {
  emailed: "success",
  notified: "info",
  not_notified: "warning",
  email_failed: "warning",
  not_created: "danger",
  skipped: "neutral",
};

/**
 * CSV enrollment import: provide a file or pasted text, match columns, run a dry run
 * (creates nothing), then confirm separately. The server re-parses and re-checks the
 * same input on both steps; nothing computed here is trusted.
 */
export function ImportWizard({ cohorts, offerings }: { cohorts: CodeOption[]; offerings: CodeOption[] }) {
  const uid = useId();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [defaultRole, setDefaultRole] = useState("participant");
  const [defaultCohort, setDefaultCohort] = useState("");
  const [defaultOffering, setDefaultOffering] = useState("");
  const [preview, setPreview] = useState<ActionResult<ImportPreview> | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expiryDays, setExpiryDays] = useState("14");
  const [result, setResult] = useState<ActionResult<ImportOutcome> | null>(null);
  const [checking, startChecking] = useTransition();
  const [creating, startCreating] = useTransition();

  const parsed = useMemo(() => (text.trim() ? parseCsv(text, { maxRecords: MAX_IMPORT_ROWS + 50 }) : null), [text]);
  const headerCells = parsed?.records[0]?.cells ?? [];
  const columnCount = useMemo(() => Math.max(0, ...(parsed?.records.slice(0, 20).map((r) => r.cells.length) ?? [0])), [parsed]);
  const columns = Array.from({ length: columnCount }, (_, i) =>
    hasHeader && headerCells[i]?.trim() ? t("admin.import.columnNamed", { n: i + 1, name: headerCells[i].trim() }) : t("admin.import.column", { n: i + 1 }),
  );
  const dataRows = parsed ? parsed.records.length - (hasHeader ? 1 : 0) : 0;

  function invalidate() {
    setPreview(null);
    setResult(null);
  }

  function applyText(value: string, name: string | null) {
    setText(value);
    setFileName(name);
    invalidate();
    const first = value.trim() ? parseCsv(value, { maxRecords: 1 }).records[0]?.cells ?? [] : [];
    const guess = guessMapping(first);
    // Without a recognizable header, assume the first column holds addresses.
    setHasHeader(guess.email !== undefined || first.length === 0);
    setMapping(guess.email !== undefined ? guess : { email: 0 });
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setInputError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_CHARS * 4) {
      setInputError(t("admin.import.error.tooLarge"));
      return;
    }
    const content = await file.text();
    if (content.length > MAX_IMPORT_CHARS) {
      setInputError(t("admin.import.error.tooLarge"));
      return;
    }
    applyText(content, file.name);
  }

  function formData(extra: Record<string, string> = {}) {
    const fd = new FormData();
    fd.set("csv", text);
    fd.set("mapping", JSON.stringify(mapping));
    fd.set("has_header", hasHeader ? "1" : "0");
    fd.set("default_role", defaultRole);
    fd.set("default_cohort", defaultCohort);
    fd.set("default_offering", defaultOffering);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return fd;
  }

  function runPreview() {
    setResult(null);
    startChecking(async () => {
      try {
        setPreview(await previewImport(null, formData()));
      } catch {
        setPreview({ ok: false, error: t("admin.import.error.network") });
      }
    });
  }

  function runConfirm() {
    startCreating(async () => {
      try {
        const res = await confirmImport(null, formData({ expires_days: expiryDays }));
        setResult(res);
        if (res.ok) {
          setConfirmOpen(false);
          setPreview(null);
        }
      } catch {
        setResult({ ok: false, error: t("admin.import.error.network") });
      }
    });
  }

  const previewData = preview?.ok ? preview.data : undefined;
  const shownRows = previewData ? previewData.rows.filter((r) => !onlyProblems || r.issues.length > 0) : [];
  const outcome = result?.ok ? result.data : undefined;

  return (
    <div className="space-y-8">
      <section aria-labelledby={`${uid}-step1`} className="space-y-4">
        <h3 id={`${uid}-step1`} className="text-lg font-semibold">{t("admin.import.step1")}</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label={t("admin.import.file")} htmlFor={`${uid}-file`} hint={t("admin.import.fileHint", { max: MAX_IMPORT_ROWS })}>
            <input
              id={`${uid}-file`}
              type="file"
              accept=".csv,text/csv,text/plain,.txt"
              onChange={onFile}
              aria-describedby={`${uid}-file-hint`}
              className="block w-full min-h-10 rounded-md border border-line bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-canvas file:px-3 file:py-1"
            />
          </Field>
          <Field label={t("admin.import.paste")} htmlFor={`${uid}-text`} hint={t("admin.import.pasteHint")}>
            <Textarea
              id={`${uid}-text`}
              value={text}
              onChange={(e) => applyText(e.target.value, null)}
              rows={6}
              spellCheck={false}
              aria-describedby={`${uid}-text-hint`}
              className="font-mono text-sm"
            />
          </Field>
        </div>
        {inputError ? <Alert tone="error">{inputError}</Alert> : null}
        {parsed ? (
          <p className="text-sm" aria-live="polite">
            {fileName ? t("admin.import.loadedFile", { name: fileName }) + " " : ""}
            {t("admin.import.detected", { rows: Math.max(0, dataRows), columns: columnCount })}
            {parsed.error ? ` ${t("admin.import.error.quote", { line: parsed.error.line })}` : ""}
          </p>
        ) : null}
        {dataRows > MAX_IMPORT_ROWS ? <Alert tone="warning">{t("admin.import.error.tooMany", { max: MAX_IMPORT_ROWS })}</Alert> : null}
      </section>

      {parsed && columnCount > 0 ? (
        <section aria-labelledby={`${uid}-step2`} className="space-y-4">
          <h3 id={`${uid}-step2`} className="text-lg font-semibold">{t("admin.import.step2")}</h3>
          <Checkbox
            label={t("admin.import.hasHeader")}
            checked={hasHeader}
            onChange={(e) => {
              setHasHeader(e.target.checked);
              invalidate();
            }}
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {IMPORT_FIELDS.map((field: ImportField) => (
              <Field key={field} label={t(`admin.import.field.${field}`)} htmlFor={`${uid}-map-${field}`} required={field === "email"}>
                <Select
                  id={`${uid}-map-${field}`}
                  value={String(mapping[field] ?? -1)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setMapping((m) => {
                      const next = { ...m };
                      if (v < 0) delete next[field];
                      else next[field] = v;
                      return next;
                    });
                    invalidate();
                  }}
                >
                  <option value="-1">{t("admin.import.notInFile")}</option>
                  {columns.map((c, i) => (
                    <option key={i} value={i}>{c}</option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <fieldset className="rounded-md border border-line p-4">
            <legend className="px-1 text-sm font-semibold">{t("admin.import.defaults")}</legend>
            <p className="mb-3 text-sm text-muted">{t("admin.import.defaultsHint")}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("admin.import.defaultRole")} htmlFor={`${uid}-def-role`}>
                <Select id={`${uid}-def-role`} value={defaultRole} onChange={(e) => { setDefaultRole(e.target.value); invalidate(); }}>
                  <option value="participant">{t("admin.inviteRole.participant")}</option>
                  <option value="instructor">{t("admin.inviteRole.instructor")}</option>
                  <option value="ta">{t("admin.inviteRole.ta")}</option>
                  <option value="">{t("admin.import.noDefault")}</option>
                </Select>
              </Field>
              <Field label={t("admin.import.defaultCohort")} htmlFor={`${uid}-def-cohort`}>
                <Select id={`${uid}-def-cohort`} value={defaultCohort} onChange={(e) => { setDefaultCohort(e.target.value); invalidate(); }}>
                  <option value="">{t("admin.import.noDefault")}</option>
                  {cohorts.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("admin.import.defaultOffering")} htmlFor={`${uid}-def-offering`}>
                <Select id={`${uid}-def-offering`} value={defaultOffering} onChange={(e) => { setDefaultOffering(e.target.value); invalidate(); }}>
                  <option value="">{t("admin.import.noDefault")}</option>
                  {offerings.map((o) => (
                    <option key={o.code} value={o.code}>{o.label}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </fieldset>
        </section>
      ) : null}

      {parsed && columnCount > 0 ? (
        <section aria-labelledby={`${uid}-step3`} className="space-y-4">
          <h3 id={`${uid}-step3`} className="text-lg font-semibold">{t("admin.import.step3")}</h3>
          <p className="text-sm text-muted">{t("admin.import.dryRunHint")}</p>
          <Button variant="primary" onClick={runPreview} disabled={checking || mapping.email === undefined || dataRows > MAX_IMPORT_ROWS}>
            {checking ? t("admin.import.checking") : t("admin.import.check")}
          </Button>
          {mapping.email === undefined ? <p className="text-sm text-danger">{t("admin.import.error.noEmailColumn")}</p> : null}
          <div aria-live="polite" className="space-y-4 empty:hidden">
            {preview && !preview.ok ? <Alert tone="error">{preview.error}</Alert> : null}
            {previewData ? (
              <Alert tone={previewData.summary.invalid > 0 ? "warning" : "success"} title={t("admin.import.previewTitle")}>
                {t("admin.import.summary", { total: previewData.summary.total, valid: previewData.summary.valid, invalid: previewData.summary.invalid })}
              </Alert>
            ) : null}
          </div>
          {previewData ? (
            <>
              <Checkbox label={t("admin.import.onlyProblems")} checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
              <Table caption={t("admin.import.previewCaption")}>
                <thead>
                  <tr>
                    <th scope="col" className={th}>{t("admin.import.line")}</th>
                    <th scope="col" className={th}>{t("admin.common.email")}</th>
                    <th scope="col" className={th}>{t("admin.common.name")}</th>
                    <th scope="col" className={th}>{t("admin.common.role")}</th>
                    <th scope="col" className={th}>{t("admin.import.scope")}</th>
                    <th scope="col" className={th}>{t("admin.import.result")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRows.map((r) => (
                    <tr key={r.line}>
                      <td className={`${td} tabular-nums`}>{r.line}</td>
                      <td className={`${td} whitespace-nowrap`}>{r.email || "—"}</td>
                      <td className={td}>{r.displayName || "—"}</td>
                      <td className={td}>{r.role ? t(`admin.inviteRole.${r.role}`) : r.rawRole || "—"}</td>
                      <td className={td}>{[r.cohortCode, r.offeringCode].filter(Boolean).join(" / ") || "—"}</td>
                      <td className={td}>
                        {r.issues.length === 0 ? (
                          <>
                            <Badge tone="success">{t("admin.import.ready")}</Badge>
                            {r.existingAccount ? <span className="mt-1 block text-xs text-muted">{t("admin.import.existingAccount")}</span> : null}
                          </>
                        ) : (
                          <ul className="space-y-1">
                            {r.issues.map((code) => (
                              <li key={code} className="flex items-start gap-1">
                                <Badge tone="danger">{t("admin.import.problem")}</Badge>
                                <span>{issueText(r, code)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          ) : null}
        </section>
      ) : null}

      {previewData ? (
        <section aria-labelledby={`${uid}-step4`} className="space-y-3">
          <h3 id={`${uid}-step4`} className="text-lg font-semibold">{t("admin.import.step4")}</h3>
          {previewData.summary.valid === 0 ? (
            <p className="text-sm">{t("admin.import.nothingToCreate")}</p>
          ) : (
            <>
              <p className="text-sm text-muted">{t("admin.import.confirmHint")}</p>
              <button type="button" className={buttonClass("primary")} onClick={() => setConfirmOpen(true)}>
                {t("admin.import.createButton", { count: previewData.summary.valid })}
              </button>
            </>
          )}
        </section>
      ) : null}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title={t("admin.import.confirmTitle")}>
        <div className="space-y-4">
          <p>
            {t("admin.import.confirmText", { valid: previewData?.summary.valid ?? 0, invalid: previewData?.summary.invalid ?? 0 })}
          </p>
          <Field label={t("admin.invite.expires")} htmlFor={`${uid}-expiry`}>
            <Select id={`${uid}-expiry`} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)}>
              {EXPIRY_DAYS.map((d) => (
                <option key={d} value={d}>{t("admin.invite.days", { days: d })}</option>
              ))}
            </Select>
          </Field>
          <p className="text-sm text-muted">{t("admin.import.rateNote")}</p>
          {result && !result.ok ? <Alert tone="error">{result.error}</Alert> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>{t("admin.common.cancel")}</Button>
            <Button variant="primary" onClick={runConfirm} disabled={creating}>
              {creating ? t("admin.import.creating") : t("admin.import.confirmButton")}
            </Button>
          </div>
        </div>
      </Dialog>

      <div aria-live="polite" className="empty:hidden">
        {outcome ? (
          <section aria-labelledby={`${uid}-result`} className="space-y-4">
            <h3 id={`${uid}-result`} className="text-lg font-semibold">{t("admin.import.resultTitle")}</h3>
            <Alert tone={outcome.created > 0 && outcome.emailFailed === 0 && outcome.notCreated === 0 ? "success" : "warning"}>
              <p>{result?.ok ? result.message : null}</p>
              <ul className="mt-1 list-disc pl-5">
                <li>{t("admin.import.count.emailed", { count: outcome.emailed })}</li>
                <li>{t("admin.import.count.notified", { count: outcome.notified })}</li>
                <li>{t("admin.import.count.emailFailed", { count: outcome.emailFailed })}</li>
                <li>{t("admin.import.count.notCreated", { count: outcome.notCreated })}</li>
                <li>{t("admin.import.count.skipped", { count: outcome.skipped })}</li>
              </ul>
            </Alert>
            <Table caption={t("admin.import.resultCaption")}>
              <thead>
                <tr>
                  <th scope="col" className={th}>{t("admin.import.line")}</th>
                  <th scope="col" className={th}>{t("admin.common.email")}</th>
                  <th scope="col" className={th}>{t("admin.import.result")}</th>
                </tr>
              </thead>
              <tbody>
                {outcome.rows.map((o) => (
                  <tr key={o.line}>
                    <td className={`${td} tabular-nums`}>{o.line}</td>
                    <td className={`${td} whitespace-nowrap`}>{o.email || "—"}</td>
                    <td className={td}>
                      <Badge tone={OUTCOME_TONE[o.status]}>{t(`admin.import.status.${o.status}`)}</Badge>
                      <span className="ml-1">{outcomeText(o)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Link href="/admin/invitations" className={buttonClass("secondary")}>{t("admin.import.viewInvitations")}</Link>
          </section>
        ) : null}
      </div>
    </div>
  );
}
