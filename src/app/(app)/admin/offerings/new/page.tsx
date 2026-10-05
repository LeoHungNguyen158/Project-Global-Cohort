import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin/access";
import { listAdminCohorts } from "@/lib/admin/data";
import { isUuid } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { createOffering } from "@/app/actions/admin/offerings";
import { PageBody } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { SectionTitle } from "@/components/admin/badges";
import { OfferingFields } from "@/components/admin/offering-fields";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.offerings.new") };

type VersionOption = { course_id: string; course_code: string; course_title: string; version_id: string; version_no: number; version_status: string; version_title: string };

export default async function NewOfferingPage({ searchParams }: { searchParams: Promise<{ cohort?: string; course?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireAdmin("/admin/offerings/new");
  const supabase = await createClient();
  const [cohorts, { data, error }] = await Promise.all([listAdminCohorts(ctx), supabase.rpc("admin_course_version_options")]);
  if (error) throw new Error("Could not load course versions");
  const versions = (data ?? []) as VersionOption[];
  const openCohorts = cohorts.filter((c) => c.status !== "archived");
  const cohortDefault = isUuid(sp.cohort) && openCohorts.some((c) => c.id === sp.cohort) ? sp.cohort : "";
  const courseDefault = isUuid(sp.course) ? sp.course : "";
  // Prefer the newest published version of the requested course, else its draft.
  const preselect =
    versions.find((v) => v.course_id === courseDefault && v.version_status === "published")?.version_id ??
    versions.find((v) => v.course_id === courseDefault)?.version_id ??
    "";
  const byCourse = new Map<string, VersionOption[]>();
  for (const v of versions) byCourse.set(v.course_id, [...(byCourse.get(v.course_id) ?? []), v]);
  const cohortTz = openCohorts.find((c) => c.id === cohortDefault)?.timezone;

  return (
    <PageBody className="space-y-5">
      <SectionTitle back={{ href: "/admin/offerings", label: t("admin.offering.back") }} title={t("admin.offerings.new")} description={t("admin.offerings.newDescription")} />
      {openCohorts.length === 0 || versions.length === 0 ? (
        <p className="text-sm text-muted">{openCohorts.length === 0 ? t("admin.offerings.noCohorts") : t("admin.offerings.noVersions")}</p>
      ) : (
        <Panel className="p-4 sm:px-6">
          <ActionForm action={createOffering} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("admin.offerings.courseVersion")} htmlFor="new-version" hint={t("admin.offerings.courseVersionHint")} required>
                <Select id="new-version" name="course_version" required defaultValue={preselect} aria-describedby="new-version-hint">
                  <option value="" disabled>{t("admin.offerings.chooseVersion")}</option>
                  {Array.from(byCourse.values()).map((list) => (
                    <optgroup key={list[0].course_id} label={`${list[0].course_code} — ${list[0].course_title}`}>
                      {list.map((v) => (
                        <option key={v.version_id} value={v.version_id}>
                          {t(v.version_status === "published" ? "admin.offerings.versionOptionPublished" : "admin.offerings.versionOptionDraft", { n: v.version_no, title: v.version_title })}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <Field label={t("admin.common.cohort")} htmlFor="new-cohort" required>
                <Select id="new-cohort" name="cohort" required defaultValue={cohortDefault}>
                  <option value="" disabled>{t("admin.common.chooseCohort")}</option>
                  {openCohorts.map((c) => (
                    <option key={c.id} value={c.id}>{`${c.name} (${c.code})`}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("admin.offerings.initialStatus")} htmlFor="new-status" hint={t("admin.offerings.initialStatusHint")} required className="md:col-span-2">
                <Select id="new-status" name="status" required defaultValue="draft" aria-describedby="new-status-hint">
                  <option value="draft">{t("admin.offeringStatus.draft")}</option>
                  <option value="published">{t("admin.offeringStatus.published")}</option>
                </Select>
              </Field>
            </div>
            <OfferingFields idPrefix="new-offering" defaultTimezone={cohortTz} />
            <SubmitButton>{t("admin.offerings.create")}</SubmitButton>
          </ActionForm>
        </Panel>
      )}
    </PageBody>
  );
}
