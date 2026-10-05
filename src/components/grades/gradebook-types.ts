import type { StaffCell } from "@/lib/domain/grades";

// Props passed from the gradebook server component to the client grid. Only staff of the
// offering ever receive these (the page renders the learner view for everyone else), and
// they carry display names and grades only: no email addresses or account details.

export type GridItem = {
  id: string;
  title: string;
  kind: "assignment" | "quiz" | "participation" | "manual";
  /** Display form, e.g. "100" or "7.5". */
  maxPoints: string;
  counts: boolean;
  visible: boolean;
  /** Manual or participation item the viewer may edit. */
  editable: boolean;
  hasGrades: boolean;
  /** Assignment grading page or quiz page for this item. */
  workHref: string | null;
};

export type GridCell = {
  itemId: string;
  gradeId: string | null;
  entry: StaffCell["entry"];
  publication: StaffCell["publication"];
  needsGrading: boolean;
  publishable: boolean;
  /** Points for graded entries, display form. */
  points: string | null;
  feedback: string;
  /** Formatted in the viewer's time zone; null when never published. */
  publishedAt: string | null;
  /** Matches the current status filter (always true for "all"). */
  match: boolean;
};

export type GridTotal = { percent: string | null; earned: string; possible: string };

export type GridRow = {
  userId: string;
  name: string;
  enrollmentStatus: string;
  cells: GridCell[];
  released: GridTotal;
  working: GridTotal;
};

export type GridPermissions = {
  canGrade: boolean;
  canPublish: boolean;
  canAuthor: boolean;
  readOnly: boolean;
};
