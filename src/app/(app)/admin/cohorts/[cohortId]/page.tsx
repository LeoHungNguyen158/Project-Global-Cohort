import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/access";
import { getAdminCohort, listAdminOfferings, offeringLabel } from "@/lib/admin/data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { addCohortCoordinator, addCohortParticipant, setCohortArchived, setParticipantStatus, updateCohort } from "@/app/actions/admin/cohorts";
import { removeCoordinatorScope } from "@/app/actions/admin/users";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, td, th } from "@/components/admin/scroll-table";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ActionForm } from "@/components/ui/action-form";
import { ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { CohortStatusBadge, EnrollmentStatusBadge, Facts, OfferingStatusBadge, SectionTitle } from "@/components/admin/badges";
import { CohortFields } from "@/components/admin/cohort-fields";
import { ResultConfirm, ResultForm } from "@/components/admin/result-form";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.cohort.title") };

// Email addresses come back for platform administrators only (null for coordinators).
type Person = { kind: "participant" | "coordinator"; user_id: string; display_name: string; email: string | null; status: string; created_at: string };

export default async function AdminCohortPage({ params, searchParams }: { params: Promise<{ cohortId: string }>; searchParams: Promise<{ created?: string }> }) {
  const { cohortId } = await params;
  const sp = await searchParams;
  const ctx = await requireAdmin(`/admin/cohorts/${cohortId}`);
  const cohort = await getAdminCohort(ctx, cohortId);
  if (!cohort) notFound();
  const tz = ctx.user.timezone;
  const supabase = await createClient();
  const [{ data: peopleData, error }, offerings] = await Promise.all([
    supabase.rpc("admin_cohort_people", { p_cohort: cohort.id }),
    listAdminOfferings(ctx),
  ]);
  if (error) throw new Error("Could not load the cohort");
  const people = ((peopleData ?? []) as Person[]).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const participants = people.filter((p) => p.kind === "participant");
  const coordinators = people.filter((p) => p.kind === "coordinator");
  const cohortOfferings = offerings.filter((o) => o.cohort_id === cohort.id);
  const archived = cohort.status === "archived";

  return (
    <PageBody className="space-y-6">
      <SectionTitle
        back={{ href: "/admin/cohorts", label: t("admin.cohort.back") }}
        title={cohort.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{cohort.code}</span>
            <CohortStatusBadge status={cohort.status} />
            {cohort.is_sample ? <Badge>{t("admin.common.sample")}</Badge> : null}
          </span>
        }
        actions={
          archived ? null : (
            <>
              <ButtonLink href={`/admin/invitations?cohort=${cohort.id}#new-invitation`} variant="secondary">{t("admin.cohort.invite")}</ButtonLink>
              <ButtonLink href={`/admin/offerings/new?cohort=${cohort.id}`} variant="secondary">{t("admin.cohort.newOffering")}</ButtonLink>
            </>
          )
        }
      />
      {sp.created === "1" ? <Alert tone="success">{t("admin.cohorts.created")}</Alert> : null}

      <Panel aria-labelledby="cohort-details">
        <PanelHeader
          id="cohort-details"
          title={t("admin.cohort.details")}
          actions={
            <ResultConfirm
              action={setCohortArchived}
              fields={{ cohort: cohort.id, archive: archived ? "0" : "1" }}
              trigger={archived ? t("admin.cohort.restore") : t("admin.cohort.archive")}
              tone={archived ? "primary" : "danger"}
              title={archived ? t("admin.cohort.restoreTitle", { name: cohort.name }) : t("admin.cohort.archiveTitle", { name: cohort.name })}
              description={archived ? t("admin.cohort.restoreDescription") : t("admin.cohort.archiveDescription")}
              confirmLabel={archived ? t("admin.cohort.restore") : t("admin.cohort.archive")}
            />
          }
        />
        <div className="p-4 sm:px-6">
          {archived ? (
            <>
              <Alert tone="info" className="mb-4">{t("admin.cohort.archivedNote")}</Alert>
              <Facts
                items={[
                  { label: t("admin.cohorts.timezone"), value: cohort.timezone },
                  { label: t("admin.cohorts.dates"), value: `${cohort.starts_on ?? "…"} – ${cohort.ends_on ?? "…"}` },
                  { label: t("admin.cohorts.descriptionLabel"), value: cohort.description || t("admin.common.notSet") },
                ]}
              />
            </>
          ) : (
            <ActionForm action={updateCohort} className="space-y-4">
              <input type="hidden" name="cohort" value={cohort.id} />
              <CohortFields idPrefix="edit-cohort" cohort={cohort} />
              <SubmitButton>{t("admin.common.save")}</SubmitButton>
            </ActionForm>
          )}
        </div>
      </Panel>

      <Panel aria-labelledby="cohort-offerings">
        <PanelHeader id="cohort-offerings" title={t("admin.cohort.offerings")} />
        {cohortOfferings.length === 0 ? (
          <p className="p-4 text-sm text-muted sm:px-6">{t("admin.cohort.noOfferings")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {cohortOfferings.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
                <Link href={`/admin/offerings/${o.id}`} className="min-w-0 text-primary underline-offset-2 hover:underline [overflow-wrap:anywhere]">{offeringLabel(o)}</Link>
                <span className="flex items-center gap-2 text-sm text-muted">{o.term_label} <OfferingStatusBadge status={o.status} /></span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel aria-labelledby="cohort-participants">
        <PanelHeader id="cohort-participants" title={t("admin.cohort.participants", { count: participants.length })} />
        <div className="space-y-4 p-4 sm:px-6">
          <p className="text-sm text-muted">{t("admin.cohort.participantsHelp")}</p>
          {!archived ? (
            <ActionForm action={addCohortParticipant} resetOnSuccess className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="cohort" value={cohort.id} />
              <Field label={t("admin.people.addByEmail")} htmlFor="add-participant" hint={t("admin.people.addHint")} className="min-w-[16rem] flex-1">
                <Input id="add-participant" name="email" type="email" required maxLength={320} autoComplete="off" aria-describedby="add-participant-hint" />
              </Field>
              <SubmitButton variant="secondary">{t("admin.people.addParticipant")}</SubmitButton>
            </ActionForm>
          ) : null}
          {participants.length === 0 ? (
            <p className="text-sm text-muted">{t("admin.cohort.noParticipants")}</p>
          ) : (
            <Table caption={t("admin.cohort.participantsCaption")} captionHidden>
              <thead>
                <tr>
                  <th scope="col" className={th}>{t("admin.common.name")}</th>
                  {ctx.isPlatformAdmin ? <th scope="col" className={th}>{t("admin.common.email")}</th> : null}
                  <th scope="col" className={th}>{t("admin.common.status")}</th>
                  <th scope="col" className={th}>{t("admin.user.since")}</th>
                  <th scope="col" className={th}>{t("admin.people.changeStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p) => (
                  <tr key={p.user_id}>
                    <td className={td}>
                      {ctx.isPlatformAdmin ? (
                        <Link href={`/admin/users/${p.user_id}`} className="text-primary underline-offset-2 hover:underline">{p.display_name}</Link>
                      ) : (
                        p.display_name
                      )}
                    </td>
                    {ctx.isPlatformAdmin ? <td className={`${td} whitespace-nowrap`}>{p.email ?? ""}</td> : null}
                    <td className={td}><EnrollmentStatusBadge status={p.status} /></td>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(p.created_at, tz)}</td>
                    <td className={td}>
                      <ResultForm action={setParticipantStatus} flash className="flex items-end gap-2" aria-label={t("admin.people.statusFor", { name: p.display_name })}>
                        <input type="hidden" name="cohort" value={cohort.id} />
                        <input type="hidden" name="user" value={p.user_id} />
                        {/* aria-label, not a visually hidden label: an absolutely positioned label would escape the table's scroll area. */}
                        <Select id={`ps-${p.user_id}`} name="status" defaultValue={p.status} className="w-auto min-w-[8.5rem]" aria-label={t("admin.people.statusFor", { name: p.display_name })}>
                          <option value="active">{t("admin.enrollmentStatus.active")}</option>
                          <option value="suspended">{t("admin.enrollmentStatus.suspended")}</option>
                          <option value="withdrawn">{t("admin.enrollmentStatus.withdrawn")}</option>
                        </Select>
                        <SubmitButton size="sm" variant="secondary" aria-label={t("admin.people.saveStatusFor", { name: p.display_name })}>{t("admin.common.saveShort")}</SubmitButton>
                      </ResultForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Panel>

      <Panel aria-labelledby="cohort-coordinators">
        <PanelHeader id="cohort-coordinators" title={t("admin.cohort.coordinators")} />
        <div className="space-y-4 p-4 sm:px-6">
          {coordinators.length === 0 ? (
            <p className="text-sm text-muted">{t("admin.cohort.noCoordinators")}</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {coordinators.map((c) => (
                <li key={c.user_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0">
                    <span className="font-medium">{c.display_name}</span> {c.email ? <span className="text-sm text-muted [overflow-wrap:anywhere]">{c.email}</span> : null}{" "}
                    {c.status === "active" ? <Badge tone="success">{t("admin.cohort.coordinatorActive")}</Badge> : <Badge tone="warning">{t("admin.cohort.coordinatorInactive")}</Badge>}
                  </span>
                  {ctx.isPlatformAdmin ? (
                    <ResultConfirm
                      action={removeCoordinatorScope}
                      fields={{ user: c.user_id, cohort: cohort.id }}
                      trigger={t("admin.user.removeScope")}
                      triggerLabel={t("admin.cohort.removeCoordinatorFor", { name: c.display_name })}
                      tone="danger"
                      title={t("admin.cohort.removeCoordinatorTitle", { name: c.display_name })}
                      description={t("admin.user.removeScopeDescription")}
                      confirmLabel={t("admin.user.removeScope")}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {ctx.isPlatformAdmin && !archived ? (
            <ActionForm action={addCohortCoordinator} resetOnSuccess className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="cohort" value={cohort.id} />
              <Field label={t("admin.cohort.addCoordinator")} htmlFor="add-coordinator" hint={t("admin.cohort.addCoordinatorHint")} className="min-w-[16rem] flex-1">
                <Input id="add-coordinator" name="email" type="email" required maxLength={320} autoComplete="off" aria-describedby="add-coordinator-hint" />
              </Field>
              <SubmitButton variant="secondary">{t("admin.cohort.addCoordinatorButton")}</SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      </Panel>
      <p className="text-xs text-muted">{t("admin.common.timesShownIn", { tz })}</p>
    </PageBody>
  );
}
