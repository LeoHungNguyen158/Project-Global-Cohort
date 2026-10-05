import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

/** What the database decided after authorizing the caller and applying rate limits. */
export type DeliveryDecision = { id: string; email: string; action: "send" | "notified" | "not_notified" };

export type DeliveryOutcome =
  | { status: "accepted_by_provider"; recorded: boolean }
  | { status: "failed"; error: string; recorded: boolean }
  | { status: "existing_account_notified" }
  | { status: "not_notified" };

type ProviderError = { status?: number; code?: string; message?: string } | null;

/** Readable reason for an administrator (no secrets, no stack traces). */
export function providerErrorText(error: ProviderError): string {
  if (!error) return "The email service did not accept the message.";
  if (error.status === 429 || error.code === "over_email_send_rate_limit") {
    return "The email service's sending limit was reached. Try again later.";
  }
  if (error.code === "email_exists") {
    return "An account with this address already exists, so no invitation email was sent. Resend to notify the account in the app.";
  }
  if (error.code === "email_address_invalid" || error.code === "validation_failed") {
    return "The email service rejected the address.";
  }
  if (error.code === "email_address_not_authorized") {
    return "The email service is not allowed to send to this address (check the SMTP settings).";
  }
  const detail = (error.message ?? "").replace(/\s+/g, " ").slice(0, 160);
  return detail ? `The email service did not accept the message (${detail}).` : "The email service did not accept the message.";
}

/**
 * Sends the authentication invitation email for a decision the database returned.
 * Must only be called after a user-scoped RPC authorized the caller for this
 * invitation (admin_create_invitation / admin_prepare_invitation_send). The privileged
 * client is used for exactly one call: Auth's invite endpoint. The provider's answer is
 * recorded honestly: "accepted_by_provider" only when the email service accepted it.
 */
export async function deliverInvitation(
  supabase: SupabaseClient,
  decision: DeliveryDecision,
  displayName?: string | null,
): Promise<DeliveryOutcome> {
  if (decision.action === "notified") return { status: "existing_account_notified" };
  if (decision.action === "not_notified") return { status: "not_notified" };

  let error: ProviderError = null;
  try {
    const admin = createAdminClient();
    const { appBaseUrl } = serverEnv();
    const res = await admin.auth.admin.inviteUserByEmail(decision.email, {
      // The invite email template links to /auth/confirm, which continues to the
      // password form and then /invite/accept; this value must be on the allowlist.
      redirectTo: `${appBaseUrl}/invite/accept`,
      data: displayName ? { display_name: displayName } : undefined,
    });
    error = res.error ? { status: res.error.status, code: (res.error as { code?: string }).code, message: res.error.message } : null;
  } catch (e) {
    error = { message: e instanceof Error && /SUPABASE_SECRET_KEY/.test(e.message) ? "server email credentials are not configured" : "network error" };
  }

  if (!error) {
    const { error: recordError } = await supabase.rpc("admin_record_invitation_email", { p_invitation: decision.id, p_ok: true, p_error: null });
    return { status: "accepted_by_provider", recorded: !recordError };
  }
  const text = providerErrorText(error);
  const { error: recordError } = await supabase.rpc("admin_record_invitation_email", { p_invitation: decision.id, p_ok: false, p_error: text });
  return { status: "failed", error: text, recorded: !recordError };
}

/**
 * Makes an emailed invitation link stop working by issuing a fresh one-time token for
 * the (still unconfirmed) account without sending it. Called only after
 * admin_revoke_invitation authorized the caller and reported that the account was
 * never confirmed and has no other pending invitation.
 */
export async function invalidateInvitationLink(email: string): Promise<{ ok: boolean }> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.generateLink({ type: "invite", email });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
