import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listMyOfferings } from "@/lib/data/offerings";
import { formatDate, formatDateTime } from "@/lib/time";
import { isUuid } from "@/lib/forms";
import { signOut } from "@/app/actions/auth";
import { acceptInvitation } from "@/app/actions/invitations";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { t, type MessageKey } from "@/i18n";

export const metadata: Metadata = { title: t("invite.title") };

type Invitation = {
  id: string;
  role: "participant" | "instructor" | "ta";
  cohort_name: string | null;
  offering_code: string | null;
  offering_title: string | null;
  expires_at: string;
  state: "pending" | "accepted" | "expired" | "revoked";
};

const ROLE: Record<Invitation["role"], MessageKey> = {
  participant: "invite.role.participant",
  instructor: "invite.role.instructor",
  ta: "invite.role.ta",
};

function scopeText(i: Invitation) {
  if (i.offering_code) {
    const course = i.offering_title ? `${i.offering_code} — ${i.offering_title}` : i.offering_code;
    return i.cohort_name ? `${course} (${i.cohort_name})` : course;
  }
  return i.cohort_name ?? "—";
}

export default async function InviteAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string; accepted?: string; password_updated?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser("/invite/accept");
  const supabase = await createClient();
  const [listRes, offerings] = await Promise.all([supabase.rpc("list_my_invitations"), listMyOfferings()]);
  const invitations = (listRes.data ?? []) as Invitation[];
  const email = user.email ?? "";
  const tz = user.timezone;
  const offeringIdByCode = new Map(offerings.map((o) => [o.code, o.id]));

  const pending = invitations.filter((i) => i.state === "pending");
  const earlier = invitations.filter((i) => i.state !== "pending");
  const highlighted = isUuid(sp.invitation) ? sp.invitation : null;
  const wrongAccount = highlighted !== null && !invitations.some((i) => i.id === highlighted);
  const accepted = isUuid(sp.accepted) ? invitations.find((i) => i.id === sp.accepted && i.state === "accepted") ?? null : null;
  const acceptedCourseId = accepted?.offering_code ? offeringIdByCode.get(accepted.offering_code) ?? null : null;

  return (
    <>
      <PageHeader title={t("invite.title")} description={t("invite.description")} />
      <PageBody className="max-w-4xl space-y-6">
        <p className="text-sm" data-testid="invite-signed-in-as">{t("invite.signedInAs", { email })}</p>

        {sp.password_updated ? <Alert tone="success">{t("invite.passwordSet")}</Alert> : null}

        {accepted ? (
          <Alert tone="success" title={t("invite.acceptedTitle")}>
            <p>{t(accepted.offering_code ? "invite.acceptedCourse" : "invite.acceptedCohort", { scope: scopeText(accepted) })}</p>
            <p className="mt-2">
              {acceptedCourseId ? (
                <Link className="text-primary underline" href={`/courses/${acceptedCourseId}`}>{t("invite.openCourse")}</Link>
              ) : accepted.offering_code ? (
                <Link className="text-primary underline" href="/courses">{t("invite.goToCourses")}</Link>
              ) : (
                <Link className="text-primary underline" href="/cohorts">{t("invite.goToCohorts")}</Link>
              )}
            </p>
          </Alert>
        ) : null}

        {wrongAccount ? (
          <Alert tone="warning" title={t("invite.wrongAccountTitle")}>
            <p>{t("invite.wrongAccountBody", { email })}</p>
            <form action={signOut} className="mt-3">
              <button type="submit" className={buttonClass("secondary", "sm")}>{t("invite.signOut")}</button>
            </form>
          </Alert>
        ) : null}

        {listRes.error ? (
          <Alert tone="error" title={t("invite.loadError")}>
            <Link className="text-primary underline" href="/invite/accept">{t("invite.retry")}</Link>
          </Alert>
        ) : invitations.length === 0 ? (
          <EmptyState
            title={t("invite.none", { email })}
            action={
              <form action={signOut}>
                <button type="submit" className={buttonClass("secondary")}>{t("invite.signOut")}</button>
              </form>
            }
          >
            {t("invite.noneHelp")}
          </EmptyState>
        ) : (
          <>
            {pending.length > 0 ? (
              <section aria-labelledby="pending-heading">
                <h2 id="pending-heading" className="text-lg font-semibold">{t("invite.pending")}</h2>
                <p className="mb-3 text-sm text-muted">{t("invite.pendingHelp")}</p>
                <ul className="space-y-3">
                  {pending.map((i) => {
                    const label = t("invite.roleIn", { role: t(ROLE[i.role]), scope: scopeText(i) });
                    return (
                      <li
                        key={i.id}
                        id={`invitation-${i.id}`}
                        data-testid="invitation"
                        data-state="pending"
                        className={cn("rounded-[var(--radius-panel)] border border-line bg-panel px-4 py-4 sm:px-6", highlighted === i.id && "ring-2 ring-primary")}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-words font-semibold">{label}</p>
                            <p className="text-sm text-muted">{t("invite.expires", { date: formatDateTime(i.expires_at, tz) })}</p>
                          </div>
                          <Badge tone="info">{t("invite.state.pending")}</Badge>
                        </div>
                        <ActionForm action={acceptInvitation} className="mt-3">
                          <input type="hidden" name="invitation_id" value={i.id} />
                          <SubmitButton size="sm" pendingText={t("invite.accepting")} aria-label={t("invite.acceptFor", { role: t(ROLE[i.role]), scope: scopeText(i) })}>
                            {t("invite.accept")}
                          </SubmitButton>
                        </ActionForm>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {earlier.length > 0 ? (
              <section aria-labelledby="earlier-heading">
                <h2 id="earlier-heading" className="mb-3 text-lg font-semibold">{t("invite.earlier")}</h2>
                <ul className="space-y-3">
                  {earlier.map((i) => (
                    <li
                      key={i.id}
                      id={`invitation-${i.id}`}
                      data-testid="invitation"
                      data-state={i.state}
                      className={cn("rounded-[var(--radius-panel)] border border-line bg-panel px-4 py-4 sm:px-6", highlighted === i.id && "ring-2 ring-primary")}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <p className="min-w-0 break-words font-semibold">{t("invite.roleIn", { role: t(ROLE[i.role]), scope: scopeText(i) })}</p>
                        <Badge tone={i.state === "accepted" ? "success" : i.state === "revoked" ? "danger" : "warning"}>{t(`invite.state.${i.state}`)}</Badge>
                      </div>
                      <p className="mt-1 text-sm">
                        {i.state === "expired"
                          ? t("invite.expiredHelp", { date: formatDate(i.expires_at, tz) })
                          : i.state === "revoked"
                            ? t("invite.revokedHelp")
                            : t("invite.acceptedHelp")}
                        {i.state === "accepted" ? (
                          <>
                            {" "}
                            {i.offering_code && offeringIdByCode.get(i.offering_code) ? (
                              <Link className="text-primary underline" href={`/courses/${offeringIdByCode.get(i.offering_code)}`}>{t("invite.openCourse")}</Link>
                            ) : (
                              <Link className="text-primary underline" href={i.offering_code ? "/courses" : "/cohorts"}>
                                {t(i.offering_code ? "invite.goToCourses" : "invite.goToCohorts")}
                              </Link>
                            )}
                          </>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </PageBody>
    </>
  );
}
