import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { requireUser, staffFor, type StaffContext, type UserContext } from "@/lib/auth";
import { getOffering, offeringPhase, type OfferingSummary } from "@/lib/data/offerings";

export type OfferingAccess = {
  offering: OfferingSummary;
  user: UserContext;
  staff: StaffContext | null;
  /** Platform administrator or coordinator of this offering's cohort. */
  isOfferingAdmin: boolean;
  /** Staff or administrator: sees the teaching view. */
  isStaffView: boolean;
  canAuthor: boolean;
  canGrade: boolean;
  canPublishGrades: boolean;
  canCommunicate: boolean;
  /** Learner with an enrollment record visible to them (active or completed). */
  enrollmentStatus: string | null;
  /** Active enrollment in a published offering: may submit work and record progress. */
  isActiveLearner: boolean;
  /** Archived offering or completed enrollment: learners can read but not change anything. */
  readOnly: boolean;
  phase: "ongoing" | "upcoming" | "archived";
};

/**
 * Loads an offering for a course workspace page. Unknown, hidden or forbidden
 * offerings all return 404 so the existence of other offerings is not revealed.
 * The permission flags mirror the database helpers and only shape the UI; every
 * action is authorized again by RLS and the RPC functions.
 */
export const requireOffering = cache(async (offeringId: string): Promise<OfferingAccess> => {
  const user = await requireUser(`/courses/${offeringId}`);
  const offering = await getOffering(offeringId);
  if (!offering) notFound();
  const staff = staffFor(user, offering.id);
  const isOfferingAdmin = user.isPlatformAdmin || user.coordinatorCohorts.includes(offering.cohort_id);
  const isInstructor = staff?.role === "instructor";
  const full = isOfferingAdmin || isInstructor;
  const enrollment = user.enrollments.find((e) => e.offering_id === offering.id) ?? null;
  const isActiveLearner = !staff && enrollment?.status === "active" && offering.status === "published";
  return {
    offering,
    user,
    staff,
    isOfferingAdmin,
    isStaffView: Boolean(staff) || isOfferingAdmin,
    canAuthor: full || Boolean(staff?.can_author),
    canGrade: full || Boolean(staff?.can_grade),
    canPublishGrades: full || Boolean(staff?.can_publish_grades),
    canCommunicate: full || Boolean(staff),
    enrollmentStatus: enrollment?.status ?? null,
    isActiveLearner,
    readOnly: offering.status === "archived" || enrollment?.status === "completed",
    phase: offeringPhase(offering),
  };
});
