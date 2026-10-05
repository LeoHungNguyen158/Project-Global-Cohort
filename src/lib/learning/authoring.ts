import "server-only";
import { notFound } from "next/navigation";
import { requireOffering, type OfferingAccess } from "@/lib/data/offering-access";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/forms";
import { loadVersion, type VersionRow } from "./data";

// Gatekeeping for the authoring pages. Staff without author permission and learners get
// the same 404 as for an unknown page; the database enforces the same rules on every write.

export async function requireAuthor(offeringId: string): Promise<OfferingAccess> {
  const access = await requireOffering(offeringId);
  if (!access.canAuthor) notFound();
  return access;
}

/** A version of the offering's course, or 404. */
export async function requireCourseVersion(versionId: string, courseId: string): Promise<VersionRow> {
  const version = isUuid(versionId) ? await loadVersion(versionId) : null;
  if (!version || version.course_id !== courseId) notFound();
  return version;
}

export type CourseOfferingRef = { id: string; code: string; course_version_id: string; status: "draft" | "published" | "archived" };

/** Offerings of a course the user can see (RLS), for "used by" and shared-draft notes. */
export async function loadCourseOfferings(courseId: string): Promise<CourseOfferingRef[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("course_offerings").select("id, code, course_version_id, status").eq("course_id", courseId).order("code");
  return (data ?? []) as CourseOfferingRef[];
}

export type EditableLesson = {
  id: string;
  module_id: string;
  course_version_id: string;
  lineage_id: string;
  position: number;
  title: string;
  content_type: "text" | "pdf" | "video" | "file" | "link" | "embed";
  body_html: string;
  required: boolean;
  duration_minutes: number | null;
  completion_rule: "acknowledge" | "video_watched";
  external_url: string | null;
  embed_provider: "youtube" | "vimeo" | null;
  embed_id: string | null;
  transcript: string;
};

/** A lesson of the given version (authors read every version of their course), or 404. */
export async function requireVersionLesson(lessonId: string, versionId: string): Promise<EditableLesson> {
  if (!isUuid(lessonId)) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from("lessons")
    .select(
      "id, module_id, course_version_id, lineage_id, position, title, content_type, body_html, required, duration_minutes, completion_rule, external_url, embed_provider, embed_id, transcript",
    )
    .eq("id", lessonId)
    .eq("course_version_id", versionId)
    .maybeSingle();
  if (!data) notFound();
  return data as EditableLesson;
}
