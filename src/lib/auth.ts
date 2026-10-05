import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type StaffContext = {
  offering_id: string;
  role: "instructor" | "ta";
  can_author: boolean;
  can_grade: boolean;
  can_publish_grades: boolean;
};

export type UserContext = {
  id: string;
  email: string | null;
  displayName: string;
  timezone: string;
  locale: "en" | "vi";
  coursesView: "list" | "grid";
  isPlatformAdmin: boolean;
  coordinatorCohorts: string[];
  staff: StaffContext[];
  enrollments: { offering_id: string; status: string }[];
};

/**
 * Resolves the signed-in user for this request. Identity is verified with the
 * Auth server (getUser), and roles are read from current database records on every
 * request, so revoked roles or suspensions take effect without signing out.
 * These values drive UI only; authorization is enforced again by RLS and RPCs.
 */
export const getCurrentUser = cache(async (): Promise<UserContext | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const [{ data: profile }, { data: ctx }] = await Promise.all([
    supabase.from("profiles").select("display_name, timezone, locale, courses_view, suspended_at").eq("id", data.user.id).single(),
    supabase.rpc("my_context"),
  ]);
  if (!profile || profile.suspended_at) return null;
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    displayName: profile.display_name || data.user.email || "Participant",
    timezone: profile.timezone || "America/New_York",
    locale: profile.locale === "vi" ? "vi" : "en",
    coursesView: profile.courses_view === "grid" ? "grid" : "list",
    isPlatformAdmin: Boolean(ctx?.is_platform_admin),
    coordinatorCohorts: (ctx?.coordinator_cohorts as string[]) ?? [],
    staff: (ctx?.staff as StaffContext[]) ?? [],
    enrollments: (ctx?.enrollments as { offering_id: string; status: string }[]) ?? [],
  };
});

export async function requireUser(nextPath?: string): Promise<UserContext> {
  const user = await getCurrentUser();
  if (!user) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      // Signed in but suspended or missing a profile: end the session.
      await supabase.auth.signOut();
      redirect("/login?error=inactive");
    }
    redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  }
  return user;
}

export function staffFor(user: UserContext, offeringId: string) {
  return user.staff.find((s) => s.offering_id === offeringId) ?? null;
}

export function isAdminish(user: UserContext) {
  return user.isPlatformAdmin || user.coordinatorCohorts.length > 0;
}
