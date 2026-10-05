import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type OfferingSummary = {
  id: string;
  code: string;
  term_label: string;
  status: "draft" | "published" | "archived";
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  accent_color: string;
  course_id: string;
  course_version_id: string;
  cohort_id: string;
  catalog_visible: boolean;
  catalog_state: string;
  is_sample: boolean;
  courses: { code: string; title: string } | null;
  cohorts: { id: string; code: string; name: string; status: string } | null;
  course_versions: {
    id: string;
    version_no: number;
    status: string;
    title: string;
    summary: string;
    objectives: string[];
    audience: string;
    expected_effort: string;
    prerequisites_text: string;
    syllabus_html: string;
    grading_policy: string;
  } | null;
};

const SELECT =
  "id, code, term_label, status, starts_at, ends_at, timezone, accent_color, course_id, course_version_id, cohort_id, catalog_visible, catalog_state, is_sample, courses(code, title), cohorts(id, code, name, status), course_versions(id, version_no, status, title, summary, objectives, audience, expected_effort, prerequisites_text, syllabus_html, grading_policy)";

/** Loads an offering the current user may view (RLS returns nothing otherwise). */
export const getOffering = cache(async (offeringId: string): Promise<OfferingSummary | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(offeringId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("course_offerings").select(SELECT).eq("id", offeringId).maybeSingle();
  return (data as unknown as OfferingSummary) ?? null;
});

export async function listMyOfferings(): Promise<OfferingSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("course_offerings").select(SELECT).order("starts_at", { ascending: false, nullsFirst: false });
  return (data as unknown as OfferingSummary[]) ?? [];
}

export type StaffRow = { user_id: string; role: "instructor" | "ta"; profiles: { display_name: string } | null };

export async function listStaff(offeringIds: string[]): Promise<Record<string, StaffRow[]>> {
  if (offeringIds.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("staff_assignments")
    .select("offering_id, user_id, role, profiles!staff_assignments_user_id_fkey(display_name)")
    .in("offering_id", offeringIds);
  const out: Record<string, StaffRow[]> = {};
  for (const row of (data ?? []) as unknown as (StaffRow & { offering_id: string })[]) {
    (out[row.offering_id] ??= []).push(row);
  }
  return out;
}

export function offeringPhase(o: Pick<OfferingSummary, "status" | "starts_at" | "ends_at">, now = new Date()): "ongoing" | "upcoming" | "archived" {
  if (o.status === "archived") return "archived";
  if (o.ends_at && new Date(o.ends_at) < now) return "archived";
  if (o.starts_at && new Date(o.starts_at) > now) return "upcoming";
  return "ongoing";
}

export function offeringTitle(o: OfferingSummary): string {
  return o.course_versions?.title ?? o.courses?.title ?? o.code;
}
