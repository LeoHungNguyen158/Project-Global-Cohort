"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/errors";
import { bool, isHttpsUrl, isUuid, str, uuid, uuids } from "@/lib/forms";
import { markdownToSafeHtml } from "@/lib/markdown";
import { parseEmbedUrl } from "@/lib/learning/embed";
import { moveItem, positionChanges, type Direction } from "@/lib/learning/reorder";
import { assetKind, isCaptionLanguage, roleProblem, type AssetRole } from "@/lib/learning/assets";
import { isCompletionRule, isLessonContentType, LIMITS, parseDurationMinutes, parseObjectives } from "@/lib/learning/validate";
import { withNotice } from "@/lib/learning/notices";
import { t } from "@/i18n";

// Course authoring: drafts, modules, lessons, files, publishing, adoption and release.
// Authorization lives in the database: RLS limits writes to draft versions of courses
// the user may author, guard triggers keep published versions immutable, and the RPCs
// (create_course_draft, publish_course_version, adopt_course_version, publish_offering,
// update_asset_metadata) check permission and audit. Every field is validated here too.

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Result = ActionResult<{ id?: string }>;

const fail = (error: string): Result => ({ ok: false, error });

function revalidateCourse(offeringId: string | null) {
  if (offeringId) revalidatePath(`/courses/${offeringId}`, "layout");
}

const manageBase = (offeringId: string) => `/courses/${offeringId}/content/manage`;

function direction(formData: FormData): Direction | null {
  const d = str(formData, "direction", 8);
  return d === "up" || d === "down" ? d : null;
}

async function session(): Promise<{ supabase: Supabase; userId: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, userId: data.user?.id ?? null };
}

/** The draft version a module/lesson belongs to, or an error when it is not an editable draft. */
async function draftOf(supabase: Supabase, versionId: string): Promise<{ id: string; course_id: string } | string> {
  const { data } = await supabase.from("course_versions").select("id, course_id, status").eq("id", versionId).maybeSingle();
  if (!data) return t("author.err.notFound");
  if (data.status !== "draft") return t("author.err.notDraft");
  return { id: data.id as string, course_id: data.course_id as string };
}

