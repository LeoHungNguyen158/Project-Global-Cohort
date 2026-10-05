"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { uuid } from "@/lib/forms";
import { t } from "@/i18n";

type MyInvitation = { id: string; state: "pending" | "accepted" | "expired" | "revoked" };

/**
 * Accepts one of the signed-in person's invitations. Invitations are matched to the
 * verified sign-in email by list_my_invitations()/accept_invitation(); the state is
 * checked first so expired, revoked, used and wrong-account cases get a clear message.
 */
export async function acceptInvitation(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const invitationId = uuid(formData, "invitation_id");
  if (!invitationId) return { ok: false, error: t("invite.error.unknown") };
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: t("profile.error.signIn") };

  const { data: mine, error: listError } = await supabase.rpc("list_my_invitations");
  if (listError) return { ok: false, error: t("invite.error.failed") };
  const invitation = ((mine ?? []) as MyInvitation[]).find((i) => i.id === invitationId);
  if (!invitation) return { ok: false, error: t("invite.error.wrongAccount") };
  if (invitation.state === "expired") return { ok: false, error: t("invite.error.expired") };
  if (invitation.state === "revoked") return { ok: false, error: t("invite.error.revoked") };
  if (invitation.state === "accepted") return { ok: false, error: t("invite.error.used") };

  const { error } = await supabase.rpc("accept_invitation", { p_invitation: invitationId });
  if (error) {
    const msg = error.message ?? "";
    if (/expired/i.test(msg)) return { ok: false, error: t("invite.error.expired") };
    if (/revoked/i.test(msg)) return { ok: false, error: t("invite.error.revoked") };
    if (/already used/i.test(msg)) return { ok: false, error: t("invite.error.used") };
    if (error.code === "42501") return { ok: false, error: t("invite.error.wrongAccount") };
    return { ok: false, error: friendlyError(error, t("invite.error.failed")) };
  }
  // New enrollments and roles change navigation, Courses and Activity.
  revalidatePath("/", "layout");
  redirect(`/invite/accept?accepted=${invitationId}`);
}
