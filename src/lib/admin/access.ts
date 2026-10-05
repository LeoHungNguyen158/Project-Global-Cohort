import "server-only";
import { notFound } from "next/navigation";
import { getCurrentUser, isAdminish, requireUser, type UserContext } from "@/lib/auth";

export type AdminContext = {
  user: UserContext;
  isPlatformAdmin: boolean;
  /** Cohorts this person coordinates (empty for platform administrators who coordinate none). */
  cohortIds: string[];
};

function toContext(user: UserContext): AdminContext {
  return { user, isPlatformAdmin: user.isPlatformAdmin, cohortIds: user.coordinatorCohorts };
}

/**
 * Administration pages are for platform administrators and cohort coordinators.
 * Everyone else gets the same 404 as an unknown page. Roles come from current
 * database records on every request; the database re-checks every operation.
 */
export async function requireAdmin(path: string): Promise<AdminContext> {
  const user = await requireUser(path);
  if (!isAdminish(user)) notFound();
  return toContext(user);
}

/** Pages that only platform administrators may open (coordinators get 404 too). */
export async function requirePlatformAdmin(path: string): Promise<AdminContext> {
  const ctx = await requireAdmin(path);
  if (!ctx.isPlatformAdmin) notFound();
  return ctx;
}

/** For server actions and route handlers: null when the caller is not an administrator. */
export async function adminForRequest(): Promise<AdminContext | null> {
  const user = await getCurrentUser();
  if (!user || !isAdminish(user)) return null;
  return toContext(user);
}

export function canAdminCohort(ctx: AdminContext, cohortId: string | null | undefined): boolean {
  if (!cohortId) return false;
  return ctx.isPlatformAdmin || ctx.cohortIds.includes(cohortId);
}