function writeError(error: { message?: string; code?: string } | null): string {
  if (/published course version/i.test(error?.message ?? "")) return t("author.err.notDraft");
  return friendlyError(error, t("author.err.generic"));
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export async function createDraft(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  if (!offeringId) return fail(t("author.err.notFound"));
  const { supabase } = await session();
  const { data: offering } = await supabase.from("course_offerings").select("course_id").eq("id", offeringId).maybeSingle();
  if (!offering) return fail(t("author.err.notFound"));
  const { data, error } = await supabase.rpc("create_course_draft", { p_course: offering.course_id });
  if (error || !data) return fail(friendlyError(error, t("author.err.generic")));
  revalidateCourse(offeringId);
  redirect(`/courses/${offeringId}/content/manage/versions/${data as string}`);
}

export async function updateVersionDetails(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const versionId = uuid(formData, "versionId");
  if (!offeringId || !versionId) return fail(t("author.err.notFound"));
  const title = str(formData, "title", LIMITS.title + 1);
  if (!title || title.length > LIMITS.title) return fail(t("author.err.title"));
  const objectives = parseObjectives(str(formData, "objectives", 20_000));
  if (!objectives.ok) return fail(objectives.reason === "too_many" ? t("author.err.objectivesTooMany") : t("author.err.objectivesTooLong"));
  const summary = str(formData, "summary", LIMITS.summary + 1);
  const audience = str(formData, "audience", LIMITS.shortText + 1);
  const effort = str(formData, "effort", LIMITS.shortText + 1);
  const prereq = str(formData, "prerequisites", LIMITS.longText + 1);
  const grading = str(formData, "grading", LIMITS.longText + 1);
  if (summary.length > LIMITS.summary || audience.length > LIMITS.shortText || effort.length > LIMITS.shortText || prereq.length > LIMITS.longText || grading.length > LIMITS.longText) {
    return fail(t("author.err.text"));
  }
  const syllabus = markdownToSafeHtml(str(formData, "syllabus", LIMITS.body));
  const { supabase } = await session();
  const { data, error } = await supabase
    .from("course_versions")
    .update({
      title,
      summary,
      objectives: objectives.value,
      audience,
      expected_effort: effort,
      prerequisites_text: prereq,
      syllabus_html: syllabus,
      grading_policy: grading,
    })
    .eq("id", versionId)
    .eq("status", "draft")
    .select("id");
  if (error) return fail(writeError(error));
  if (!data || data.length === 0) return fail(t("author.err.notDraft"));
  revalidateCourse(offeringId);
  return { ok: true, message: t("author.version.saved") };
}

export async function publishVersion(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const versionId = uuid(formData, "versionId");
  if (!offeringId || !versionId) return fail(t("author.err.notFound"));
  const { supabase } = await session();
  // A playback rule without an uploaded video could never be met: stop before publishing.
  const { data: lessons } = await supabase
    .from("lessons")
    .select("title, completion_rule, lesson_assets(role, content_assets(declared_mime))")
    .eq("course_version_id", versionId)
    .eq("completion_rule", "video_watched");
  for (const l of (lessons ?? []) as unknown as { title: string; lesson_assets: { role: string; content_assets: { declared_mime: string } | null }[] }[]) {
    const hasVideo = l.lesson_assets.some((a) => a.role === "primary" && a.content_assets && assetKind(a.content_assets.declared_mime) === "video");
    if (!hasVideo) return fail(t("author.err.publishVideoRule", { title: l.title }));
  }
  const { error } = await supabase.rpc("publish_course_version", { p_version: versionId });
  if (error) return fail(friendlyError(error, t("author.err.generic")));
  revalidateCourse(offeringId);
  // The publish button disappears with the draft, so the page that ran it shows the result.
  const back = str(formData, "returnTo", 10) === "version" ? `${manageBase(offeringId)}/versions/${versionId}` : manageBase(offeringId);
  redirect(withNotice(back, "published"));
}

export async function adoptVersion(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const versionId = uuid(formData, "versionId");
  if (!offeringId || !versionId) return fail(t("author.err.notFound"));
  const { supabase } = await session();
  const { error } = await supabase.rpc("adopt_course_version", { p_offering: offeringId, p_version: versionId });
  if (error) return fail(friendlyError(error, t("author.err.generic")));
  revalidateCourse(offeringId);
  redirect(withNotice(manageBase(offeringId), "adopted"));
}

export async function releaseOffering(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  if (!offeringId) return fail(t("author.err.notFound"));
  const { supabase } = await session();
  const { error } = await supabase.rpc("publish_offering", { p_offering: offeringId });
  if (error) return fail(friendlyError(error, t("author.err.generic")));
  revalidateCourse(offeringId);
  redirect(withNotice(manageBase(offeringId), "released"));
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export async function addModule(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const versionId = uuid(formData, "versionId");
  const title = str(formData, "title", LIMITS.title + 1);
  const description = str(formData, "description", LIMITS.moduleDescription + 1);
  if (!versionId) return fail(t("author.err.notFound"));
  if (!title || title.length > LIMITS.title) return fail(t("author.err.title"));
  if (description.length > LIMITS.moduleDescription) return fail(t("author.err.text"));
  const { supabase } = await session();
  const draft = await draftOf(supabase, versionId);
  if (typeof draft === "string") return fail(draft);
  const { data: last } = await supabase.from("modules").select("position").eq("course_version_id", versionId).order("position", { ascending: false }).limit(1);
  const position = last && last.length > 0 ? Number(last[0].position) + 1 : 0;
  const { error } = await supabase.from("modules").insert({ course_version_id: versionId, position, title, description });
  if (error) return fail(writeError(error));
  revalidateCourse(offeringId);
  return { ok: true, message: t("author.module.added") };
}

export async function updateModule(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const moduleId = uuid(formData, "moduleId");
  const title = str(formData, "title", LIMITS.title + 1);
  const description = str(formData, "description", LIMITS.moduleDescription + 1);
  if (!moduleId) return fail(t("author.err.notFound"));
  if (!title || title.length > LIMITS.title) return fail(t("author.err.title"));
  if (description.length > LIMITS.moduleDescription) return fail(t("author.err.text"));
  const { supabase } = await session();
  const { data, error } = await supabase.from("modules").update({ title, description }).eq("id", moduleId).select("id");
  if (error) return fail(writeError(error));
  if (!data || data.length === 0) return fail(t("author.err.notFound"));
  revalidateCourse(offeringId);
  return { ok: true, message: t("author.module.saved") };
}

export async function removeModule(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const moduleId = uuid(formData, "moduleId");
  if (!offeringId || !moduleId) return fail(t("author.err.notFound"));
  const { supabase } = await session();
  // Lessons (and their file links) go with the module; progress is keyed by lineage and kept.
  const { data, error } = await supabase.from("modules").delete().eq("id", moduleId).select("id, course_version_id");
  if (error) return fail(writeError(error));
  if (!data || data.length === 0) return fail(t("author.err.notFound"));
  revalidateCourse(offeringId);
  redirect(withNotice(`${manageBase(offeringId)}/versions/${data[0].course_version_id as string}`, "moduleRemoved"));
}

async function applyPositions(supabase: Supabase, table: "modules" | "lessons", changes: { id: string; position: number }[]): Promise<string | null> {
  for (const c of changes) {
    const { error } = await supabase.from(table).update({ position: c.position }).eq("id", c.id);
    if (error) return writeError(error);
  }
  return null;
}

export async function moveModule(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const moduleId = uuid(formData, "moduleId");
  const dir = direction(formData);
  if (!moduleId || !dir) return fail(t("author.err.notFound"));
  const { supabase } = await session();
  const { data: mod } = await supabase.from("modules").select("id, title, course_version_id").eq("id", moduleId).maybeSingle();
  if (!mod) return fail(t("author.err.notFound"));
  const { data: siblings } = await supabase
    .from("modules")
    .select("id, position")
    .eq("course_version_id", mod.course_version_id)
    .order("position")
    .order("created_at");
  const rows = (siblings ?? []) as { id: string; position: number }[];
  const order = moveItem(rows.map((r) => r.id), moduleId, dir);
  if (!order) return { ok: true };
  const problem = await applyPositions(supabase, "modules", positionChanges(rows, order));
  if (problem) return fail(problem);
  revalidateCourse(offeringId);
  return { ok: true, message: t("author.move.done", { title: mod.title, position: order.indexOf(moduleId) + 1, count: order.length }) };
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

export async function addLesson(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const moduleId = uuid(formData, "moduleId");
  const title = str(formData, "title", LIMITS.title + 1);
  const type = str(formData, "contentType", 20);
  if (!offeringId || !moduleId) return fail(t("author.err.notFound"));
  if (!title || title.length > LIMITS.title) return fail(t("author.err.title"));
  if (!isLessonContentType(type)) return fail(t("author.err.contentType"));
  const { supabase } = await session();
  const { data: mod } = await supabase.from("modules").select("id, course_version_id").eq("id", moduleId).maybeSingle();
  if (!mod) return fail(t("author.err.notFound"));
  const draft = await draftOf(supabase, mod.course_version_id);
  if (typeof draft === "string") return fail(draft);
  const { data: last } = await supabase.from("lessons").select("position").eq("module_id", moduleId).order("position", { ascending: false }).limit(1);
  const position = last && last.length > 0 ? Number(last[0].position) + 1 : 0;
  const { data, error } = await supabase
    .from("lessons")
    .insert({ module_id: moduleId, course_version_id: mod.course_version_id, position, title, content_type: type, completion_rule: "acknowledge" })
    .select("id")
    .single();
  if (error || !data) return fail(writeError(error));
  revalidateCourse(offeringId);
  redirect(`/courses/${offeringId}/content/manage/versions/${mod.course_version_id}/lessons/${data.id}?created=1`);
}

const EMBED_ERRORS = {
  empty: "author.err.embedInvalid",
  not_https: "author.err.embedHttps",
  invalid_url: "author.err.embedInvalid",
  provider: "author.err.embedProvider",
  no_id: "author.err.embedNoId",
  markup: "author.err.embedMarkup",
} as const;

async function hasPrimaryVideo(supabase: Supabase, lessonId: string): Promise<boolean> {
  const { data } = await supabase
    .from("lesson_assets")
    .select("role, content_assets(declared_mime)")
    .eq("lesson_id", lessonId)
    .eq("role", "primary");
  return ((data ?? []) as unknown as { content_assets: { declared_mime: string } | null }[]).some(
    (a) => a.content_assets && assetKind(a.content_assets.declared_mime) === "video",
  );
}

export async function updateLesson(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const lessonId = uuid(formData, "lessonId");
  const moduleId = uuid(formData, "moduleId");
  if (!offeringId || !lessonId || !moduleId) return fail(t("author.err.notFound"));
  const title = str(formData, "title", LIMITS.title + 1);
  if (!title || title.length > LIMITS.title) return fail(t("author.err.title"));
  const type = str(formData, "contentType", 20);
  if (!isLessonContentType(type)) return fail(t("author.err.contentType"));
  const rule = str(formData, "completionRule", 20);
  if (!isCompletionRule(rule)) return fail(t("author.err.rule"));
  const duration = parseDurationMinutes(str(formData, "duration", 10));
  if (duration === "invalid") return fail(t("author.err.duration"));
  const externalRaw = str(formData, "externalUrl", 2001);
  if (externalRaw && (externalRaw.length > 2000 || !isHttpsUrl(externalRaw))) return fail(t("author.err.externalUrl"));
  const embedRaw = str(formData, "embedUrl", 2001);
  let embed: { provider: string; id: string } | null = null;
  if (embedRaw) {
    const parsed = parseEmbedUrl(embedRaw);
    if (!parsed.ok) return fail(t(EMBED_ERRORS[parsed.reason]));
    embed = { provider: parsed.provider, id: parsed.id };
  }
  const transcript = str(formData, "transcript", LIMITS.transcript + 1);
  if (transcript.length > LIMITS.transcript) return fail(t("author.err.text"));
  const body = markdownToSafeHtml(str(formData, "body", LIMITS.body));

  const { supabase } = await session();
  const { data: lesson } = await supabase.from("lessons").select("id, module_id, course_version_id").eq("id", lessonId).maybeSingle();
  if (!lesson) return fail(t("author.err.notFound"));
  const draft = await draftOf(supabase, lesson.course_version_id);
  if (typeof draft === "string") return fail(draft);
  if (rule === "video_watched" && !(await hasPrimaryVideo(supabase, lessonId))) return fail(t("author.err.videoRuleNeedsVideo"));

  const patch: Record<string, unknown> = {
    title,
    content_type: type,
    completion_rule: rule,
    required: bool(formData, "required"),
    duration_minutes: duration,
    external_url: externalRaw || null,
    embed_provider: embed?.provider ?? null,
    embed_id: embed?.id ?? null,
    transcript,
    body_html: body,
  };
  if (moduleId !== lesson.module_id) {
    const { data: target } = await supabase.from("modules").select("id, course_version_id").eq("id", moduleId).maybeSingle();
    if (!target || target.course_version_id !== lesson.course_version_id) return fail(t("author.err.notFound"));
    const { data: last } = await supabase.from("lessons").select("position").eq("module_id", moduleId).order("position", { ascending: false }).limit(1);
    patch.module_id = moduleId;
    patch.position = last && last.length > 0 ? Number(last[0].position) + 1 : 0;
  }
  const { data, error } = await supabase.from("lessons").update(patch).eq("id", lessonId).select("id");
  if (error) return fail(writeError(error));
  if (!data || data.length === 0) return fail(t("author.err.notFound"));
  revalidateCourse(offeringId);
  return { ok: true, message: t("author.lessonEdit.saved") };
}

export async function removeLesson(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const lessonId = uuid(formData, "lessonId");
  if (!offeringId || !lessonId) return fail(t("author.err.notFound"));
  const { supabase } = await session();
  const { data, error } = await supabase.from("lessons").delete().eq("id", lessonId).select("id, course_version_id");
  if (error) return fail(writeError(error));
  if (!data || data.length === 0) return fail(t("author.err.notFound"));
  revalidateCourse(offeringId);
  redirect(withNotice(`${manageBase(offeringId)}/versions/${data[0].course_version_id as string}`, "lessonRemoved"));
}

export async function moveLesson(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const lessonId = uuid(formData, "lessonId");
  const dir = direction(formData);
  if (!lessonId || !dir) return fail(t("author.err.notFound"));
  const { supabase } = await session();
  const { data: lesson } = await supabase.from("lessons").select("id, title, module_id").eq("id", lessonId).maybeSingle();
  if (!lesson) return fail(t("author.err.notFound"));
  const { data: siblings } = await supabase.from("lessons").select("id, position").eq("module_id", lesson.module_id).order("position").order("created_at");
  const rows = (siblings ?? []) as { id: string; position: number }[];
  const order = moveItem(rows.map((r) => r.id), lessonId, dir);
  if (!order) return { ok: true };
  const problem = await applyPositions(supabase, "lessons", positionChanges(rows, order));
  if (problem) return fail(problem);
  revalidateCourse(offeringId);
  return { ok: true, message: t("author.move.done", { title: lesson.title, position: order.indexOf(lessonId) + 1, count: order.length }) };
}

// ---------------------------------------------------------------------------
// Lesson files
// ---------------------------------------------------------------------------

const ROLES: AssetRole[] = ["primary", "captions", "attachment"];

function readRole(formData: FormData): { role: AssetRole; language: string | null } | string {
  const role = str(formData, "role", 20) as AssetRole;
  if (!ROLES.includes(role)) return t("author.err.generic");
  const language = str(formData, "language", 10);
  if (role === "captions") {
    if (!isCaptionLanguage(language)) return t("author.files.languageRequired");
    return { role, language };
  }
  return { role, language: null };
}

export async function attachFiles(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const lessonId = uuid(formData, "lessonId");
  const assetIds = Array.from(new Set(uuids(formData, "assetIds"))).slice(0, 10);
  if (!lessonId) return fail(t("author.err.notFound"));
  const roleInput = readRole(formData);
  if (typeof roleInput === "string") return fail(roleInput);
  if (assetIds.length === 0) return fail(t("author.files.noneUploaded"));
  const { supabase } = await session();
  const { data: lesson } = await supabase.from("lessons").select("id, course_version_id").eq("id", lessonId).maybeSingle();
  if (!lesson) return fail(t("author.err.notFound"));
  const draft = await draftOf(supabase, lesson.course_version_id);
  if (typeof draft === "string") return fail(draft);
  const { data: assets } = await supabase.from("content_assets").select("id, declared_mime, purpose, status, course_version_id").in("id", assetIds);
  const found = (assets ?? []) as { id: string; declared_mime: string; purpose: string; status: string; course_version_id: string | null }[];
  if (found.length !== assetIds.length || found.some((a) => a.purpose !== "lesson")) return fail(t("author.files.noneUploaded"));
  if (found.some((a) => a.status !== "ready")) return fail(t("author.files.notReady"));
  // Files must belong to a version of the same course (copies of a draft reuse earlier files).
  const versionIds = Array.from(new Set(found.map((a) => a.course_version_id).filter((v): v is string => Boolean(v))));
  const { data: versions } = await supabase.from("course_versions").select("id, course_id").in("id", versionIds.length ? versionIds : [lesson.course_version_id]);
  const sameCourse = new Set(((versions ?? []) as { id: string; course_id: string }[]).filter((v) => v.course_id === draft.course_id).map((v) => v.id));
  if (found.some((a) => !a.course_version_id || !sameCourse.has(a.course_version_id))) return fail(t("author.err.notFound"));
  for (const a of found) {
    const problem = roleProblem(roleInput.role, a.declared_mime);
    if (problem) return fail(problem);
  }
  const { data: last } = await supabase.from("lesson_assets").select("position").eq("lesson_id", lessonId).order("position", { ascending: false }).limit(1);
  let position = last && last.length > 0 ? Number(last[0].position) + 1 : 0;
  const rows = assetIds.map((id) => ({ lesson_id: lessonId, asset_id: id, role: roleInput.role, caption_language: roleInput.language, position: position++ }));
  const { error } = await supabase.from("lesson_assets").insert(rows);
  if (error) return fail(writeError(error));
  revalidateCourse(offeringId);
  return { ok: true, message: t("author.files.attached") };
}

export async function updateFileRole(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const lessonId = uuid(formData, "lessonId");
  const assetId = uuid(formData, "assetId");
  if (!lessonId || !assetId) return fail(t("author.err.notFound"));
  const roleInput = readRole(formData);
  if (typeof roleInput === "string") return fail(roleInput);
  const { supabase } = await session();
  const { data: asset } = await supabase.from("content_assets").select("declared_mime").eq("id", assetId).maybeSingle();
  if (!asset) return fail(t("author.err.notFound"));
  const problem = roleProblem(roleInput.role, asset.declared_mime);
  if (problem) return fail(problem);
  const { data, error } = await supabase
    .from("lesson_assets")
    .update({ role: roleInput.role, caption_language: roleInput.language })
    .eq("lesson_id", lessonId)
    .eq("asset_id", assetId)
    .select("asset_id");
  if (error) return fail(writeError(error));
  if (!data || data.length === 0) return fail(t("author.err.notFound"));
  revalidateCourse(offeringId);
  return { ok: true, message: t("author.files.roleSaved") };
}

export async function removeFile(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const lessonId = uuid(formData, "lessonId");
  const assetId = uuid(formData, "assetId");
  if (!offeringId || !lessonId || !assetId) return fail(t("author.err.notFound"));
  const { supabase } = await session();
  const { data: lesson } = await supabase.from("lessons").select("course_version_id").eq("id", lessonId).maybeSingle();
  if (!lesson) return fail(t("author.err.notFound"));
  const { data, error } = await supabase.from("lesson_assets").delete().eq("lesson_id", lessonId).eq("asset_id", assetId).select("asset_id");
  if (error) return fail(writeError(error));
  if (!data || data.length === 0) return fail(t("author.err.notFound"));
  revalidateCourse(offeringId);
  redirect(withNotice(`${manageBase(offeringId)}/versions/${lesson.course_version_id as string}/lessons/${lessonId}`, "fileRemoved"));
}

export async function moveFile(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const lessonId = uuid(formData, "lessonId");
  const assetId = uuid(formData, "assetId");
  const dir = direction(formData);
  if (!lessonId || !assetId || !dir) return fail(t("author.err.notFound"));
  const { supabase } = await session();
  const { data: siblings } = await supabase
    .from("lesson_assets")
    .select("asset_id, position, content_assets(filename, title)")
    .eq("lesson_id", lessonId)
    .order("position")
    .order("asset_id");
  const rows = ((siblings ?? []) as unknown as { asset_id: string; position: number; content_assets: { filename: string; title: string } | null }[]).map((r) => ({
    id: r.asset_id,
    position: r.position,
    name: r.content_assets?.title || r.content_assets?.filename || "",
  }));
  const order = moveItem(rows.map((r) => r.id), assetId, dir);
  if (!order) return { ok: true };
  for (const c of positionChanges(rows, order)) {
    const { error } = await supabase.from("lesson_assets").update({ position: c.position }).eq("lesson_id", lessonId).eq("asset_id", c.id);
    if (error) return fail(writeError(error));
  }
  revalidateCourse(offeringId);
  const name = rows.find((r) => r.id === assetId)?.name ?? "";
  return { ok: true, message: t("author.move.done", { title: name, position: order.indexOf(assetId) + 1, count: order.length }) };
}

export async function updateFileDetails(_prev: Result | null, formData: FormData): Promise<Result> {
  const offeringId = uuid(formData, "offeringId");
  const assetId = uuid(formData, "assetId");
  if (!assetId || !isUuid(assetId)) return fail(t("author.err.notFound"));
  const title = str(formData, "title", LIMITS.assetTitle + 1);
  const description = str(formData, "description", LIMITS.assetDescription + 1);
  const alt = str(formData, "alt", LIMITS.assetAlt + 1);
  if (title.length > LIMITS.assetTitle || description.length > LIMITS.assetDescription || alt.length > LIMITS.assetAlt) return fail(t("author.err.text"));
  const { supabase } = await session();
  const { error } = await supabase.rpc("update_asset_metadata", { p_asset: assetId, p_title: title, p_description: description, p_alt: alt });
  if (error) return fail(friendlyError(error, t("author.err.generic")));
  revalidateCourse(offeringId);
  return { ok: true, message: t("author.files.metaSaved") };
}
