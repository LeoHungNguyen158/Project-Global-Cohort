import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/forms";
import { parseOutline, type Outline, type LessonContentType, type CompletionRule } from "./outline";
import type { AssetRole } from "./assets";
import type { EmbedProvider } from "./embed";
import { describeRule, type RuleRow } from "@/lib/domain/prerequisites";

// Server-side loaders for the learning area. Every query runs as the signed-in user,
// so RLS and the RPC permission checks decide what comes back.

/** Outline of the offering's adopted version with this user's locks and progress. */
export const loadOutline = cache(async (offeringId: string): Promise<{ outline: Outline; error: boolean }> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("offering_outline", { p_offering: offeringId });
  if (error) return { outline: { courseVersionId: null, isStaff: false, modules: [] }, error: true };
  return { outline: parseOutline(data), error: false };
});

export type CourseProgress = { requiredTotal: number; requiredCompleted: number; percent: number | null };

/** Required-item progress computed by the database (course_progress). */
export const loadProgress = cache(async (offeringId: string): Promise<CourseProgress | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("course_progress", { p_offering: offeringId });
  if (error || !data) return null;
  return {
    requiredTotal: Number(data.required_total ?? 0),
    requiredCompleted: Number(data.required_completed ?? 0),
    percent: data.percent === null || data.percent === undefined ? null : Number(data.percent),
  };
});

export type LessonContent = {
  id: string;
  module_id: string;
  course_version_id: string;
  lineage_id: string;
  position: number;
  title: string;
  content_type: LessonContentType;
  body_html: string;
  required: boolean;
  duration_minutes: number | null;
  completion_rule: CompletionRule;
  external_url: string | null;
  embed_provider: EmbedProvider | null;
  embed_id: string | null;
  transcript: string;
};

const LESSON_COLUMNS =
  "id, module_id, course_version_id, lineage_id, position, title, content_type, body_html, required, duration_minutes, completion_rule, external_url, embed_provider, embed_id, transcript";

/** A lesson's content, or null when RLS refuses it (locked, hidden, or another course). */
export async function loadLessonContent(lessonId: string): Promise<LessonContent | null> {
  if (!isUuid(lessonId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("lessons").select(LESSON_COLUMNS).eq("id", lessonId).maybeSingle();
  return (data as LessonContent | null) ?? null;
}

export type LessonAsset = {
  id: string;
  role: AssetRole;
  position: number;
  caption_language: string | null;
  filename: string;
  mime: string;
  size: number;
  status: string;
  title: string;
  description: string;
  alt_text: string;
  owner_id: string;
  owner_name: string | null;
  course_version_id: string | null;
};

type AssetRow = {
  asset_id: string;
  role: AssetRole;
  position: number;
  caption_language: string | null;
  content_assets: {
    id: string;
    filename: string;
    declared_mime: string;
    size_bytes: number;
    status: string;
    title: string;
    description: string;
    alt_text: string;
    owner_id: string;
    course_version_id: string | null;
    owner: { display_name: string } | null;
  } | null;
};

/** Files attached to a lesson that the user may read, in display order. */
export async function loadLessonAssets(lessonId: string): Promise<LessonAsset[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lesson_assets")
    .select(
      "asset_id, role, position, caption_language, content_assets(id, filename, declared_mime, size_bytes, status, title, description, alt_text, owner_id, course_version_id, owner:profiles!content_assets_owner_id_fkey(display_name))",
    )
    .eq("lesson_id", lessonId)
    .order("position")
    .order("asset_id");
  const rows = (data ?? []) as unknown as AssetRow[];
  return rows
    .filter((r) => r.content_assets)
    .map((r) => {
      const a = r.content_assets!;
      return {
        id: a.id,
        role: r.role,
        position: r.position,
        caption_language: r.caption_language,
        filename: a.filename,
        mime: a.declared_mime,
        size: Number(a.size_bytes),
        status: a.status,
        title: a.title,
        description: a.description,
        alt_text: a.alt_text,
        owner_id: a.owner_id,
        owner_name: a.owner?.display_name ?? null,
        course_version_id: a.course_version_id,
      };
    });
}

export type LessonProgressRow = {
  started_at: string;
  completed_at: string | null;
  last_position_seconds: number;
  max_position_seconds: number;
  duration_seconds: number | null;
};

/** The signed-in learner's own progress record for a lesson lineage. */
export async function loadMyLessonProgress(offeringId: string, lineageId: string, userId: string): Promise<LessonProgressRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lesson_progress")
    .select("started_at, completed_at, last_position_seconds, max_position_seconds, duration_seconds")
    .eq("offering_id", offeringId)
    .eq("user_id", userId)
    .eq("lesson_lineage", lineageId)
    .maybeSingle();
  return (data as LessonProgressRow | null) ?? null;
}

export type VersionRow = {
  id: string;
  course_id: string;
  version_no: number;
  status: "draft" | "published" | "archived";
  title: string;
  summary: string;
  objectives: string[];
  audience: string;
  expected_effort: string;
  prerequisites_text: string;
  syllabus_html: string;
  grading_policy: string;
  created_at: string;
  published_at: string | null;
  based_on_version_id: string | null;
};

const VERSION_COLUMNS =
  "id, course_id, version_no, status, title, summary, objectives, audience, expected_effort, prerequisites_text, syllabus_html, grading_policy, created_at, published_at, based_on_version_id";

export async function loadCourseVersions(courseId: string): Promise<VersionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("course_versions").select(VERSION_COLUMNS).eq("course_id", courseId).order("version_no", { ascending: false });
  return (data ?? []) as VersionRow[];
}

