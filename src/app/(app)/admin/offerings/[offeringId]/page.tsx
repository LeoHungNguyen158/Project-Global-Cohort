import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/access";
import { getAdminOffering, offeringLabel } from "@/lib/admin/data";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatWithCourseTime } from "@/lib/time";
import {
  addEnrollment,
  addStaff,
  adoptOfferingVersion,
  changeOfferingStatus,
  removeStaff,
  setEnrollmentStatus,
  updateOffering,
  updateStaff,
} from "@/app/actions/admin/offerings";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EnrollmentStatusBadge, Facts, OfferingStatusBadge, SectionTitle } from "@/components/admin/badges";
import { OfferingFields } from "@/components/admin/offering-fields";
import { ResultConfirm, ResultForm } from "@/components/admin/result-form";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.offering.title") };

type Person = {
  kind: "staff" | "learner";
  user_id: string;
  display_name: string;
  /** Platform administrators only; null for cohort coordinators. */
  email: string | null;
  role: string;
  status: string | null;
  can_author: boolean;
  can_grade: boolean;
  can_publish_grades: boolean;
  source: string | null;
  account_suspended: boolean;
  created_at: string;
};
type VersionOption = { course_id: string; version_id: string; version_no: number; version_status: string; version_title: string };

const ENROLLMENT_STATUSES = ["active", "suspended", "withdrawn", "completed"] as const;
const SOURCES = ["invitation", "access_request", "admin", "import", "seed"] as const;

function sourceLabel(source: string | null) {
  return SOURCES.includes(source as (typeof SOURCES)[number]) ? t(`admin.enrollmentSource.${source as (typeof SOURCES)[number]}`) : source || "—";
}

function permissionSummary(p: Person) {
  if (p.role === "instructor") return t("admin.staff.allPermissions");
  const list = [p.can_author ? t("admin.staff.canAuthor") : null, p.can_grade ? t("admin.staff.canGrade") : null, p.can_publish_grades ? t("admin.staff.canPublish") : null].filter(Boolean);
  return list.length > 0 ? list.join(", ") : t("admin.staff.viewOnly");
}

