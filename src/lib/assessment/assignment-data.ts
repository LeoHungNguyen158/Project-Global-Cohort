import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/forms";
import type { LatePolicy, SubmissionStatus, SubmissionTypeKey } from "./assignment-status";

// Row types for the assignment pages. Reads run as the signed-in user: RLS decides
// which assignments, submissions, versions and files come back.

export type AssignmentRow = {
  id: string;
  offering_id: string;
  title: string;
  instructions_html: string;
  submission_types: SubmissionTypeKey[];
  points: number;
  rubric: unknown;
  available_from: string | null;
  due_at: string | null;
  closes_at: string | null;
  late_policy: LatePolicy;
  max_submissions: number;
  status: "draft" | "published" | "archived";
  created_at: string;
};

export const ASSIGNMENT_COLUMNS =
  "id, offering_id, title, instructions_html, submission_types, points, rubric, available_from, due_at, closes_at, late_policy, max_submissions, status, created_at";

export const getAssignment = cache(async (offeringId: string, assignmentId: string): Promise<AssignmentRow | null> => {
  if (!isUuid(assignmentId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("assignments").select(ASSIGNMENT_COLUMNS).eq("id", assignmentId).eq("offering_id", offeringId).maybeSingle();
  return (data as AssignmentRow | null) ?? null;
});

export type SubmissionRow = {
  id: string;
  assignment_id: string;
  user_id: string;
  status: SubmissionStatus;
  draft_text: string;
  draft_url: string | null;
  draft_asset_ids: string[];
  draft_saved_at: string | null;
  submitted_count: number;
  return_note: string;
  updated_at: string;
};

export const SUBMISSION_COLUMNS = "id, assignment_id, user_id, status, draft_text, draft_url, draft_asset_ids, draft_saved_at, submitted_count, return_note, updated_at";

export type VersionRow = {
  id: string;
  submission_id: string;
  version_no: number;
  body_text: string;
  url: string | null;
  asset_ids: string[];
  submitted_at: string;
  is_late: boolean;
  receipt_code: string;
};

export const VERSION_COLUMNS = "id, submission_id, version_no, body_text, url, asset_ids, submitted_at, is_late, receipt_code";

export type AssetInfo = { id: string; filename: string; size_bytes: number; status: string; declared_mime: string };

/** File names and sizes for asset ids the viewer may read (others are simply absent). */
export async function assetInfo(ids: string[]): Promise<Map<string, AssetInfo>> {
  const unique = Array.from(new Set(ids.filter(isUuid)));
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("content_assets").select("id, filename, size_bytes, status, declared_mime").in("id", unique);
  return new Map(((data ?? []) as AssetInfo[]).map((a) => [a.id, a]));
}

export type ReleasedGradeRow = {
  grade_item_id: string;
  status: "graded" | "missing" | "exempt";
  points: number | null;
  max_points: number;
  feedback: string;
  rubric_scores: unknown;
  released_at: string;
};

export type QueueEntry = {
  userId: string;
  name: string | null;
  enrollmentStatus: string | null;
  submission: { id: string; status: SubmissionStatus; submitted_count: number } | null;
  latest: { version_no: number; submitted_at: string; is_late: boolean } | null;
  grade: { id: string; status: string; points: number | null; dirty: boolean } | null;
  released: boolean;
};

const QUEUE_RANK: Record<string, number> = { submitted: 0, returned: 1, graded: 2 };

/**
 * One row per learner for the staff grading queue: active and completed enrollments plus
 * anyone else with submitted work. Read as the signed-in staff member, so learners' drafts
 * (hidden from staff by RLS) count as not submitted. To-grade rows come first, oldest first.
 */
export async function loadGradingQueue(offeringId: string, assignmentId: string): Promise<QueueEntry[]> {
  const supabase = await createClient();
  const [enrRes, subRes, itemRes] = await Promise.all([
    supabase.from("enrollments").select("user_id, status, profiles!enrollments_user_id_fkey(display_name)").eq("offering_id", offeringId),
    supabase.from("submissions").select("id, user_id, status, submitted_count").eq("assignment_id", assignmentId),
    supabase.from("grade_items").select("id").eq("assignment_id", assignmentId).maybeSingle(),
  ]);
  const enrollments = (enrRes.data ?? []) as unknown as { user_id: string; status: string; profiles: { display_name: string } | null }[];
  const submissions = (subRes.data ?? []) as { id: string; user_id: string; status: SubmissionStatus; submitted_count: number }[];
  const itemId = (itemRes.data as { id: string } | null)?.id ?? null;
  const subIds = submissions.map((s) => s.id);
  const [verRes, gradeRes, relRes] = await Promise.all([
    subIds.length ? supabase.from("submission_versions").select("submission_id, version_no, submitted_at, is_late").in("submission_id", subIds) : Promise.resolve({ data: [] }),
    itemId ? supabase.from("grades").select("id, user_id, status, points, dirty").eq("grade_item_id", itemId) : Promise.resolve({ data: [] }),
    itemId ? supabase.from("released_grades").select("grade_id, user_id").eq("grade_item_id", itemId) : Promise.resolve({ data: [] }),
  ]);
  const latest = new Map<string, { version_no: number; submitted_at: string; is_late: boolean }>();
  for (const v of (verRes.data ?? []) as { submission_id: string; version_no: number; submitted_at: string; is_late: boolean }[]) {
    const cur = latest.get(v.submission_id);
    if (!cur || v.version_no > cur.version_no) latest.set(v.submission_id, { version_no: v.version_no, submitted_at: v.submitted_at, is_late: v.is_late });
  }
  const grades = new Map(((gradeRes.data ?? []) as { id: string; user_id: string; status: string; points: number | null; dirty: boolean }[]).map((g) => [g.user_id, g]));
  const released = new Set(((relRes.data ?? []) as { user_id: string }[]).map((r) => r.user_id));
  const subByUser = new Map(submissions.map((s) => [s.user_id, s]));
  const enrByUser = new Map(enrollments.map((e) => [e.user_id, e]));

  const userIds = new Set<string>();
  for (const e of enrollments) if (e.status === "active" || e.status === "completed") userIds.add(e.user_id);
  for (const s of submissions) userIds.add(s.user_id);
  const missingNames = [...userIds].filter((id) => !enrByUser.get(id)?.profiles);
  const extraNames = new Map<string, string>();
  if (missingNames.length) {
    const { data } = await supabase.from("profiles").select("id, display_name").in("id", missingNames);
    for (const p of (data ?? []) as { id: string; display_name: string }[]) extraNames.set(p.id, p.display_name);
  }

  const rows: QueueEntry[] = [...userIds].map((userId) => {
    const sub = subByUser.get(userId) ?? null;
    const g = grades.get(userId) ?? null;
    return {
      userId,
      name: enrByUser.get(userId)?.profiles?.display_name ?? extraNames.get(userId) ?? null,
      enrollmentStatus: enrByUser.get(userId)?.status ?? null,
      submission: sub,
      latest: sub ? (latest.get(sub.id) ?? null) : null,
      grade: g ? { id: g.id, status: g.status, points: g.points === null ? null : Number(g.points), dirty: g.dirty } : null,
      released: released.has(userId),
    };
  });
  return rows.sort((a, b) => {
    const ra = a.submission ? (QUEUE_RANK[a.submission.status] ?? 3) : 3;
    const rb = b.submission ? (QUEUE_RANK[b.submission.status] ?? 3) : 3;
    if (ra !== rb) return ra - rb;
    if (ra === 0 && a.latest && b.latest) return new Date(a.latest.submitted_at).getTime() - new Date(b.latest.submitted_at).getTime();
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}
