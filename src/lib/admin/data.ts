import "server-only";
import { createClient } from "@/lib/supabase/server";
import { canAdminCohort, type AdminContext } from "./access";

export type AdminCohort = {
  id: string;
  code: string;
  name: string;
  description: string;
  status: "upcoming" | "active" | "archived";
  timezone: string;
  starts_on: string | null;
  ends_on: string | null;
  is_sample: boolean;
  created_at: string;
};

export type AdminOffering = {
  id: string;
  code: string;
  term_label: string;
  status: "draft" | "published" | "archived";
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  accent_color: string;
  cohort_id: string;
  course_id: string;
  course_version_id: string;
  catalog_visible: boolean;
  catalog_state: "open_for_requests" | "not_open";
  is_sample: boolean;
  courses: { code: string; title: string } | null;
  cohorts: { code: string; name: string; status: string } | null;
  course_versions: { version_no: number; status: string; title: string } | null;
};

const COHORT_COLUMNS = "id, code, name, description, status, timezone, starts_on, ends_on, is_sample, created_at";
const OFFERING_COLUMNS =
  "id, code, term_label, status, starts_at, ends_at, timezone, accent_color, cohort_id, course_id, course_version_id, catalog_visible, catalog_state, is_sample, courses(code, title), cohorts(code, name, status), course_versions(version_no, status, title)";

/**
 * Cohorts this administrator may manage. RLS also returns cohorts the person merely
 * belongs to (for example as a learner), so the list is narrowed to administered ones.
 */
export async function listAdminCohorts(ctx: AdminContext): Promise<AdminCohort[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("cohorts").select(COHORT_COLUMNS);
  if (error) throw new Error("Could not load cohorts");
  return ((data ?? []) as AdminCohort[]).filter((c) => canAdminCohort(ctx, c.id)).sort((a, b) => a.code.localeCompare(b.code));
}

export async function listAdminOfferings(ctx: AdminContext): Promise<AdminOffering[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("course_offerings").select(OFFERING_COLUMNS);
  if (error) throw new Error("Could not load offerings");
  return ((data ?? []) as unknown as AdminOffering[])
    .filter((o) => canAdminCohort(ctx, o.cohort_id))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export async function getAdminCohort(ctx: AdminContext, cohortId: string): Promise<AdminCohort | null> {
  if (!/^[0-9a-f-]{36}$/i.test(cohortId) || !canAdminCohort(ctx, cohortId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("cohorts").select(COHORT_COLUMNS).eq("id", cohortId).maybeSingle();
  return (data as AdminCohort | null) ?? null;
}

export async function getAdminOffering(ctx: AdminContext, offeringId: string): Promise<AdminOffering | null> {
  if (!/^[0-9a-f-]{36}$/i.test(offeringId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("course_offerings").select(OFFERING_COLUMNS).eq("id", offeringId).maybeSingle();
  const offering = (data as unknown as AdminOffering | null) ?? null;
  if (!offering || !canAdminCohort(ctx, offering.cohort_id)) return null;
  return offering;
}

export function offeringLabel(o: Pick<AdminOffering, "code" | "course_versions" | "courses">): string {
  const title = o.course_versions?.title ?? o.courses?.title;
  return title ? `${o.code} — ${title}` : o.code;
}

export type AdminCommunity = {
  id: string;
  cohort_id: string | null;
  name: string;
  description: string;
  join_policy: "open" | "invite";
  is_sample: boolean;
  created_at: string;
  cohorts: { code: string; name: string; status: string } | null;
};

const COMMUNITY_COLUMNS = "id, cohort_id, name, description, join_policy, is_sample, created_at, cohorts(code, name, status)";

/** Same rule as the communities_write policy: program-wide ones need a platform administrator. */
export function canManageCommunity(ctx: AdminContext, community: { cohort_id: string | null }): boolean {
  return community.cohort_id === null ? ctx.isPlatformAdmin : canAdminCohort(ctx, community.cohort_id);
}

/**
 * Communities this administrator may manage. RLS also returns communities the person can
 * merely see (program-wide ones, their own cohort's), so the list is narrowed to managed ones.
 */
export async function listAdminCommunities(ctx: AdminContext): Promise<AdminCommunity[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("communities").select(COMMUNITY_COLUMNS);
  if (error) throw new Error("Could not load communities");
  return ((data ?? []) as unknown as AdminCommunity[]).filter((c) => canManageCommunity(ctx, c)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAdminCommunity(ctx: AdminContext, communityId: string): Promise<AdminCommunity | null> {
  if (!/^[0-9a-f-]{36}$/i.test(communityId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("communities").select(COMMUNITY_COLUMNS).eq("id", communityId).maybeSingle();
  const community = (data as unknown as AdminCommunity | null) ?? null;
  if (!community || !canManageCommunity(ctx, community)) return null;
  return community;
}

/** Pagination helper for list pages (1-based page numbers). */
export function pageWindow(pageParam: string | undefined, perPage: number) {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(pageParam ?? "1", 10) || 1));
  return { page, offset: (page - 1) * perPage, limit: perPage };
}
