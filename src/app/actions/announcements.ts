"use server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { bool, dateTime, str, uuid } from "@/lib/forms";
import { markdownToSafeHtml } from "@/lib/markdown";
import {
  announcementState, isAllowedOp, parsePublishMode, resolvePublication, type AnnouncementStatus, type PublishMode,
} from "@/lib/comms/announcements";
import { announcementEditorBase, announcementsPath, type AnnouncementScope } from "@/lib/comms/paths";
import { t, type MessageKey } from "@/i18n";

// Announcements are written directly to the table: RLS allows it only to staff who may
// communicate in the course (has_staff_perm 'communicate') or administrators of the
// cohort. Triggers stamp the database's own time on "publish now", keep the replaced
// version of a published announcement, notify the audience once it is due, and audit
// publication and status changes.

const MAX_TITLE = 300;

const SCHEDULE_ERRORS: Record<"scheduleMissing" | "schedulePast" | "scheduleInvalid", MessageKey> = {
  scheduleMissing: "ann.errScheduleMissing",
  schedulePast: "ann.errSchedulePast",
  scheduleInvalid: "ann.errScheduleInvalid",
};

function readScope(formData: FormData): AnnouncementScope | null {
  const type = str(formData, "scopeType", 16);
  const id = uuid(formData, "scopeId");
  if (!id || (type !== "offering" && type !== "cohort")) return null;
  return { type, id: id.toLowerCase() };
}

function column(scope: AnnouncementScope) {
  return scope.type === "offering" ? "offering_id" : "cohort_id";
}

/** Re-renders the list and the editor pages beneath it (for a cohort: the cohort page and its subpages). */
function refresh(scope: AnnouncementScope) {
  revalidatePath(scope.type === "offering" ? announcementEditorBase(scope) : announcementsPath(scope), "layout");
}

type Saved = "draft" | "published" | "scheduled" | "changes";

function savedState(row: { status: AnnouncementStatus; publish_at: string | null }): Saved {
  const state = announcementState(row);
  return state === "scheduled" ? "scheduled" : state === "published" ? "published" : "draft";
}

function listUrl(scope: AnnouncementScope, saved: Saved, id: string) {
  return `${announcementsPath(scope)}?saved=${saved}#a-${id}`;
}

/** Creates or edits an announcement from the editor form. Success opens it in the list. */
export async function saveAnnouncement(_prev: unknown, formData: FormData): Promise<ActionResult<{ redirectTo: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: t("msg.sessionExpired") };
  const scope = readScope(formData);
  const rawId = str(formData, "announcementId", 64);
  const announcementId = rawId ? uuid(formData, "announcementId") : null;
  if (!scope || (rawId && !announcementId)) return { ok: false, error: t("msg.invalidRequest") };

  const title = str(formData, "title", MAX_TITLE + 1);
  if (!title || title.length > MAX_TITLE) return { ok: false, error: t("ann.errTitle"), fieldErrors: { title: t("ann.errTitle") } };
  const bodyHtml = markdownToSafeHtml(str(formData, "body", 50_000));
  if (!bodyHtml) return { ok: false, error: t("ann.errBody"), fieldErrors: { body: t("ann.errBody") } };
  const pinned = bool(formData, "pinned");
  const requested = parsePublishMode(str(formData, "mode", 16));
  const supabase = await createClient();

  if (!announcementId) {
    const mode: PublishMode = requested && requested !== "keep" ? requested : "draft";
    const publication = resolvePublication(mode, dateTime(formData, "scheduleAt"));
    if (!publication.ok) return { ok: false, error: t(SCHEDULE_ERRORS[publication.error]) };
    const { data, error } = await supabase
      .from("announcements")
      .insert({
        [column(scope)]: scope.id,
        title,
        body_html: bodyHtml,
        pinned,
        status: publication.status ?? "draft",
        publish_at: publication.publish_at ?? null,
        created_by: user.id,
      })
      .select("id, status, publish_at")
      .single();
    if (error || !data) return { ok: false, error: friendlyError(error, t("ann.errSave")) };
    refresh(scope);
    return { ok: true, data: { redirectTo: listUrl(scope, savedState(data), data.id) } };
  }

  const { data: current } = await supabase
    .from("announcements")
    .select("id, status, publish_at")
    .eq("id", announcementId)
    .eq(column(scope), scope.id)
    .maybeSingle();
  if (!current) return { ok: false, error: t("ann.errNotFound") };
  const state = announcementState(current);
  if (state === "archived") return { ok: false, error: t("ann.archivedNoEdit") };

  let change: { status?: AnnouncementStatus; publish_at?: string | null } = {};
  if (state !== "published") {
    // A draft stays a draft unless another option was chosen; "keep" only applies to a scheduled one.
    const mode: PublishMode = !requested || (requested === "keep" && state === "draft") ? "draft" : requested;
    const publication = resolvePublication(mode, dateTime(formData, "scheduleAt"));
    if (!publication.ok) return { ok: false, error: t(SCHEDULE_ERRORS[publication.error]) };
    if (publication.status) change = { status: publication.status, publish_at: publication.publish_at ?? null };
  }

  const { data: updated, error } = await supabase
    .from("announcements")
    .update({ title, body_html: bodyHtml, pinned, ...change })
    .eq("id", announcementId)
    .eq(column(scope), scope.id)
    .select("id, status, publish_at");
  if (error) return { ok: false, error: friendlyError(error, t("ann.errSave")) };
  // RLS hides rows the caller may not change: an empty result means nothing was saved.
  if (!updated || updated.length === 0) return { ok: false, error: t("ann.errNotFound") };
  refresh(scope);
  const saved: Saved = state === "published" ? "changes" : savedState(updated[0]);
  return { ok: true, data: { redirectTo: listUrl(scope, saved, announcementId) } };
}

const OP_MESSAGES: Record<string, MessageKey> = {
  publish: "ann.savedPublished",
  unschedule: "ann.restoredDone",
  archive: "ann.archivedDone",
  restore: "ann.restoredDone",
  pin: "ann.pinnedDone",
  unpin: "ann.unpinnedDone",
};

/** Publish now, move back to drafts, archive, restore, pin or unpin from the list. */
export async function changeAnnouncement(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: t("msg.sessionExpired") };
  const scope = readScope(formData);
  const announcementId = uuid(formData, "announcementId");
  const op = str(formData, "op", 16);
  if (!scope || !announcementId) return { ok: false, error: t("msg.invalidRequest") };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("announcements")
    .select("id, status, publish_at, pinned")
    .eq("id", announcementId)
    .eq(column(scope), scope.id)
    .maybeSingle();
  if (!current) return { ok: false, error: t("ann.errNotFound") };
  const state = announcementState(current);
  if (!isAllowedOp(op, state, current.pinned)) return { ok: false, error: t("ann.errState") };

  const patch =
    op === "publish"
      ? { status: "published", publish_at: null }
      : op === "unschedule" || op === "restore"
        ? { status: "draft", publish_at: null }
        : op === "archive"
          ? { status: "archived" }
          : { pinned: op === "pin" };
  const { data: updated, error } = await supabase
    .from("announcements")
    .update(patch)
    .eq("id", announcementId)
    .eq(column(scope), scope.id)
    .select("id");
  if (error) return { ok: false, error: friendlyError(error, t("ann.errSave")) };
  if (!updated || updated.length === 0) return { ok: false, error: t("ann.errNotFound") };
  refresh(scope);
  return { ok: true, message: t(OP_MESSAGES[op]) };
}
