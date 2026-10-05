import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { UserContext } from "@/lib/auth";
import type { ManagerContext, ScopeDirectory, ToolRow } from "./scopes";

export const TOOL_COLUMNS =
  "id, offering_id, cohort_id, category, title, description, body_html, url, published, position, created_at, updated_at, archived_at";

type OfferingRow = {
  id: string;
  code: string;
  cohort_id: string;
  course_versions: { title: string } | null;
  courses: { title: string } | null;
};

/**
 * Cohorts and offerings the signed-in person can see, read through RLS. Used for scope
 * labels, the scope filter and the list of scopes a staff member may author in.
 */
export const loadScopeDirectory = cache(async (): Promise<ScopeDirectory | null> => {
  const supabase = await createClient();
  const [cohorts, offerings] = await Promise.all([
    supabase.from("cohorts").select("id, name").limit(500),
    supabase.from("course_offerings").select("id, code, cohort_id, course_versions(title), courses(title)").limit(1000),
  ]);
  if (cohorts.error || offerings.error) return null;
  return {
    cohorts: (cohorts.data ?? []).map((c) => ({ id: c.id as string, name: c.name as string })),
    offerings: ((offerings.data ?? []) as unknown as OfferingRow[]).map((o) => ({
      id: o.id,
      code: o.code,
      title: o.course_versions?.title ?? o.courses?.title ?? o.code,
      cohortId: o.cohort_id,
    })),
  };
});

export function managerContext(user: UserContext): ManagerContext {
  return {
    isPlatformAdmin: user.isPlatformAdmin,
    coordinatorCohorts: user.coordinatorCohorts,
    staffOfferings: user.staff.map((s) => s.offering_id),
  };
}

/** One resource the signed-in person can see (RLS), or null. */
export async function loadTool(toolId: string): Promise<ToolRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("tool_resources").select(TOOL_COLUMNS).eq("id", toolId).maybeSingle();
  return (data as ToolRow | null) ?? null;
}
