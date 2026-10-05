import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/admin/access";
import { listAdminCohorts } from "@/lib/admin/data";
import { isUuid } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/time";
import { addCoordinatorScope, removeCoordinatorScope, setAccountSuspension, setPlatformRole } from "@/app/actions/admin/users";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, td, th } from "@/components/admin/scroll-table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ActionForm } from "@/components/ui/action-form";
import { Field, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ResultConfirm } from "@/components/admin/result-form";
import {
  AccountBadges,
  EnrollmentStatusBadge,
  Facts,
  InvitationBadge,
  InviteRoleLabel,
  OfferingStatusBadge,
  RoleBadges,
  SectionTitle,
  invitationState,
} from "@/components/admin/badges";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.user.title") };

type Detail = {
  id: string;
  display_name: string;
  email: string;
  email_confirmed_at: string | null;
  invited_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  timezone: string;
  locale: string;
  suspended_at: string | null;
  is_sample: boolean;
  last_status_change: { action: string; reason: string | null; at: string; by: string | null } | null;
};

type OfferingRef = {
  id: string;
  code: string;
  status: string;
  term_label: string;
  cohorts: { name: string } | null;
  course_versions: { title: string } | null;
};

const OFFERING_REF = "id, code, status, term_label, cohorts(name), course_versions(title)";

