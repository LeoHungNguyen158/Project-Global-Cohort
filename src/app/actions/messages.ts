"use server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { bool, isUuid, str, uuid, uuids } from "@/lib/forms";
import { isClientKey, type ThreadMessage } from "@/lib/comms/messages";
import { MAX_RECIPIENTS } from "@/lib/comms/recipients";
import { fetchThreadMessages } from "@/lib/comms/queries";
import { t } from "@/i18n";

// Messaging writes go through the database functions create_thread, send_message and
// mark_thread_read, which check scope membership, recipients, attachments and rate
// limits themselves. These actions only validate the form and translate results.

export type SendResult = ActionResult<{ threadId: string }> & { confirmCount?: number };

const MAX_ATTACHMENTS = 10;

/** Starts a conversation. Large groups need `confirmLarge`; otherwise the database answers P0428. */
export async function sendNewMessage(formData: FormData): Promise<SendResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: t("msg.sessionExpired") };

  const scopeType = str(formData, "scopeType", 16);
  const scopeId = uuid(formData, "scopeId");
  const clientKey = str(formData, "clientKey", 64);
  if ((scopeType !== "offering" && scopeType !== "cohort") || !scopeId || !isClientKey(clientKey)) {
    return { ok: false, error: t("msg.invalidRequest") };
  }
  const recipients = Array.from(new Set(uuids(formData, "to").map((id) => id.toLowerCase()))).filter((id) => id !== user.id);
  const subject = str(formData, "subject", 300);
  const body = str(formData, "body", 20_000);
  const assets = Array.from(new Set(uuids(formData, "assetIds"))).slice(0, MAX_ATTACHMENTS);
  if (recipients.length === 0) return { ok: false, error: t("msg.needRecipient") };
  if (recipients.length > MAX_RECIPIENTS) return { ok: false, error: t("msg.invalidRequest") };
  if (!subject) return { ok: false, error: t("msg.needSubject") };
  if (!body) return { ok: false, error: t("msg.needBody") };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_thread", {
    p_offering: scopeType === "offering" ? scopeId : null,
    p_cohort: scopeType === "cohort" ? scopeId : null,
    p_recipients: recipients,
    p_subject: subject,
    p_body: body,
    p_assets: assets,
    p_confirm_large: bool(formData, "confirmLarge"),
    p_client_key: clientKey,
  });
  if (error || !data) {
    if (error?.code === "P0428") {
      return { ok: false, error: t("msg.confirmTitle", { count: recipients.length }), confirmCount: recipients.length };
    }
    return { ok: false, error: friendlyError(error, t("msg.sendFailed")) };
  }
  return { ok: true, data: { threadId: String(data) } };
}

export type ReplyResult = ActionResult<{ message: ThreadMessage }>;

/** Adds a reply. Retrying with the same client key never sends it twice. */
export async function sendReply(formData: FormData): Promise<ReplyResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: t("msg.sessionExpired") };
  const threadId = uuid(formData, "threadId");
  const clientKey = str(formData, "clientKey", 64);
  const body = str(formData, "body", 20_000);
  const assets = Array.from(new Set(uuids(formData, "assetIds"))).slice(0, MAX_ATTACHMENTS);
  if (!threadId || !isClientKey(clientKey)) return { ok: false, error: t("msg.invalidRequest") };
  if (!body) return { ok: false, error: t("msg.needBody") };

  const supabase = await createClient();
  const { data: messageId, error } = await supabase.rpc("send_message", {
    p_thread: threadId,
    p_body: body,
    p_assets: assets,
    p_client_key: clientKey,
  });
  if (error || !messageId) return { ok: false, error: friendlyError(error, t("msg.replyFailed")) };

  const { messages } = await fetchThreadMessages(supabase, threadId, { ids: [String(messageId)] });
  const stored = messages[0];
  if (!stored) return { ok: false, error: t("msg.replyFailed") };
  return { ok: true, data: { message: { ...stored, senderName: user.displayName } } };
}

/** Marks a conversation read (also clears its message notifications). */
export async function markThreadRead(threadId: string): Promise<ActionResult> {
  if (!isUuid(threadId)) return { ok: false, error: t("msg.invalidRequest") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_thread_read", { p_thread: threadId });
  if (error) return { ok: false, error: friendlyError(error) };
  return { ok: true };
}
