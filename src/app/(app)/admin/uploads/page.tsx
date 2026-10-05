import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/admin/access";
import { bytesToMegabytes } from "@/lib/admin/validation";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/time";
import { reviewUpload } from "@/app/actions/admin/uploads";
import { PageBody } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Textarea } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { Facts, SectionTitle } from "@/components/admin/badges";
import { ResultConfirm } from "@/components/admin/result-form";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.uploads.title") };

type Quarantined = {
  id: string;
  filename: string;
  declared_mime: string;
  size_bytes: number;
  purpose: string;
  owner_name: string;
  offering_code: string | null;
  course_code: string | null;
  version_no: number | null;
  created_at: string;
  completed_at: string | null;
};

const PURPOSES = ["lesson", "submission", "message", "avatar", "resource"] as const;

function purposeLabel(p: string) {
  return PURPOSES.includes(p as (typeof PURPOSES)[number]) ? t(`admin.uploads.purpose.${p as (typeof PURPOSES)[number]}`) : p;
}

function whereLabel(a: Quarantined) {
  if (a.offering_code) return t("admin.uploads.inOffering", { code: a.offering_code });
  if (a.course_code) return t("admin.uploads.inCourse", { code: a.course_code, n: a.version_no ?? "?" });
  return t("admin.uploads.notAttached");
}

export default async function AdminUploadsPage() {
  const ctx = await requirePlatformAdmin("/admin/uploads");
  const tz = ctx.user.timezone;
  const scanMode = serverEnv().uploadScanMode;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_quarantined_assets");
  if (error) throw new Error("Could not load the upload review queue");
  const assets = (data ?? []) as Quarantined[];

  return (
    <PageBody className="space-y-5">
      <SectionTitle title={t("admin.uploads.title")} description={t("admin.uploads.description")} />
      <Alert tone={scanMode === "quarantine" ? "info" : "warning"} title={t("admin.uploads.modeTitle", { mode: scanMode })}>
        <p>{scanMode === "quarantine" ? t("admin.uploads.modeQuarantine") : t("admin.uploads.modeNone")}</p>
        <p className="mt-1">{t("admin.uploads.noScanner")}</p>
      </Alert>
      <section aria-labelledby="upload-queue" className="space-y-3">
        <h3 id="upload-queue" className="text-lg font-semibold">{t("admin.uploads.queueTitle", { count: assets.length })}</h3>
        {assets.length === 0 ? (
          <EmptyState title={t("admin.uploads.empty")}>{scanMode === "quarantine" ? t("admin.uploads.emptyQuarantine") : t("admin.uploads.emptyNone")}</EmptyState>
        ) : (
          <ul className="space-y-3">
            {assets.map((a) => (
              <li key={a.id} className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-panel p-4">
                <p className="font-medium [overflow-wrap:anywhere]">{a.filename}</p>
                <Facts
                  items={[
                    { label: t("admin.uploads.type"), value: a.declared_mime },
                    { label: t("admin.uploads.size"), value: t("admin.uploads.megabytes", { mb: bytesToMegabytes(a.size_bytes) }) },
                    { label: t("admin.uploads.purposeLabel"), value: purposeLabel(a.purpose) },
                    { label: t("admin.uploads.where"), value: whereLabel(a) },
                    { label: t("admin.uploads.uploadedBy"), value: a.owner_name },
                    { label: t("admin.uploads.uploadedAt"), value: formatDateTime(a.completed_at ?? a.created_at, tz) },
                  ]}
                />
                <div className="flex flex-wrap gap-2">
                  <a href={`/api/admin/uploads/${a.id}`} className={buttonClass("secondary", "sm")} aria-label={t("admin.uploads.downloadFor", { name: a.filename })}>
                    {t("admin.uploads.download")}
                  </a>
                  <ResultConfirm
                    action={reviewUpload}
                    fields={{ asset: a.id, decision: "release" }}
                    trigger={t("admin.uploads.release")}
                    triggerVariant="primary"
                    triggerLabel={t("admin.uploads.releaseFor", { name: a.filename })}
                    title={t("admin.uploads.releaseTitle", { name: a.filename })}
                    description={t("admin.uploads.releaseDescription")}
                    confirmLabel={t("admin.uploads.release")}
                  />
                  <ResultConfirm
                    action={reviewUpload}
                    fields={{ asset: a.id, decision: "reject" }}
                    trigger={t("admin.uploads.reject")}
                    triggerLabel={t("admin.uploads.rejectFor", { name: a.filename })}
                    tone="danger"
                    title={t("admin.uploads.rejectTitle", { name: a.filename })}
                    description={t("admin.uploads.rejectDescription")}
                    confirmLabel={t("admin.uploads.reject")}
                  >
                    <Field label={t("admin.uploads.reason")} htmlFor={`reason-${a.id}`} hint={t("admin.uploads.reasonHint")} required>
                      <Textarea id={`reason-${a.id}`} name="reason" required minLength={3} maxLength={500} rows={3} aria-describedby={`reason-${a.id}-hint`} />
                    </Field>
                  </ResultConfirm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageBody>
  );
}
