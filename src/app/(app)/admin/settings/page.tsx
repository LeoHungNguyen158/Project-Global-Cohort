import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/admin/access";
import { bytesToMegabytes } from "@/lib/admin/validation";
import { mimeLabelKey, typeAllowedFor, UPLOAD_PURPOSES, VERIFIABLE_TYPES, type UploadPurpose } from "@/lib/admin/settings";
import { createClient } from "@/lib/supabase/server";
import { removeUploadLimit, setUploadLimit, updateSettings } from "@/app/actions/admin/settings";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { SectionTitle } from "@/components/admin/badges";
import { ResultConfirm, ResultForm } from "@/components/admin/result-form";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.settings.title") };

type Limit = { purpose: string; mime: string; max_bytes: number };
type BucketLimit = { purpose: string; bucket: string; file_size_limit: number | null };

function typeLabel(mime: string) {
  const key = mimeLabelKey(mime);
  return key ? t(key) : mime;
}

export default async function AdminSettingsPage() {
  await requirePlatformAdmin("/admin/settings");
  const supabase = await createClient();
  const [settingsRes, limitsRes, bucketsRes] = await Promise.all([
    supabase.from("platform_settings").select("key, value"),
    supabase.from("upload_limits").select("purpose, mime, max_bytes"),
    supabase.rpc("admin_storage_limits"),
  ]);
  if (settingsRes.error || limitsRes.error || bucketsRes.error) throw new Error("Could not load the settings");
  const settings = new Map(((settingsRes.data ?? []) as { key: string; value: string }[]).map((s) => [s.key, s.value]));
  const limits = (limitsRes.data ?? []) as Limit[];
  const buckets = new Map(((bucketsRes.data ?? []) as BucketLimit[]).map((b) => [b.purpose, b.file_size_limit]));
  const byPurpose = (p: UploadPurpose) =>
    limits.filter((l) => l.purpose === p).sort((a, b) => typeLabel(a.mime).localeCompare(typeLabel(b.mime)));

  return (
    <PageBody className="space-y-6">
      <SectionTitle title={t("admin.settings.title")} description={t("admin.settings.description")} />

      <Panel aria-labelledby="settings-general">
        <PanelHeader id="settings-general" title={t("admin.settings.general")} />
        <div className="p-4 sm:px-6">
          <ResultForm action={updateSettings} className="space-y-4" aria-label={t("admin.settings.general")}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("admin.settings.programName")} htmlFor="set-program" hint={t("admin.settings.programNameHint")} className="md:col-span-2">
                <Input id="set-program" name="program_name" maxLength={120} defaultValue={settings.get("program_name") ?? ""} aria-describedby="set-program-hint" />
              </Field>
              <Field label={t("admin.settings.supportEmail")} htmlFor="set-email" hint={t("admin.settings.supportEmailHint")}>
                <Input id="set-email" name="support_email" type="email" maxLength={320} defaultValue={settings.get("support_email") ?? ""} aria-describedby="set-email-hint" spellCheck={false} />
              </Field>
              <Field label={t("admin.settings.supportUrl")} htmlFor="set-url" hint={t("admin.settings.supportUrlHint")}>
                <Input id="set-url" name="support_url" type="url" maxLength={500} placeholder="https://" defaultValue={settings.get("support_url") ?? ""} aria-describedby="set-url-hint" spellCheck={false} />
              </Field>
            </div>
            <div>
              <Checkbox name="public_catalog" label={t("admin.settings.publicCatalog")} defaultChecked={settings.get("public_catalog") === "true"} aria-describedby="set-catalog-hint" />
              <p id="set-catalog-hint" className="text-xs text-muted">{t("admin.settings.publicCatalogHint")}</p>
            </div>
            <SubmitButton>{t("admin.common.save")}</SubmitButton>
          </ResultForm>
        </div>
      </Panel>

      <section aria-labelledby="settings-uploads" className="space-y-4">
        <div>
          <h3 id="settings-uploads" className="text-lg font-semibold">{t("admin.settings.uploads")}</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted">{t("admin.settings.uploadsHelp")}</p>
        </div>
        {UPLOAD_PURPOSES.map((purpose) => {
          const rows = byPurpose(purpose);
          const bucketLimit = buckets.get(purpose) ?? null;
          const missing = VERIFIABLE_TYPES.filter((v) => typeAllowedFor(purpose, v.mime) && !rows.some((r) => r.mime === v.mime));
          return (
            <Panel key={purpose} aria-labelledby={`limits-${purpose}`}>
              <PanelHeader id={`limits-${purpose}`} level={3} title={t(`admin.settings.purpose.${purpose}`)} />
              <div className="space-y-3 p-4 sm:px-6">
                <p className="text-sm text-muted">
                  {bucketLimit ? t("admin.settings.bucketLimit", { mb: bytesToMegabytes(bucketLimit) }) : t("admin.settings.noBucketLimit")}
                </p>
                {rows.length === 0 ? (
                  <p className="text-sm">{t("admin.settings.noTypes")}</p>
                ) : (
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {rows.map((r) => (
                      <li key={r.mime} className="flex flex-wrap items-end justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="font-medium">{typeLabel(r.mime)}</p>
                          <p className="text-xs text-muted [overflow-wrap:anywhere]">{r.mime}</p>
                        </div>
                        <div className="flex flex-wrap items-end gap-2">
                          <ResultForm action={setUploadLimit} flash className="flex items-end gap-2" aria-label={t("admin.settings.limitFor", { type: typeLabel(r.mime), purpose: t(`admin.settings.purpose.${purpose}`) })}>
                            <input type="hidden" name="purpose" value={purpose} />
                            <input type="hidden" name="mime" value={r.mime} />
                            <div>
                              <label htmlFor={`mb-${purpose}-${r.mime}`} className="block text-xs text-muted">{t("admin.settings.maxMb")}</label>
                              <Input id={`mb-${purpose}-${r.mime}`} name="max_mb" inputMode="decimal" required defaultValue={bytesToMegabytes(r.max_bytes)} className="w-28!" />
                            </div>
                            <SubmitButton size="sm" variant="secondary" aria-label={t("admin.settings.saveLimitFor", { type: typeLabel(r.mime) })}>{t("admin.common.saveShort")}</SubmitButton>
                          </ResultForm>
                          <ResultConfirm
                            action={removeUploadLimit}
                            fields={{ purpose, mime: r.mime }}
                            trigger={t("admin.settings.disallow")}
                            triggerLabel={t("admin.settings.disallowFor", { type: typeLabel(r.mime) })}
                            tone="danger"
                            title={t("admin.settings.disallowTitle", { type: typeLabel(r.mime), purpose: t(`admin.settings.purpose.${purpose}`) })}
                            description={t("admin.settings.disallowDescription")}
                            confirmLabel={t("admin.settings.disallow")}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {missing.length > 0 ? (
                  <ResultForm action={setUploadLimit} resetOnSuccess className="flex flex-wrap items-end gap-3" aria-label={t("admin.settings.allowFor", { purpose: t(`admin.settings.purpose.${purpose}`) })}>
                    <input type="hidden" name="purpose" value={purpose} />
                    <Field label={t("admin.settings.allowType")} htmlFor={`new-${purpose}`} className="min-w-[14rem] flex-1">
                      <Select id={`new-${purpose}`} name="mime" required defaultValue="">
                        <option value="" disabled>{t("admin.settings.chooseType")}</option>
                        {missing.map((m) => (
                          <option key={m.mime} value={m.mime}>{typeLabel(m.mime)}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t("admin.settings.maxMb")} htmlFor={`new-mb-${purpose}`}>
                      <Input id={`new-mb-${purpose}`} name="max_mb" inputMode="decimal" required className="w-28!" />
                    </Field>
                    <SubmitButton variant="secondary">{t("admin.settings.allow")}</SubmitButton>
                  </ResultForm>
                ) : null}
              </div>
            </Panel>
          );
        })}
      </section>
    </PageBody>
  );
}
