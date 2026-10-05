"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { int, str, uuid } from "@/lib/forms";
import { actionAdmin, dbFail, fail } from "@/lib/admin/action-utils";
import { deliverInvitation, invalidateInvitationLink, type DeliveryDecision, type DeliveryOutcome } from "@/lib/admin/invitations";
import { INVITE_ROLES, isValidEmail, normalizeEmail, normalizeName, MAX_NAME_LENGTH, type InviteRole } from "@/lib/admin/import";
import { expiryFromDays } from "@/lib/admin/validation";
import type { NoticeResult } from "@/components/admin/result-form";
import { t } from "@/i18n";

function refresh() {
  revalidatePath("/admin/invitations");
  revalidatePath("/admin");
}

/** Words the delivery outcome for the administrator. Only a provider acceptance counts as "sent". */
function outcomeNotice(email: string, outcome: DeliveryOutcome, created: boolean): NoticeResult {
  const lead = created ? t("admin.invite.created", { email }) : t("admin.invite.resent", { email });
  switch (outcome.status) {
    case "accepted_by_provider":
      return {
        ok: true,
        message: `${lead} ${t("admin.invite.outcome.accepted")}`,
        data: outcome.recorded ? { tone: "success" } : { tone: "warning", details: [t("admin.invite.outcome.notRecorded")] },
      };
    case "failed":
      return { ok: true, message: `${lead} ${t("admin.invite.outcome.failed", { error: outcome.error })}`, data: { tone: "warning" } };
    case "existing_account_notified":
      return { ok: true, message: `${lead} ${t("admin.invite.outcome.notified")}`, data: { tone: "success" } };
    case "not_notified":
      return { ok: true, message: `${lead} ${t("admin.invite.outcome.notNotified")}`, data: { tone: "warning" } };
  }
}

/**
 * Creates an invitation (the database authorizes the caller for the cohort/offering,
 * checks conflicts and applies rate limits), then sends the authentication invitation
 * email for addresses without an account. Existing accounts are notified in the app.
 */
export async function createInvitation(_prev: NoticeResult | null, formData: FormData): Promise<NoticeResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const email = normalizeEmail(str(formData, "email", 320));
  const displayName = normalizeName(str(formData, "display_name", 400));
  const role = str(formData, "role", 20) as InviteRole;
  const cohortId = uuid(formData, "cohort");
  const offeringId = uuid(formData, "offering");
  const days = int(formData, "expires_days");

  const errors: Record<string, string> = {};
  if (!isValidEmail(email)) errors.email = t("admin.invite.error.email");
  if (displayName.length > MAX_NAME_LENGTH) errors.display_name = t("admin.invite.error.name");
  if (!INVITE_ROLES.includes(role)) errors.role = t("admin.invite.error.role");
  if (!cohortId && !offeringId) errors.cohort = t("admin.invite.error.scope");
  if (role !== "participant" && !offeringId) errors.offering = t("admin.invite.error.staffOffering");
  const expiresAt = days === null ? null : expiryFromDays(days);
  if (!expiresAt) errors.expires_days = t("admin.invite.error.expiry");
  if (Object.keys(errors).length > 0) return fail(Object.values(errors)[0], errors);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_invitation", {
    p_email: email,
    p_role: role,
    p_cohort: cohortId,
    p_offering: offeringId,
    p_expires_at: expiresAt,
  });
  if (error) return dbFail(error);
  const decision = data as DeliveryDecision;
  const outcome = await deliverInvitation(supabase, decision, displayName || null);
  refresh();
  return outcomeNotice(decision.email, outcome, true);
}

/** Sends the invitation again (renewing an expired one for 14 days). */
export async function resendInvitation(_prev: NoticeResult | null, formData: FormData): Promise<NoticeResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const invitationId = uuid(formData, "invitation");
  if (!invitationId) return fail(t("admin.common.invalidRequest"));
  const renew = str(formData, "renew", 1) === "1";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_prepare_invitation_send", { p_invitation: invitationId, p_renew: renew });
  if (error) return dbFail(error);
  const decision = data as DeliveryDecision;
  const outcome = await deliverInvitation(supabase, decision);
  refresh();
  if (outcome.status === "failed") return fail(t("admin.invite.resendFailed", { error: outcome.error }));
  return outcomeNotice(decision.email, outcome, false);
}

type RevokeInfo = { email: string; account_state: "none" | "unconfirmed" | "confirmed"; other_pending: boolean };

/**
 * Revokes a pending invitation. When the address has an unconfirmed account that was
 * created only for this invitation, the emailed sign-in link is invalidated too.
 */
export async function revokeInvitation(_prev: NoticeResult | null, formData: FormData): Promise<NoticeResult> {
  const auth = await actionAdmin();
  if ("denied" in auth) return auth.denied;
  const invitationId = uuid(formData, "invitation");
  const reason = str(formData, "reason", 600);
  if (!invitationId) return fail(t("admin.common.invalidRequest"));
  if (reason.length > 500) return fail(t("admin.invite.error.reason"));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_revoke_invitation", { p_invitation: invitationId, p_reason: reason });
  if (error) return dbFail(error);
  const info = data as RevokeInfo;
  refresh();

  if (info.account_state === "unconfirmed" && !info.other_pending) {
    const { ok } = await invalidateInvitationLink(info.email);
    return ok
      ? { ok: true, message: t("admin.invite.revoked.linkDisabled", { email: info.email }), data: { tone: "success" } }
      : { ok: true, message: t("admin.invite.revoked.linkNotDisabled", { email: info.email }), data: { tone: "warning" } };
  }
  if (info.account_state === "unconfirmed") {
    return { ok: true, message: t("admin.invite.revoked.otherPending", { email: info.email }), data: { tone: "info" } };
  }
  if (info.account_state === "confirmed") {
    return { ok: true, message: t("admin.invite.revoked.existingAccount", { email: info.email }), data: { tone: "success" } };
  }
  return { ok: true, message: t("admin.invite.revoked.noLink", { email: info.email }), data: { tone: "success" } };
}
