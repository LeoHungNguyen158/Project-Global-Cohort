import type { Metadata } from "next";
import Link from "next/link";
import { isAdminish, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listMyOfferings, offeringTitle } from "@/lib/data/offerings";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { ActionForm } from "@/components/ui/action-form";
import { ConfirmForm } from "@/components/ui/confirm-form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { tx } from "@/components/public/rich-t";
import { TimeZonePicker } from "@/components/profile/timezone-picker";
import { AvatarUploader } from "@/components/profile/avatar-uploader";
import { buildTimeZoneOptions } from "@/components/profile/timezones";
import { BIO_MAX, DISPLAY_NAME_MAX, NOTIFICATION_KINDS, PROFILE_LOCALES } from "@/components/profile/validation";
import { changePassword, removeAvatar, saveNotificationPreferences, updateProfile } from "@/app/actions/profile";
import { t, type MessageKey } from "@/i18n";

export const metadata: Metadata = { title: t("profile.title") };

type Profile = { display_name: string; bio: string; locale: string; timezone: string; avatar_asset_id: string | null };

const ENROLLMENT_LABEL: Record<string, MessageKey> = {
  active: "profile.enrollment.active",
  completed: "profile.enrollment.completed",
  suspended: "profile.enrollment.suspended",
  withdrawn: "profile.enrollment.withdrawn",
};

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ photo?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("/profile");
  const supabase = await createClient();
  const [profileRes, prefsRes, invitesRes, offerings, cohortsRes] = await Promise.all([
    supabase.from("profiles").select("display_name, bio, locale, timezone, avatar_asset_id").eq("id", user.id).single(),
    supabase.from("notification_preferences").select("kind, in_app").eq("user_id", user.id),
    supabase.rpc("list_my_invitations"),
    listMyOfferings(),
    user.coordinatorCohorts.length > 0 ? supabase.from("cohorts").select("id, name").in("id", user.coordinatorCohorts) : Promise.resolve({ data: [] }),
  ]);
  const profile = (profileRes.data ?? { display_name: user.displayName, bio: "", locale: user.locale, timezone: user.timezone, avatar_asset_id: null }) as Profile;
  const inApp = new Map(((prefsRes.data ?? []) as { kind: string; in_app: boolean }[]).map((p) => [p.kind, p.in_app]));
  const pendingInvites = ((invitesRes.data ?? []) as { state: string }[]).filter((i) => i.state === "pending").length;
  const offeringById = new Map(offerings.map((o) => [o.id, o]));
  const courseName = (id: string) => {
    const o = offeringById.get(id);
    return o ? `${o.code} — ${offeringTitle(o)}` : id.slice(0, 8);
  };
  const tzOptions = buildTimeZoneOptions(new Date(), profile.timezone);
  const roles: string[] = [
    ...(user.isPlatformAdmin ? [t("profile.role.platformAdmin")] : []),
    ...(user.coordinatorCohorts.length > 0
      ? [`${t("profile.role.coordinator", { count: user.coordinatorCohorts.length })}: ${((cohortsRes.data ?? []) as { name: string }[]).map((c) => c.name).join(", ")}`]
      : []),
    ...user.staff.map((s) => t(s.role === "ta" ? "profile.role.ta" : "profile.role.instructor", { course: courseName(s.offering_id) })),
    ...user.enrollments.map(
      (e) => `${t("profile.role.learner", { course: courseName(e.offering_id) })} (${ENROLLMENT_LABEL[e.status] ? t(ENROLLMENT_LABEL[e.status]) : e.status})`,
    ),
  ];
  const sections = [
    { id: "account", label: t("profile.account") },
    { id: "details", label: t("profile.details") },
    { id: "photo", label: t("profile.photo") },
    { id: "notifications", label: t("profile.notifications") },
    { id: "password", label: t("profile.password") },
  ];

  return (
    <>
      <PageHeader title={t("profile.title")} description={t("profile.description")} />
      <PageBody className="max-w-4xl space-y-6">
        <nav aria-label={t("profile.onThisPage")} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="inline-flex min-h-10 items-center text-primary underline-offset-2 hover:underline">
              {s.label}
            </a>
          ))}
        </nav>

        <Panel id="account" aria-labelledby="account-title" className="scroll-mt-20">
          <PanelHeader id="account-title" title={t("profile.account")} />
          <div className="space-y-4 px-4 py-4 sm:px-6">
            <div className="flex items-center gap-4">
              <Avatar name={profile.display_name || user.displayName} src={profile.avatar_asset_id ? `/api/assets/${profile.avatar_asset_id}` : null} size={56} />
              <p className="min-w-0 break-words text-lg font-semibold">{profile.display_name || user.displayName}</p>
            </div>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_minmax(0,1fr)]">
              <dt className="font-medium">{t("profile.email")}</dt>
              <dd>
                <p className="break-all" data-testid="account-email">{user.email}</p>
                <p className="text-sm text-muted">{t("profile.emailPrivate")}</p>
                <p className="text-sm text-muted">{t("profile.emailChange")}</p>
              </dd>
              <dt className="font-medium">{t("profile.accountType")}</dt>
              <dd>
                {user.enrollments.length > 0 ? (
                  <p data-testid="account-type">{t("profile.participantAccount")}</p>
                ) : user.staff.length > 0 || isAdminish(user) ? (
                  <p data-testid="account-type">{t("profile.staffAccount")}</p>
                ) : (
                  <>
                    <p data-testid="account-type">{t("profile.roa")}</p>
                    <p className="text-sm text-muted">
                      {tx("profile.roaHelp", { catalog: <Link className="text-primary underline" href="/catalog">{t("profile.roaCatalogLink")}</Link> })}
                    </p>
                  </>
                )}
                {roles.length > 0 ? (
                  <>
                    <p className="mt-2 text-sm font-medium">{t("profile.rolesTitle")}</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-sm">
                      {roles.map((r) => (
                        <li key={r} className="break-words">{r}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </dd>
              <dt className="font-medium">{t("profile.invitations")}</dt>
              <dd>
                {pendingInvites === 0
                  ? t("profile.invitationsNone")
                  : pendingInvites === 1
                    ? t("profile.invitationsOne")
                    : t("profile.invitationsMany", { count: pendingInvites })}{" "}
                <Link className="text-primary underline" href="/invite/accept">{t("profile.invitationsLink")}</Link>
              </dd>
            </dl>
          </div>
        </Panel>

        <Panel id="details" aria-labelledby="details-title" className="scroll-mt-20">
          <PanelHeader id="details-title" title={t("profile.details")} />
          <ActionForm action={updateProfile} className="space-y-5 px-4 py-4 sm:px-6">
            <Field label={t("profile.displayName")} htmlFor="display_name" hint={t("profile.displayNameHint")} required>
              <Input
                id="display_name"
                name="display_name"
                defaultValue={profile.display_name}
                maxLength={DISPLAY_NAME_MAX}
                required
                autoComplete="name"
                aria-describedby="display_name-hint"
              />
            </Field>
            <Field label={t("profile.bio")} htmlFor="bio" hint={t("profile.bioHint")}>
              <Textarea id="bio" name="bio" defaultValue={profile.bio} maxLength={BIO_MAX} rows={4} aria-describedby="bio-hint" />
            </Field>
            <Field label={t("profile.locale")} htmlFor="locale" hint={t("profile.localeHint")}>
              <Select id="locale" name="locale" defaultValue={profile.locale} aria-describedby="locale-hint">
                {PROFILE_LOCALES.map((l) => (
                  <option key={l} value={l} lang={l}>{t(`profile.locale.${l}`)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t("profile.timezone")} htmlFor="timezone" hint={t("profile.timezoneHint")}>
              <TimeZonePicker id="timezone" name="timezone" defaultValue={profile.timezone} options={tzOptions} />
            </Field>
            <SubmitButton>{t("profile.saveDetails")}</SubmitButton>
          </ActionForm>
        </Panel>

        <Panel id="photo" aria-labelledby="photo-title" className="scroll-mt-20">
          <PanelHeader id="photo-title" title={t("profile.photo")} />
          <div className="space-y-4 px-4 py-4 sm:px-6">
            {profile.avatar_asset_id ? (
              <div className="flex flex-wrap items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element -- served through the access-checked asset route */}
                <img src={`/api/assets/${profile.avatar_asset_id}`} alt={t("profile.photoCurrent")} width={80} height={80} className="h-20 w-20 rounded-full object-cover" />
                <ConfirmForm
                  action={removeAvatar}
                  trigger={t("profile.photoRemove")}
                  title={t("profile.photoRemoveTitle")}
                  description={t("profile.photoRemoveBody")}
                  confirmLabel={t("profile.photoRemove")}
                  tone="danger"
                  size="sm"
                />
              </div>
            ) : (
              <>
                {sp.photo === "removed" ? (
                  <Alert tone="success" live>
                    {t("profile.photoRemoved")}
                  </Alert>
                ) : null}
                <p className="text-sm text-muted">{t("profile.photoNone")}</p>
              </>
            )}
            <AvatarUploader />
          </div>
        </Panel>

        <Panel id="notifications" aria-labelledby="notifications-title" className="scroll-mt-20">
          <PanelHeader id="notifications-title" title={t("profile.notifications")} />
          <ActionForm action={saveNotificationPreferences} className="space-y-4 px-4 py-4 sm:px-6">
            <p className="text-sm text-muted">{t("profile.notificationsIntro")}</p>
            <fieldset>
              <legend className="mb-1 text-sm font-semibold">{t("profile.notificationsLegend")}</legend>
              <ul className="divide-y divide-line">
                {NOTIFICATION_KINDS.map((kind) => (
                  <li key={kind} className="flex items-start gap-3">
                    <input
                      id={`pref-${kind}`}
                      type="checkbox"
                      name={`in_app_${kind}`}
                      defaultChecked={inApp.get(kind) ?? true}
                      aria-describedby={`pref-${kind}-help`}
                      className="mt-3 h-5 w-5 shrink-0 rounded border-line accent-[var(--color-primary)]"
                    />
                    <div className="min-w-0 pb-2">
                      <label htmlFor={`pref-${kind}`} className="flex min-h-10 cursor-pointer items-center font-medium">
                        {t(`profile.kind.${kind}`)}
                      </label>
                      <p id={`pref-${kind}-help`} className="text-sm text-muted">{t(`profile.kindHelp.${kind}`)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </fieldset>
            <Alert tone="info" title={t("profile.emailNotificationsTitle")}>
              <p>{t("profile.emailNotificationsBody")}</p>
            </Alert>
            <SubmitButton>{t("profile.saveNotifications")}</SubmitButton>
          </ActionForm>
        </Panel>

        <Panel id="password" aria-labelledby="password-title" className="scroll-mt-20">
          <PanelHeader id="password-title" title={t("profile.password")} />
          <ActionForm action={changePassword} resetOnSuccess className="max-w-md space-y-4 px-4 py-4 sm:px-6">
            <p className="text-sm text-muted">{t("profile.passwordIntro")}</p>
            <Field label={t("profile.currentPassword")} htmlFor="current_password" required>
              <Input id="current_password" name="current_password" type="password" autoComplete="current-password" required />
            </Field>
            <Field label={t("profile.newPassword")} htmlFor="new_password" hint={t("profile.passwordRules")} required>
              <Input id="new_password" name="new_password" type="password" autoComplete="new-password" minLength={10} maxLength={200} required aria-describedby="new_password-hint" />
            </Field>
            <Field label={t("profile.confirmPassword")} htmlFor="confirm_password" required>
              <Input id="confirm_password" name="confirm_password" type="password" autoComplete="new-password" minLength={10} maxLength={200} required />
            </Field>
            <SubmitButton pendingText={t("profile.changingPassword")}>{t("profile.changePassword")}</SubmitButton>
          </ActionForm>
        </Panel>
      </PageBody>
    </>
  );
}
