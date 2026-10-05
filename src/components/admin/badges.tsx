import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { t } from "@/i18n";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export type InvitationState = "pending" | "accepted" | "expired" | "revoked";

export function invitationState(inv: { accepted_at: string | null; revoked_at: string | null; expires_at: string }, now = Date.now()): InvitationState {
  if (inv.revoked_at) return "revoked";
  if (inv.accepted_at) return "accepted";
  if (new Date(inv.expires_at).getTime() <= now) return "expired";
  return "pending";
}

const INVITATION: Record<InvitationState, Tone> = { pending: "info", accepted: "success", expired: "warning", revoked: "neutral" };
export function InvitationBadge({ state }: { state: InvitationState }) {
  return <Badge tone={INVITATION[state]}>{t(`admin.invitationState.${state}`)}</Badge>;
}

const EMAIL: Record<string, Tone> = { accepted_by_provider: "success", failed: "danger", existing_account_notified: "info", not_sent: "neutral" };
export function EmailStatusBadge({ status }: { status: string }) {
  const known = status in EMAIL ? (status as "accepted_by_provider" | "failed" | "existing_account_notified" | "not_sent") : "not_sent";
  return <Badge tone={EMAIL[known]}>{t(`admin.emailStatus.${known}`)}</Badge>;
}

const OFFERING: Record<string, Tone> = { draft: "warning", published: "success", archived: "neutral" };
export function OfferingStatusBadge({ status }: { status: string }) {
  const s = (status in OFFERING ? status : "draft") as "draft" | "published" | "archived";
  return <Badge tone={OFFERING[s]}>{t(`admin.offeringStatus.${s}`)}</Badge>;
}

const COHORT: Record<string, Tone> = { upcoming: "info", active: "success", archived: "neutral" };
export function CohortStatusBadge({ status }: { status: string }) {
  const s = (status in COHORT ? status : "active") as "upcoming" | "active" | "archived";
  return <Badge tone={COHORT[s]}>{t(`admin.cohortStatus.${s}`)}</Badge>;
}

const ENROLLMENT: Record<string, Tone> = { active: "success", suspended: "warning", withdrawn: "neutral", completed: "info" };
export function EnrollmentStatusBadge({ status }: { status: string }) {
  const s = (status in ENROLLMENT ? status : "active") as "active" | "suspended" | "withdrawn" | "completed";
  return <Badge tone={ENROLLMENT[s]}>{t(`admin.enrollmentStatus.${s}`)}</Badge>;
}

export function AccountBadges({ suspended, confirmed }: { suspended: boolean; confirmed: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {suspended ? <Badge tone="danger">{t("admin.account.suspended")}</Badge> : <Badge tone="success">{t("admin.account.active")}</Badge>}
      {!confirmed ? <Badge tone="warning">{t("admin.account.unconfirmed")}</Badge> : null}
    </span>
  );
}

export function RoleBadges({ roles }: { roles: string[] }) {
  if (roles.length === 0) return <span className="text-muted">{t("admin.roles.none")}</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {roles.includes("platform_admin") ? <Badge tone="info">{t("admin.roles.platform_admin")}</Badge> : null}
      {roles.includes("coordinator") ? <Badge tone="info">{t("admin.roles.coordinator")}</Badge> : null}
    </span>
  );
}

export function InviteRoleLabel({ role }: { role: string }) {
  const r = (["participant", "instructor", "ta"].includes(role) ? role : "participant") as "participant" | "instructor" | "ta";
  return <>{t(`admin.inviteRole.${r}`)}</>;
}

/** Heading row for an administration page (the layout owns the h1). */
export function SectionTitle({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-5">
      {back ? (
        <Link href={back.href} className="mb-2 inline-flex min-h-10 items-center gap-1 text-sm text-primary underline-offset-2 hover:underline">
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold [overflow-wrap:anywhere]">{title}</h2>
          {description ? <div className="mt-1 max-w-3xl text-sm text-muted">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Definition list used on detail pages. */
export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{it.label}</dt>
          <dd className="mt-0.5 [overflow-wrap:anywhere]">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