export default async function AdminUserPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const ctx = await requirePlatformAdmin(`/admin/users/${userId}`);
  if (!isUuid(userId)) notFound();
  const tz = ctx.user.timezone;
  const supabase = await createClient();

  const { data: detailData, error: detailError } = await supabase.rpc("admin_user_detail", { p_user: userId });
  if (detailError) throw new Error("Could not load the account");
  const user = detailData as Detail | null;
  if (!user) notFound();

  const [grantsRes, scopesRes, participationRes, enrollmentsRes, staffRes, invitationsRes, cohorts] = await Promise.all([
    supabase.from("platform_role_grants").select("role, granted_at, revoked_at").eq("user_id", userId).order("granted_at", { ascending: false }),
    supabase.from("coordinator_scopes").select("cohort_id, granted_at, cohorts(code, name, status)").eq("user_id", userId),
    supabase.from("cohort_participation").select("cohort_id, status, created_at, cohorts(code, name)").eq("user_id", userId),
    supabase.from("enrollments").select(`id, status, source, created_at, course_offerings(${OFFERING_REF})`).eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("staff_assignments").select(`role, can_author, can_grade, can_publish_grades, created_at, course_offerings(${OFFERING_REF})`).eq("user_id", userId),
    supabase.from("invitations").select("id, role, expires_at, accepted_at, revoked_at, email_status, created_at, cohorts(name), course_offerings(code)").eq("email", user.email).order("created_at", { ascending: false }).limit(20),
    listAdminCohorts(ctx),
  ]);
  for (const r of [grantsRes, scopesRes, participationRes, enrollmentsRes, staffRes, invitationsRes]) if (r.error) throw new Error("Could not load the account");

  const grants = grantsRes.data ?? [];
  const activeRoles = grants.filter((g) => !g.revoked_at).map((g) => g.role as string);
  const scopes = (scopesRes.data ?? []) as unknown as { cohort_id: string; granted_at: string; cohorts: { code: string; name: string; status: string } | null }[];
  const participation = (participationRes.data ?? []) as unknown as { cohort_id: string; status: string; created_at: string; cohorts: { code: string; name: string } | null }[];
  const enrollments = (enrollmentsRes.data ?? []) as unknown as { id: string; status: string; source: string; created_at: string; course_offerings: OfferingRef | null }[];
  const staff = (staffRes.data ?? []) as unknown as {
    role: string;
    can_author: boolean;
    can_grade: boolean;
    can_publish_grades: boolean;
    created_at: string;
    course_offerings: OfferingRef | null;
  }[];
  const invitations = (invitationsRes.data ?? []) as unknown as {
    id: string;
    role: string;
    expires_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
    email_status: string;
    created_at: string;
    cohorts: { name: string } | null;
    course_offerings: { code: string } | null;
  }[];

  const isSelf = user.id === ctx.user.id;
  const suspended = Boolean(user.suspended_at);
  const scopedIds = new Set(scopes.map((s) => s.cohort_id));
  const addableCohorts = cohorts.filter((c) => !scopedIds.has(c.id) && c.status !== "archived");
  const offeringName = (o: OfferingRef | null) => (o ? `${o.code}${o.course_versions?.title ? ` — ${o.course_versions.title}` : ""}` : "—");

  return (
    <PageBody className="space-y-6">
      <SectionTitle
        back={{ href: "/admin/users", label: t("admin.user.back") }}
        title={user.display_name || user.email}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="[overflow-wrap:anywhere]">{user.email}</span>
            <AccountBadges suspended={suspended} confirmed={Boolean(user.email_confirmed_at)} />
            <RoleBadges roles={activeRoles} />
            {user.is_sample ? <Badge>{t("admin.common.sample")}</Badge> : null}
          </span>
        }
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel aria-labelledby="user-profile">
          <PanelHeader id="user-profile" title={t("admin.user.profile")} />
          <div className="p-4 sm:px-6">
            <Facts
              items={[
                { label: t("admin.user.emailConfirmed"), value: user.email_confirmed_at ? formatDateTime(user.email_confirmed_at, tz) : t("admin.user.notConfirmed") },
                { label: t("admin.user.invitedAt"), value: user.invited_at ? formatDateTime(user.invited_at, tz) : t("admin.common.notSet") },
                { label: t("admin.common.created"), value: formatDateTime(user.created_at, tz) },
                { label: t("admin.users.lastSignIn"), value: user.last_sign_in_at ? formatDateTime(user.last_sign_in_at, tz) : t("admin.common.never") },
                { label: t("admin.user.timezone"), value: user.timezone },
                { label: t("admin.user.locale"), value: user.locale === "vi" ? t("admin.user.locale.vi") : t("admin.user.locale.en") },
              ]}
            />
            <p className="mt-4 text-xs text-muted">{t("admin.user.profileNote")}</p>
          </div>
        </Panel>

        <Panel aria-labelledby="user-status">
          <PanelHeader id="user-status" title={t("admin.user.accountStatus")} />
          <div className="space-y-4 p-4 sm:px-6">
            <p>
              {suspended
                ? t("admin.user.isSuspended", { at: formatDateTime(user.suspended_at, tz) })
                : t("admin.user.isActive")}
            </p>
            {user.last_status_change ? (
              <p className="text-sm text-muted">
                {t(user.last_status_change.action === "account.suspend" ? "admin.user.lastSuspend" : "admin.user.lastReinstate", {
                  at: formatDateTime(user.last_status_change.at, tz),
                  by: user.last_status_change.by ?? t("admin.user.unknownActor"),
                  reason: user.last_status_change.reason ?? "—",
                })}
              </p>
            ) : null}
            {isSelf ? (
              <Alert tone="info">{t("admin.user.selfStatus")}</Alert>
            ) : (
              <ResultConfirm
                action={setAccountSuspension}
                fields={{ user: user.id, suspend: suspended ? "0" : "1" }}
                trigger={suspended ? t("admin.user.reactivate") : t("admin.user.suspend")}
                triggerVariant={suspended ? "primary" : "danger"}
                size="md"
                tone={suspended ? "primary" : "danger"}
                title={suspended ? t("admin.user.reactivateTitle", { name: user.display_name }) : t("admin.user.suspendTitle", { name: user.display_name })}
                description={suspended ? t("admin.user.reactivateDescription") : t("admin.user.suspendDescription")}
                confirmLabel={suspended ? t("admin.user.reactivate") : t("admin.user.suspend")}
              >
                <Field label={t("admin.common.reason")} htmlFor="suspension-reason" hint={t("admin.common.reasonHint")} required>
                  <Textarea id="suspension-reason" name="reason" required minLength={3} maxLength={500} rows={3} aria-describedby="suspension-reason-hint" />
                </Field>
              </ResultConfirm>
            )}
          </div>
        </Panel>
      </div>

      <Panel aria-labelledby="user-roles">
        <PanelHeader id="user-roles" title={t("admin.user.platformRoles")} />
        <ul className="divide-y divide-line">
          {(["platform_admin", "coordinator"] as const).map((role) => {
            const active = grants.find((g) => g.role === role && !g.revoked_at);
            const label = t(`admin.roles.${role}`);
            return (
              <li key={role} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
                <div className="min-w-0">
                  <p className="font-medium">{label}</p>
                  <p className="text-sm text-muted">
                    {active ? t("admin.user.roleSince", { date: formatDate(active.granted_at, tz) }) : t("admin.user.roleNotGranted")}
                    {" "}
                    {t(`admin.user.roleHelp.${role}`)}
                  </p>
                </div>
                {active ? (
                  role === "platform_admin" && isSelf ? (
                    <span className="text-sm text-muted">{t("admin.user.selfRole")}</span>
                  ) : (
                    <ResultConfirm
                      action={setPlatformRole}
                      fields={{ user: user.id, role, grant: "0" }}
                      trigger={t("admin.user.removeRole")}
                      triggerLabel={t("admin.user.removeRoleFor", { role: label })}
                      size="sm"
                      tone="danger"
                      title={t("admin.user.removeRoleTitle", { role: label, name: user.display_name })}
                      description={t(`admin.user.removeRoleDescription.${role}`)}
                      confirmLabel={t("admin.user.removeRole")}
                    />
                  )
                ) : suspended ? (
                  <span className="text-sm text-muted">{t("admin.user.grantSuspended")}</span>
                ) : (
                  <ResultConfirm
                    action={setPlatformRole}
                    fields={{ user: user.id, role, grant: "1" }}
                    trigger={t("admin.user.grantRole")}
                    triggerLabel={t("admin.user.grantRoleFor", { role: label })}
                    size="sm"
                    title={t("admin.user.grantRoleTitle", { role: label, name: user.display_name })}
                    description={t(`admin.user.grantRoleDescription.${role}`)}
                    confirmLabel={t("admin.user.grantRole")}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel aria-labelledby="user-scopes">
        <PanelHeader id="user-scopes" title={t("admin.user.scopes")} />
        <div className="space-y-4 p-4 sm:px-6">
          {!activeRoles.includes("coordinator") && scopes.length > 0 ? <Alert tone="warning">{t("admin.user.scopesInactive")}</Alert> : null}
          {scopes.length === 0 ? (
            <p className="text-sm text-muted">{t("admin.user.noScopes")}</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {scopes.map((s) => (
                <li key={s.cohort_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
                  <span className="min-w-0">
                    <Link href={`/admin/cohorts/${s.cohort_id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                      {s.cohorts?.name ?? s.cohort_id}
                    </Link>{" "}
                    <span className="text-sm text-muted">{s.cohorts?.code}</span>
                  </span>
                  <ResultConfirm
                    action={removeCoordinatorScope}
                    fields={{ user: user.id, cohort: s.cohort_id }}
                    trigger={t("admin.user.removeScope")}
                    size="sm"
                    tone="danger"
                    title={t("admin.user.removeScopeTitle", { cohort: s.cohorts?.name ?? "" })}
                    description={t("admin.user.removeScopeDescription")}
                    confirmLabel={t("admin.user.removeScope")}
                  />
                </li>
              ))}
            </ul>
          )}
          {addableCohorts.length > 0 ? (
            <ActionForm action={addCoordinatorScope} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="user" value={user.id} />
              <Field label={t("admin.user.addScope")} htmlFor="scope-cohort" className="min-w-[14rem] flex-1">
                <Select id="scope-cohort" name="cohort" required defaultValue="">
                  <option value="" disabled>{t("admin.common.chooseCohort")}</option>
                  {addableCohorts.map((c) => (
                    <option key={c.id} value={c.id}>{`${c.name} (${c.code})`}</option>
                  ))}
                </Select>
              </Field>
              <SubmitButton variant="secondary">{t("admin.user.addScopeButton")}</SubmitButton>
              {!activeRoles.includes("coordinator") ? <p className="basis-full text-sm text-muted">{t("admin.user.scopesNeedRole")}</p> : null}
            </ActionForm>
          ) : null}
        </div>
      </Panel>

      <section aria-labelledby="user-enrollments" className="space-y-3">
        <h3 id="user-enrollments" className="text-lg font-semibold">{t("admin.user.enrollments")}</h3>
        {enrollments.length === 0 ? (
          <p className="text-sm text-muted">{t("admin.user.noEnrollments")}</p>
        ) : (
          <Table caption={t("admin.user.enrollments")} captionHidden>
            <thead>
              <tr>
                <th scope="col" className={th}>{t("admin.common.offering")}</th>
                <th scope="col" className={th}>{t("admin.common.cohort")}</th>
                <th scope="col" className={th}>{t("admin.user.enrollmentStatus")}</th>
                <th scope="col" className={th}>{t("admin.user.source")}</th>
                <th scope="col" className={th}>{t("admin.user.since")}</th>
              </tr>
            </thead>
            <tbody>
              {enrollments.map((e) => (
                <tr key={e.id}>
                  <td className={td}>
                    {e.course_offerings ? (
                      <Link href={`/admin/offerings/${e.course_offerings.id}#enrollments`} className="text-primary underline-offset-2 hover:underline">
                        {offeringName(e.course_offerings)}
                      </Link>
                    ) : "—"}{" "}
                    {e.course_offerings ? <OfferingStatusBadge status={e.course_offerings.status} /> : null}
                  </td>
                  <td className={td}>{e.course_offerings?.cohorts?.name ?? "—"}</td>
                  <td className={td}><EnrollmentStatusBadge status={e.status} /></td>
                  <td className={td}>{t(`admin.enrollmentSource.${e.source as "admin" | "invitation" | "access_request" | "import" | "seed"}`)}</td>
                  <td className={`${td} whitespace-nowrap`}>{formatDate(e.created_at, tz)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="user-staff" className="space-y-3">
        <h3 id="user-staff" className="text-lg font-semibold">{t("admin.user.staff")}</h3>
        {staff.length === 0 ? (
          <p className="text-sm text-muted">{t("admin.user.noStaff")}</p>
        ) : (
          <Table caption={t("admin.user.staff")} captionHidden>
            <thead>
              <tr>
                <th scope="col" className={th}>{t("admin.common.offering")}</th>
                <th scope="col" className={th}>{t("admin.common.role")}</th>
                <th scope="col" className={th}>{t("admin.staff.permissions")}</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s, i) => (
                <tr key={s.course_offerings?.id ?? i}>
                  <td className={td}>
                    {s.course_offerings ? (
                      <Link href={`/admin/offerings/${s.course_offerings.id}#staff`} className="text-primary underline-offset-2 hover:underline">
                        {offeringName(s.course_offerings)}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className={td}><InviteRoleLabel role={s.role} /></td>
                  <td className={td}>
                    {s.role === "instructor"
                      ? t("admin.staff.allPermissions")
                      : [s.can_author && t("admin.staff.canAuthor"), s.can_grade && t("admin.staff.canGrade"), s.can_publish_grades && t("admin.staff.canPublish")]
                          .filter(Boolean)
                          .join(", ") || t("admin.staff.viewOnly")}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="user-cohorts" className="space-y-3">
        <h3 id="user-cohorts" className="text-lg font-semibold">{t("admin.user.participation")}</h3>
        {participation.length === 0 ? (
          <p className="text-sm text-muted">{t("admin.user.noParticipation")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {participation.map((p) => (
              <li key={p.cohort_id} className="inline-flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm">
                <Link href={`/admin/cohorts/${p.cohort_id}`} className="text-primary underline-offset-2 hover:underline">{p.cohorts?.name ?? p.cohort_id}</Link>
                <EnrollmentStatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="user-invitations" className="space-y-3">
        <h3 id="user-invitations" className="text-lg font-semibold">{t("admin.user.invitations")}</h3>
        {invitations.length === 0 ? (
          <p className="text-sm text-muted">{t("admin.user.noInvitations")}</p>
        ) : (
          <ul className="space-y-2">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                <InvitationBadge state={invitationState(i)} />
                <span>
                  <InviteRoleLabel role={i.role} /> · {i.course_offerings?.code ?? i.cohorts?.name ?? "—"} · {t("admin.user.invitedOn", { date: formatDate(i.created_at, tz) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-muted">{t("admin.common.timesShownIn", { tz })}</p>
    </PageBody>
  );
}