export async function loadVersion(versionId: string): Promise<VersionRow | null> {
  if (!isUuid(versionId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("course_versions").select(VERSION_COLUMNS).eq("id", versionId).maybeSingle();
  return (data as VersionRow | null) ?? null;
}

export type StructureLesson = {
  id: string;
  module_id: string;
  lineage_id: string;
  position: number;
  title: string;
  content_type: LessonContentType;
  required: boolean;
  duration_minutes: number | null;
  completion_rule: CompletionRule;
  file_count: number;
};

export type StructureModule = {
  id: string;
  lineage_id: string;
  position: number;
  title: string;
  description: string;
  lessons: StructureLesson[];
};

/** Modules and lessons of any version the user may read (authors read every version of their course). */
export async function loadVersionStructure(versionId: string): Promise<StructureModule[]> {
  const supabase = await createClient();
  const [mods, lessons] = await Promise.all([
    supabase.from("modules").select("id, lineage_id, position, title, description").eq("course_version_id", versionId).order("position").order("created_at"),
    supabase
      .from("lessons")
      .select("id, module_id, lineage_id, position, title, content_type, required, duration_minutes, completion_rule, lesson_assets(count)")
      .eq("course_version_id", versionId)
      .order("position")
      .order("created_at"),
  ]);
  const byModule = new Map<string, StructureLesson[]>();
  for (const l of (lessons.data ?? []) as unknown as (Omit<StructureLesson, "file_count"> & { lesson_assets: { count: number }[] })[]) {
    const entry: StructureLesson = { ...l, file_count: l.lesson_assets?.[0]?.count ?? 0 };
    byModule.set(l.module_id, [...(byModule.get(l.module_id) ?? []), entry]);
  }
  return ((mods.data ?? []) as Omit<StructureModule, "lessons">[]).map((m) => ({ ...m, lessons: byModule.get(m.id) ?? [] }));
}

export type StaffMember = { user_id: string; role: "instructor" | "ta"; display_name: string; avatar_asset_id: string | null };

/** Staff of an offering with their avatars (profiles visible through shared scope). */
export async function loadStaffWithAvatars(offeringId: string): Promise<StaffMember[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("staff_assignments")
    .select("user_id, role, profiles!staff_assignments_user_id_fkey(display_name, avatar_asset_id)")
    .eq("offering_id", offeringId);
  const rows = (data ?? []) as unknown as { user_id: string; role: "instructor" | "ta"; profiles: { display_name: string; avatar_asset_id: string | null } | null }[];
  return rows
    .map((r) => ({ user_id: r.user_id, role: r.role, display_name: r.profiles?.display_name ?? "", avatar_asset_id: r.profiles?.avatar_asset_id ?? null }))
    .sort((a, b) => (a.role === b.role ? a.display_name.localeCompare(b.display_name, ["vi", "en"]) : a.role === "instructor" ? -1 : 1));
}

export function assetUrl(assetId: string, download = false): string {
  return `/api/assets/${assetId}${download ? "?download=1" : ""}`;
}

export type RuleRecord = RuleRow & { created_at: string; created_by: string | null };

/** Prerequisite and release rules configured for an offering (oldest first). */
export const loadRules = cache(async (offeringId: string): Promise<RuleRecord[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("prerequisite_rules")
    .select("id, target_lesson_lineage, kind, required_lesson_lineage, quiz_id, min_score_pct, release_at, created_at, created_by")
    .eq("offering_id", offeringId)
    .order("created_at");
  return (data ?? []) as RuleRecord[];
});

export type QuizOption = { id: string; title: string; status: "draft" | "published" | "archived" };

/** Quizzes of an offering the user may see (staff see drafts too). */
export const loadQuizzes = cache(async (offeringId: string): Promise<QuizOption[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("quizzes").select("id, title, status").eq("offering_id", offeringId).order("title");
  return (data ?? []) as QuizOption[];
});

/** Staff-facing condition summaries per target lesson lineage. */
export function describeConditions(
  rules: RuleRow[],
  ctx: { tz: string; courseTz: string; lessonTitles: Map<string, string>; quizTitles: Map<string, string> },
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const rule of rules) {
    const text = describeRule(rule, {
      tz: ctx.tz,
      courseTz: ctx.courseTz,
      lessonTitle: (lineage) => ctx.lessonTitles.get(lineage) ?? null,
      quizTitle: (id) => ctx.quizTitles.get(id) ?? null,
    });
    out.set(rule.target_lesson_lineage, [...(out.get(rule.target_lesson_lineage) ?? []), text]);
  }
  return out;
}
