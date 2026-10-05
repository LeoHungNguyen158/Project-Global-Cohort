import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compareNames,
  courseTotal,
  exclusionReason,
  learnerItemState,
  staffCell,
  type CourseTotal,
  type GradeStatus,
  type LearnerItemState,
  type LearnerWork,
  type StaffCell,
  type TotalExclusion,
  type TotalInput,
  type WorkingGrade,
} from "@/lib/domain/grades";

// Data loading for the grade pages. Every query runs as the signed-in user, so RLS decides
// what exists: learners read only their own released grades; staff read their offerings.

type Db = SupabaseClient;

export type GradeItemKind = "assignment" | "quiz" | "participation" | "manual";

export type GradeItemRow = {
  id: string;
  offering_id: string;
  kind: GradeItemKind;
  assignment_id: string | null;
  quiz_id: string | null;
  title: string;
  max_points: number | string;
  counts_toward_total: boolean;
  position: number;
  visible_to_learners: boolean;
  created_at: string;
};

const ITEM_COLUMNS = "id, offering_id, kind, assignment_id, quiz_id, title, max_points, counts_toward_total, position, visible_to_learners, created_at";

function sortItems(items: GradeItemRow[]): GradeItemRow[] {
  return [...items].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export type RubricCriterion = { id: string; criterion: string; points: number | string | null; description: string };

export function parseRubric(raw: unknown): RubricCriterion[] {
  if (!Array.isArray(raw)) return [];
  const out: RubricCriterion[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : null;
    if (!id) continue;
    const label = [r.criterion, r.label, r.title].find((v) => typeof v === "string" && v.trim() !== "") as string | undefined;
    const pts = typeof r.points === "number" || typeof r.points === "string" ? r.points : null;
    out.push({ id, criterion: label ?? id, points: pts, description: typeof r.description === "string" ? r.description : "" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Learner view
// ---------------------------------------------------------------------------

export type ReleasedRow = {
  grade_id: string;
  grade_item_id: string;
  offering_id: string;
  status: GradeStatus;
  points: number | string | null;
  max_points: number | string;
  feedback: string;
  rubric_scores: Record<string, number | string> | null;
  released_at: string;
};

export type LearnerGradeRow = {
  item: GradeItemRow;
  released: ReleasedRow | null;
  state: LearnerItemState;
  newerWorkPending: boolean;
  /** Assignment due date, or the quiz's effective closing time for this learner. */
  dueAt: string | null;
  dueKind: "due" | "closes" | null;
  extended: boolean;
  rubric: RubricCriterion[];
  href: string | null;
  /** null when the item is in the running total. */
  exclusion: TotalExclusion | null;
  maxPoints: number | string;
};

export type LearnerOfferingGrades = { offeringId: string; rows: LearnerGradeRow[]; total: CourseTotal; releasedCount: number };

/**
 * The learner's own grade items for one or more offerings (one round of queries for all).
 * Items whose assignment or quiz the learner cannot open yet (draft, not yet available) are
 * left out unless a grade was released for them.
 */
export async function loadLearnerGrades(db: Db, userId: string, offeringIds: string[]): Promise<Map<string, LearnerOfferingGrades>> {
  const result = new Map<string, LearnerOfferingGrades>();
  if (offeringIds.length === 0) return result;
  const [itemsRes, releasedRes, asgRes, quizRes, subRes, attemptRes, accRes] = await Promise.all([
    db.from("grade_items").select(ITEM_COLUMNS).in("offering_id", offeringIds),
    db
      .from("released_grades")
      .select("grade_id, grade_item_id, offering_id, status, points, max_points, feedback, rubric_scores, released_at")
      .eq("user_id", userId)
      .in("offering_id", offeringIds),
    db.from("assignments").select("id, offering_id, status, due_at, closes_at, rubric").in("offering_id", offeringIds),
    db.from("quizzes").select("id, offering_id, status, available_from, closes_at").in("offering_id", offeringIds),
    db.from("submissions").select("assignment_id, status").eq("user_id", userId).in("offering_id", offeringIds),
    db.from("quiz_attempts").select("quiz_id, status").eq("user_id", userId).in("offering_id", offeringIds),
    db.from("quiz_accommodations").select("quiz_id, extended_closes_at").eq("user_id", userId),
  ]);
  for (const r of [itemsRes, releasedRes, asgRes, quizRes, subRes, attemptRes, accRes]) {
    if (r.error) throw new Error(`grades: ${r.error.message}`);
  }
  const released = new Map<string, ReleasedRow>();
  for (const r of (releasedRes.data ?? []) as ReleasedRow[]) released.set(r.grade_item_id, r);
  const assignments = new Map(
    ((asgRes.data ?? []) as { id: string; status: string; due_at: string | null; closes_at: string | null; rubric: unknown }[]).map((a) => [a.id, a]),
  );
  const quizzes = new Map(((quizRes.data ?? []) as { id: string; status: string; closes_at: string | null }[]).map((q) => [q.id, q]));
  const submissions = new Map(((subRes.data ?? []) as { assignment_id: string; status: string }[]).map((s) => [s.assignment_id, s.status]));
  const attempts = new Map<string, string[]>();
  for (const a of (attemptRes.data ?? []) as { quiz_id: string; status: string }[]) {
    const list = attempts.get(a.quiz_id);
    if (list) list.push(a.status);
    else attempts.set(a.quiz_id, [a.status]);
  }
  const extensions = new Map(
    ((accRes.data ?? []) as { quiz_id: string; extended_closes_at: string | null }[]).filter((a) => a.extended_closes_at).map((a) => [a.quiz_id, a.extended_closes_at as string]),
  );

  const byOffering = new Map<string, LearnerGradeRow[]>();
  for (const item of sortItems((itemsRes.data ?? []) as GradeItemRow[])) {
    const rel = released.get(item.id) ?? null;
    let work: LearnerWork = { kind: "other" };
    let dueAt: string | null = null;
    let dueKind: LearnerGradeRow["dueKind"] = null;
    let extended = false;
    let rubric: RubricCriterion[] = [];
    let href: string | null = null;
    if (item.kind === "assignment" && item.assignment_id) {
      const a = assignments.get(item.assignment_id);
      if (!a && !rel) continue;
      work = { kind: "assignment", submissionStatus: (submissions.get(item.assignment_id) as never) ?? null };
      if (a) {
        dueAt = a.due_at;
        dueKind = a.due_at ? "due" : null;
        rubric = parseRubric(a.rubric);
        href = `/courses/${item.offering_id}/assignments/${a.id}`;
      }
    } else if (item.kind === "quiz" && item.quiz_id) {
      const q = quizzes.get(item.quiz_id);
      if (!q && !rel) continue;
      work = { kind: "quiz", attemptStatuses: attempts.get(item.quiz_id) ?? [] };
      if (q) {
        const ext = extensions.get(q.id) ?? null;
        dueAt = ext ?? q.closes_at;
        dueKind = dueAt ? "closes" : null;
        extended = Boolean(ext && ext !== q.closes_at);
        href = `/courses/${item.offering_id}/quizzes/${q.id}`;
      }
    }
    const { state, newerWorkPending } = learnerItemState(rel ? { status: rel.status, points: rel.points } : null, work);
    const maxPoints = rel ? rel.max_points : item.max_points;
    const totalInput: TotalInput = {
      id: item.id,
      maxPoints,
      countsTowardTotal: item.counts_toward_total,
      visibleToLearners: item.visible_to_learners,
      grade: rel ? { status: rel.status, points: rel.points } : null,
    };
    const row: LearnerGradeRow = {
      item,
      released: rel,
      state,
      newerWorkPending,
      dueAt,
      dueKind,
      extended,
      rubric,
      href,
      exclusion: exclusionReason(totalInput),
      maxPoints,
    };
    const list = byOffering.get(item.offering_id);
    if (list) list.push(row);
    else byOffering.set(item.offering_id, [row]);
  }
  for (const id of offeringIds) {
    const rows = byOffering.get(id) ?? [];
    const total = courseTotal(
      rows.map((r) => ({
        id: r.item.id,
        maxPoints: r.maxPoints,
        countsTowardTotal: r.item.counts_toward_total,
        visibleToLearners: r.item.visible_to_learners,
        grade: r.released ? { status: r.released.status, points: r.released.points } : null,
      })),
    );
    result.set(id, { offeringId: id, rows, total, releasedCount: rows.filter((r) => r.released).length });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Staff gradebook
// ---------------------------------------------------------------------------

export type StaffSummary = { submissions_to_grade: number; attempts_to_grade: number; grades_to_publish: number; learners: number };

export async function loadStaffSummary(db: Db, offeringId: string): Promise<StaffSummary | null> {
  const { data, error } = await db.rpc("staff_offering_summary", { p_offering: offeringId });
  if (error || !data) return null;
  return {
    submissions_to_grade: Number(data.submissions_to_grade ?? 0),
    attempts_to_grade: Number(data.attempts_to_grade ?? 0),
    grades_to_publish: Number(data.grades_to_publish ?? 0),
    learners: Number(data.learners ?? 0),
  };
}

export type GradebookLearner = { userId: string; name: string; enrollmentStatus: string };

export type GradebookCell = {
  itemId: string;
  userId: string;
  grade: (WorkingGrade & { feedback: string; updated_at: string }) | null;
  releasedAt: string | null;
  cell: StaffCell;
};

export type QueueEntry = {
  key: string;
  kind: "submission" | "attempt";
  userId: string;
  learner: string;
  itemTitle: string;
  submittedAt: string | null;
  attemptNo: number | null;
  href: string;
};

export type GradebookData = {
  items: GradeItemRow[];
  learners: GradebookLearner[];
  /** Keyed by `${userId}:${itemId}`. */
  cells: Map<string, GradebookCell>;
  queue: QueueEntry[];
  summary: StaffSummary | null;
};

export const cellKey = (userId: string, itemId: string) => `${userId}:${itemId}`;

export async function loadGradebook(db: Db, offeringId: string): Promise<GradebookData> {
  // The summary RPC also finalizes expired quiz attempts, so it runs before reading grades.
  const summary = await loadStaffSummary(db, offeringId);
  const [itemsRes, enrollRes, gradesRes, releasedRes, subRes, attemptRes, asgRes, quizRes] = await Promise.all([
    db.from("grade_items").select(ITEM_COLUMNS).eq("offering_id", offeringId),
    db.from("enrollments").select("user_id, status, profiles!enrollments_user_id_fkey(display_name)").eq("offering_id", offeringId),
    db.from("grades").select("id, grade_item_id, user_id, status, points, feedback, dirty, updated_at").eq("offering_id", offeringId),
    db.from("released_grades").select("grade_id, released_at").eq("offering_id", offeringId),
    db.from("submissions").select("id, assignment_id, user_id, status, updated_at").eq("offering_id", offeringId).eq("status", "submitted"),
    db.from("quiz_attempts").select("id, quiz_id, user_id, attempt_no, submitted_at").eq("offering_id", offeringId).eq("status", "submitted"),
    db.from("assignments").select("id, title").eq("offering_id", offeringId),
    db.from("quizzes").select("id, title").eq("offering_id", offeringId),
  ]);
  for (const r of [itemsRes, enrollRes, gradesRes, releasedRes]) {
    if (r.error) throw new Error(`gradebook: ${r.error.message}`);
  }
  const items = sortItems((itemsRes.data ?? []) as GradeItemRow[]);
  const learners: GradebookLearner[] = ((enrollRes.data ?? []) as unknown as { user_id: string; status: string; profiles: { display_name: string } | null }[])
    .map((e) => ({ userId: e.user_id, name: e.profiles?.display_name || "Participant", enrollmentStatus: e.status }))
    .sort((a, b) => compareNames(a.name, b.name));
  const releasedAt = new Map(((releasedRes.data ?? []) as { grade_id: string; released_at: string }[]).map((r) => [r.grade_id, r.released_at]));
  const gradeByCell = new Map<string, GradebookCell["grade"]>();
  for (const g of (gradesRes.data ?? []) as {
    id: string;
    grade_item_id: string;
    user_id: string;
    status: GradeStatus | "pending";
    points: number | string | null;
    feedback: string;
    dirty: boolean;
    updated_at: string;
  }[]) {
    gradeByCell.set(cellKey(g.user_id, g.grade_item_id), { id: g.id, status: g.status, points: g.points, dirty: g.dirty, feedback: g.feedback, updated_at: g.updated_at });
  }
  const itemByAssignment = new Map(items.filter((i) => i.assignment_id).map((i) => [i.assignment_id as string, i]));
  const itemByQuiz = new Map(items.filter((i) => i.quiz_id).map((i) => [i.quiz_id as string, i]));
  const awaiting = new Set<string>();
  const nameOf = new Map(learners.map((l) => [l.userId, l.name]));
  const asgTitle = new Map(((asgRes.data ?? []) as { id: string; title: string }[]).map((a) => [a.id, a.title]));
  const quizTitle = new Map(((quizRes.data ?? []) as { id: string; title: string }[]).map((q) => [q.id, q.title]));
  const queue: QueueEntry[] = [];
  for (const s of (subRes.data ?? []) as { id: string; assignment_id: string; user_id: string; updated_at: string }[]) {
    const item = itemByAssignment.get(s.assignment_id);
    if (item) awaiting.add(cellKey(s.user_id, item.id));
    queue.push({
      key: `s:${s.id}`,
      kind: "submission",
      userId: s.user_id,
      learner: nameOf.get(s.user_id) ?? "Participant",
      itemTitle: asgTitle.get(s.assignment_id) ?? item?.title ?? "",
      submittedAt: s.updated_at,
      attemptNo: null,
      href: `/courses/${offeringId}/assignments/${s.assignment_id}/grade`,
    });
  }
  for (const a of (attemptRes.data ?? []) as { id: string; quiz_id: string; user_id: string; attempt_no: number; submitted_at: string | null }[]) {
    const item = itemByQuiz.get(a.quiz_id);
    if (item) awaiting.add(cellKey(a.user_id, item.id));
    queue.push({
      key: `a:${a.id}`,
      kind: "attempt",
      userId: a.user_id,
      learner: nameOf.get(a.user_id) ?? "Participant",
      itemTitle: quizTitle.get(a.quiz_id) ?? item?.title ?? "",
      submittedAt: a.submitted_at,
      attemptNo: a.attempt_no,
      href: `/courses/${offeringId}/quizzes/${a.quiz_id}`,
    });
  }
  queue.sort((x, y) => (x.submittedAt ?? "").localeCompare(y.submittedAt ?? "") || compareNames(x.learner, y.learner));

  const cells = new Map<string, GradebookCell>();
  for (const l of learners) {
    for (const item of items) {
      const key = cellKey(l.userId, item.id);
      const grade = gradeByCell.get(key) ?? null;
      const rel = grade ? releasedAt.get(grade.id) ?? null : null;
      cells.set(key, { itemId: item.id, userId: l.userId, grade, releasedAt: rel, cell: staffCell(grade, rel !== null, awaiting.has(key)) });
    }
  }
  return { items, learners, cells, queue, summary };
}

/**
 * Released and working totals for one learner in the gradebook. The released total uses
 * the released snapshot of each grade, exactly like the learner's own page.
 */
export async function loadReleasedSnapshots(db: Db, offeringId: string) {
  const { data, error } = await db
    .from("released_grades")
    .select("grade_id, grade_item_id, user_id, status, points, max_points")
    .eq("offering_id", offeringId);
  if (error) throw new Error(`gradebook: ${error.message}`);
  const map = new Map<string, { status: GradeStatus; points: number | string | null; max_points: number | string }>();
  for (const r of (data ?? []) as { grade_item_id: string; user_id: string; status: GradeStatus; points: number | string | null; max_points: number | string }[]) {
    map.set(cellKey(r.user_id, r.grade_item_id), { status: r.status, points: r.points, max_points: r.max_points });
  }
  return map;
}

export function learnerTotals(
  learner: GradebookLearner,
  items: GradeItemRow[],
  cells: Map<string, GradebookCell>,
  released: Map<string, { status: GradeStatus; points: number | string | null; max_points: number | string }>,
): { released: CourseTotal; working: CourseTotal } {
  const releasedInputs: TotalInput[] = [];
  const workingInputs: TotalInput[] = [];
  for (const item of items) {
    const key = cellKey(learner.userId, item.id);
    const rel = released.get(key);
    releasedInputs.push({
      id: item.id,
      maxPoints: rel ? rel.max_points : item.max_points,
      countsTowardTotal: item.counts_toward_total,
      visibleToLearners: item.visible_to_learners,
      grade: rel ? { status: rel.status, points: rel.points } : null,
    });
    const g = cells.get(key)?.grade ?? null;
    workingInputs.push({
      id: item.id,
      maxPoints: item.max_points,
      countsTowardTotal: item.counts_toward_total,
      visibleToLearners: item.visible_to_learners,
      grade: g ? { status: g.status, points: g.points } : null,
    });
  }
  return { released: courseTotal(releasedInputs), working: courseTotal(workingInputs) };
}