export default async function AdminOfferingPage({ params, searchParams }: { params: Promise<{ offeringId: string }>; searchParams: Promise<{ created?: string }> }) {
  const { offeringId } = await params;
  const sp = await searchParams;
  const ctx = await requireAdmin(`/admin/offerings/${offeringId}`);
  const offering = await getAdminOffering(ctx, offeringId);
  if (!offering) notFound();
  const tz = ctx.user.timezone;
  const supabase = await createClient();
  const [{ data: peopleData, error }, { data: versionData }] = await Promise.all([
    supabase.rpc("admin_offering_people", { p_offering: offering.id }),
    supabase.rpc("admin_course_version_options"),
  ]);
  if (error) throw new Error("Could not load the offering's people");
  const people = ((peopleData ?? []) as Person[]).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const staff = people.filter((p) => p.kind === "staff");
  const learners = people.filter((p) => p.kind === "learner");
  const activeLearners = learners.filter((p) => p.status === "active").length;

  const archived = offering.status === "archived";
  const version = offering.course_versions;
  const versionPublished = version?.status === "published";
  const versionReleasable = version?.status === "published" || version?.status === "archived";
  const otherVersions = ((versionData ?? []) as VersionOption[]).filter(
    (v) => v.course_id === offering.course_id && v.version_status === "published" && v.version_id !== offering.course_version_id,
  );
  const fields = { offering: offering.id };
  const title = offeringLabel(offering);

  return (
    <PageBody className="space-y-6">
      <SectionTitle
        back={{ href: "/admin/offerings", label: t("admin.offering.back") }}
        title={title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{offering.cohorts?.name ?? "—"}</span>
            <OfferingStatusBadge status={offering.status} />
            {offering.is_sample ? <Badge>{t("admin.common.sample")}</Badge> : null}
          </span>
        }
        actions={
          <>
            <ButtonLink href={`/courses/${offering.id}`} variant="secondary">{t("admin.offering.openCourse")}</ButtonLink>
            {archived ? null : <ButtonLink href={`/courses/${offering.id}/content/manage`} variant="secondary">{t("admin.offering.editContent")}</ButtonLink>}
            {archived ? null : <ButtonLink href={`/admin/invitations?offering=${offering.id}#new-invitation`} variant="secondary">{t("admin.offering.invite")}</ButtonLink>}
            <ButtonLink href={`/admin/reports?offering=${offering.id}`} variant="secondary">{t("admin.offering.report")}</ButtonLink>
          </>
        }
      />
      {sp.created === "1" ? <Alert tone="success">{offering.status === "draft" ? t("admin.offering.createdDraft") : t("admin.offering.created")}</Alert> : null}

      <Panel aria-labelledby="offering-status">
        <PanelHeader id="offering-status" title={t("admin.offering.statusTitle")} />
        <div className="space-y-4 p-4 sm:px-6">
          <p className="flex flex-wrap items-center gap-2">
            <OfferingStatusBadge status={offering.status} />
            <span className="text-sm">{t(`admin.offering.statusNote.${offering.status}`)}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {offering.status === "draft" ? (
              <ResultConfirm
                action={changeOfferingStatus}
                fields={{ ...fields, change: "publish" }}
                trigger={t("admin.offering.publish")}
                triggerVariant="primary"
                title={t("admin.offering.publishTitle", { code: offering.code })}
                description={t("admin.offering.publishDescription", { count: activeLearners })}
                confirmLabel={t("admin.offering.publish")}
                disabled={!versionPublished}
              />
            ) : null}
            {offering.status === "published" ? (
              <ResultConfirm
                action={changeOfferingStatus}
                fields={{ ...fields, change: "complete" }}
                trigger={t("admin.offering.complete")}
                title={t("admin.offering.completeTitle", { code: offering.code })}
                description={t("admin.offering.completeDescription", { count: activeLearners })}
                confirmLabel={t("admin.offering.complete")}
              />
            ) : null}
            {!archived ? (
              <ResultConfirm
                action={changeOfferingStatus}
                fields={{ ...fields, change: "archive" }}
                trigger={t("admin.offering.archive")}
                tone="danger"
                title={t("admin.offering.archiveTitle", { code: offering.code })}
                description={t("admin.offering.archiveDescription")}
                confirmLabel={t("admin.offering.archive")}
                disabled={!versionReleasable}
              />
            ) : (
              <ResultConfirm
                action={changeOfferingStatus}
                fields={{ ...fields, change: "restore" }}
                trigger={t("admin.offering.restore")}
                title={t("admin.offering.restoreTitle", { code: offering.code })}
                description={t("admin.offering.restoreDescription")}
                confirmLabel={t("admin.offering.restore")}
              />
            )}
          </div>
          {offering.status === "draft" && !versionPublished ? (
            <p className="text-sm text-muted">{t("admin.offering.publishUnavailable", { n: version?.version_no ?? "?" })}</p>
          ) : null}
          {!archived && !versionReleasable ? <p className="text-sm text-muted">{t("admin.offering.archiveUnavailable")}</p> : null}
        </div>
      </Panel>

      <Panel aria-labelledby="offering-details">
        <PanelHeader id="offering-details" title={t("admin.offering.details")} />
        <div className="p-4 sm:px-6">
          <Facts
            items={[
              {
                label: t("admin.common.cohort"),
                value: offering.cohorts ? <Link href={`/admin/cohorts/${offering.cohort_id}`} className="text-primary underline-offset-2 hover:underline">{`${offering.cohorts.name} (${offering.cohorts.code})`}</Link> : "—",
              },
              {
                label: t("admin.common.course"),
                value: ctx.isPlatformAdmin ? (
                  <Link href={`/admin/courses/${offering.course_id}`} className="text-primary underline-offset-2 hover:underline">{`${offering.courses?.code ?? ""} — ${offering.courses?.title ?? ""}`}</Link>
                ) : (
                  `${offering.courses?.code ?? ""} — ${offering.courses?.title ?? ""}`
                ),
              },
            ]}
          />
          <div className="mt-5 border-t border-line pt-5">
            {archived ? (
              <>
                <Alert tone="info" className="mb-4">{t("admin.offering.archivedNote")}</Alert>
                <Facts
                  items={[
                    { label: t("admin.common.code"), value: offering.code },
                    { label: t("admin.offerings.termLabel"), value: offering.term_label || t("admin.common.notSet") },
                    { label: t("admin.offerings.timezone"), value: offering.timezone },
                    { label: t("admin.offerings.startsAt"), value: offering.starts_at ? formatWithCourseTime(offering.starts_at, tz, offering.timezone) : t("admin.common.notSet") },
                    { label: t("admin.offerings.endsAt"), value: offering.ends_at ? formatWithCourseTime(offering.ends_at, tz, offering.timezone) : t("admin.common.notSet") },
                    { label: t("admin.offerings.catalog"), value: offering.catalog_visible ? t("admin.offering.inCatalog") : t("admin.offering.notInCatalog") },
                  ]}
                />
              </>
            ) : (
              <ResultForm action={updateOffering} className="space-y-4" aria-label={t("admin.offering.details")}>
                <input type="hidden" name="offering" value={offering.id} />
                <OfferingFields idPrefix="edit-offering" offering={offering} />
                <SubmitButton>{t("admin.common.save")}</SubmitButton>
              </ResultForm>
            )}
          </div>
        </div>
      </Panel>

      <Panel aria-labelledby="offering-version">
        <PanelHeader id="offering-version" title={t("admin.offering.versionTitle")} />
        <div className="space-y-4 p-4 sm:px-6">
          <p className="flex flex-wrap items-center gap-2">
            <span>{t("admin.offering.currentVersion", { n: version?.version_no ?? "?", title: version?.title ?? "" })}</span>
            <Badge tone={version?.status === "published" ? "success" : version?.status === "draft" ? "warning" : "neutral"}>
              {t(`admin.versionStatus.${(version?.status ?? "draft") as "draft" | "published" | "archived"}`)}
            </Badge>
          </p>
          {archived ? (
            <p className="text-sm text-muted">{t("admin.offering.versionArchived")}</p>
          ) : otherVersions.length === 0 ? (
            <p className="text-sm text-muted">{t("admin.offering.noOtherVersions")}</p>
          ) : (
            <ResultForm action={adoptOfferingVersion} className="flex flex-wrap items-end gap-3" aria-label={t("admin.offering.adoptTitle")}>
              <input type="hidden" name="offering" value={offering.id} />
              <Field label={t("admin.offering.adoptLabel")} htmlFor="adopt-version" hint={offering.status === "published" ? t("admin.offering.adoptHintPublished") : t("admin.offering.adoptHint")} className="min-w-[16rem] flex-1">
                <Select id="adopt-version" name="version" required defaultValue={otherVersions[0].version_id} aria-describedby="adopt-version-hint">
                  {otherVersions.map((v) => (
                    <option key={v.version_id} value={v.version_id}>{t("admin.offerings.versionOptionPublished", { n: v.version_no, title: v.version_title })}</option>
                  ))}
                </Select>
              </Field>
              <SubmitButton variant="secondary">{t("admin.offering.adopt")}</SubmitButton>
            </ResultForm>
          )}
        </div>
      </Panel>

      <Panel aria-labelledby="offering-staff">
        <PanelHeader id="offering-staff" title={t("admin.offering.staffTitle", { count: staff.length })} />
        <div className="space-y-4 p-4 sm:px-6">
          <p className="text-sm text-muted">{t("admin.offering.staffHelp")}</p>
          {staff.length === 0 ? (
            <p className="text-sm text-muted">{t("admin.offering.noStaff")}</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {staff.map((p) => (
                <li key={p.user_id} className="space-y-3 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {ctx.isPlatformAdmin ? (
                      <Link href={`/admin/users/${p.user_id}`} className="font-medium text-primary underline-offset-2 hover:underline">{p.display_name}</Link>
                    ) : (
                      <span className="font-medium">{p.display_name}</span>
                    )}
                    {p.email ? <span className="text-sm text-muted [overflow-wrap:anywhere]">{p.email}</span> : null}
                    <Badge tone="info">{p.role === "instructor" ? t("admin.inviteRole.instructor") : t("admin.inviteRole.ta")}</Badge>
                    {p.account_suspended ? <Badge tone="danger">{t("admin.account.suspended")}</Badge> : null}
                  </div>
                  <p className="text-sm">
                    <span className="text-muted">{t("admin.staff.permissions")}: </span>
                    {permissionSummary(p)}
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <ResultForm action={updateStaff} flash className="flex flex-wrap items-end gap-x-4 gap-y-2" aria-label={t("admin.staff.editFor", { name: p.display_name })}>
                      <input type="hidden" name="offering" value={offering.id} />
                      <input type="hidden" name="user" value={p.user_id} />
                      <div>
                        <label htmlFor={`sr-${p.user_id}`} className="block text-xs text-muted">{t("admin.common.role")}</label>
                        <Select id={`sr-${p.user_id}`} name="role" defaultValue={p.role} className="w-auto min-w-[11rem]">
                          <option value="instructor">{t("admin.inviteRole.instructor")}</option>
                          <option value="ta">{t("admin.inviteRole.ta")}</option>
                        </Select>
                      </div>
                      <fieldset className="flex flex-wrap gap-x-4">
                        <legend className="sr-only">{t("admin.staff.taPermissionsFor", { name: p.display_name })}</legend>
                        <Checkbox name="can_author" label={t("admin.staff.canAuthor")} defaultChecked={p.can_author} />
                        <Checkbox name="can_grade" label={t("admin.staff.canGrade")} defaultChecked={p.can_grade} />
                        <Checkbox name="can_publish_grades" label={t("admin.staff.canPublish")} defaultChecked={p.can_publish_grades} />
                      </fieldset>
                      <SubmitButton size="sm" variant="secondary" aria-label={t("admin.staff.saveFor", { name: p.display_name })}>{t("admin.common.saveShort")}</SubmitButton>
                    </ResultForm>
                    <ResultConfirm
                      action={removeStaff}
                      fields={{ ...fields, user: p.user_id }}
                      trigger={t("admin.staff.remove")}
                      triggerLabel={t("admin.staff.removeFor", { name: p.display_name })}
                      tone="danger"
                      title={t("admin.staff.removeTitle", { name: p.display_name })}
                      description={t("admin.staff.removeDescription")}
                      confirmLabel={t("admin.staff.remove")}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ResultForm action={addStaff} resetOnSuccess className="space-y-3 rounded-md border border-line p-4" aria-label={t("admin.staff.addTitle")}>
            <h3 className="font-semibold">{t("admin.staff.addTitle")}</h3>
            <input type="hidden" name="offering" value={offering.id} />
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t("admin.people.addByEmail")} htmlFor="add-staff-email" hint={t("admin.staff.addHint")} className="min-w-[16rem] flex-[2_1_16rem]">
                <Input id="add-staff-email" name="email" type="email" required maxLength={320} autoComplete="off" aria-describedby="add-staff-email-hint" />
              </Field>
              <Field label={t("admin.common.role")} htmlFor="add-staff-role" className="min-w-[11rem] flex-[1_1_11rem]">
                <Select id="add-staff-role" name="role" defaultValue="ta">
                  <option value="instructor">{t("admin.inviteRole.instructor")}</option>
                  <option value="ta">{t("admin.inviteRole.ta")}</option>
                </Select>
              </Field>
            </div>
            <fieldset className="flex flex-wrap gap-x-4">
              <legend className="text-sm font-medium">{t("admin.staff.taPermissions")}</legend>
              <Checkbox name="can_author" label={t("admin.staff.canAuthor")} />
              <Checkbox name="can_grade" label={t("admin.staff.canGrade")} defaultChecked />
              <Checkbox name="can_publish_grades" label={t("admin.staff.canPublish")} />
            </fieldset>
            <SubmitButton variant="secondary">{t("admin.staff.add")}</SubmitButton>
          </ResultForm>
        </div>
      </Panel>

      <Panel aria-labelledby="offering-learners">
        <PanelHeader id="offering-learners" title={t("admin.offering.learnersTitle", { count: learners.length })} />
        <div className="space-y-4 p-4 sm:px-6">
          <p className="text-sm text-muted">{t("admin.offering.learnersHelp")}</p>
          {!archived ? (
            <ResultForm action={addEnrollment} resetOnSuccess className="flex flex-wrap items-end gap-3" aria-label={t("admin.enroll.addTitle")}>
              <input type="hidden" name="offering" value={offering.id} />
              <Field label={t("admin.people.addByEmail")} htmlFor="add-learner-email" hint={t("admin.enroll.addHint")} className="min-w-[16rem] flex-1">
                <Input id="add-learner-email" name="email" type="email" required maxLength={320} autoComplete="off" aria-describedby="add-learner-email-hint" />
              </Field>
              <SubmitButton variant="secondary">{t("admin.enroll.add")}</SubmitButton>
            </ResultForm>
          ) : null}
          {learners.length === 0 ? (
            <p className="text-sm text-muted">{t("admin.offering.noLearners")}</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {learners.map((p) => (
                <li key={p.user_id} className="flex flex-wrap items-end justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {ctx.isPlatformAdmin ? (
                        <Link href={`/admin/users/${p.user_id}`} className="font-medium text-primary underline-offset-2 hover:underline">{p.display_name}</Link>
                      ) : (
                        <span className="font-medium">{p.display_name}</span>
                      )}
                      <EnrollmentStatusBadge status={p.status ?? "active"} />
                      {p.account_suspended ? <Badge tone="danger">{t("admin.account.suspended")}</Badge> : null}
                    </div>
                    {p.email ? <p className="text-sm text-muted [overflow-wrap:anywhere]">{p.email}</p> : null}
                    <p className="text-xs text-muted">{t("admin.enroll.meta", { source: sourceLabel(p.source), date: formatDate(p.created_at, tz) })}</p>
                  </div>
                  <ResultForm action={setEnrollmentStatus} flash className="flex items-end gap-2" aria-label={t("admin.enroll.statusFor", { name: p.display_name })}>
                    <input type="hidden" name="offering" value={offering.id} />
                    <input type="hidden" name="user" value={p.user_id} />
                    <div>
                      <label htmlFor={`es-${p.user_id}`} className="block text-xs text-muted">{t("admin.common.status")}</label>
                      <Select id={`es-${p.user_id}`} name="status" defaultValue={p.status ?? "active"} className="w-auto min-w-[9rem]">
                        {ENROLLMENT_STATUSES.map((s) => (
                          <option key={s} value={s}>{t(`admin.enrollmentStatus.${s}`)}</option>
                        ))}
                      </Select>
                    </div>
                    <SubmitButton size="sm" variant="secondary" aria-label={t("admin.enroll.saveFor", { name: p.display_name })}>{t("admin.common.saveShort")}</SubmitButton>
                  </ResultForm>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
      <p className="text-xs text-muted">{t("admin.offering.timesNote", { tz, offeringTz: offering.timezone })}</p>
    </PageBody>
  );
}
