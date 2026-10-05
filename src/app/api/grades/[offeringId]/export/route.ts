import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { isUuid } from "@/lib/forms";
import { gradebookCsv, type CsvLabels, type CsvLearnerRow, type StaffCell } from "@/lib/domain/grades";
import { todayIn } from "@/lib/calendar/dates";
import { cellKey, learnerTotals, loadGradebook, loadReleasedSnapshots } from "@/components/grades/load";
import { t, type MessageKey } from "@/i18n";

const ENTRY: Record<StaffCell["entry"], MessageKey> = {
  ungraded: "gradebook.entry.ungraded",
  pending: "gradebook.entry.pending",
  graded: "gradebook.entry.graded",
  missing: "gradebook.entry.missing",
  exempt: "gradebook.entry.exempt",
};

const PUBLICATION: Record<Exclude<StaffCell["publication"], "none">, MessageKey> = {
  unpublished: "gradebook.pub.unpublished",
  published: "gradebook.pub.published",
  changed: "gradebook.pub.changed",
};

const ENROLL: Record<string, MessageKey> = {
  active: "gradebook.enroll.active",
  completed: "gradebook.enroll.completed",
  withdrawn: "gradebook.enroll.withdrawn",
  suspended: "gradebook.enroll.suspended",
};

const LABELS: CsvLabels = {
  learner: t("gradebook.csv.learner"),
  enrollment: t("gradebook.csv.enrollment"),
  pointsHeader: (item, max) => t("gradebook.csv.points", { item, max }),
  statusHeader: (item) => t("gradebook.csv.status", { item }),
  releasedEarned: t("gradebook.csv.releasedEarned"),
  releasedPossible: t("gradebook.csv.releasedPossible"),
  releasedPercent: t("gradebook.csv.releasedPercent"),
  workingPercent: t("gradebook.csv.workingPercent"),
  cellStatus: (cell) =>
    t("gradebook.csv.cellStatus", {
      entry: t(ENTRY[cell.entry]),
      publication: cell.publication === "none" ? t("gradebook.csv.noPublication") : t(PUBLICATION[cell.publication]),
    }),
  enrollmentStatus: (status) => (ENROLL[status] ? t(ENROLL[status]) : status),
};

const noStore = { "Cache-Control": "private, no-store" };

/**
 * Gradebook CSV for course staff. The caller's session is checked here (route handlers are
 * not covered by the page middleware) and every query runs as that user, so RLS limits the
 * data to offerings they teach or administer. Learners and strangers get 404.
 * Contents: display names, enrollment status and grades only; every cell is neutralized
 * against spreadsheet formulas by gradebookCsv/csvCell.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await ctx.params;
  const notFound = () => new NextResponse("Not found", { status: 404, headers: noStore });
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Sign in required", { status: 401, headers: noStore });
  if (!isUuid(offeringId)) return notFound();

  const db = await createClient();
  const { data: offering } = await db.from("course_offerings").select("id, code, cohort_id").eq("id", offeringId).maybeSingle();
  if (!offering) return notFound();
  const isStaff =
    user.staff.some((s) => s.offering_id === offering.id) || user.isPlatformAdmin || user.coordinatorCohorts.includes(offering.cohort_id as string);
  if (!isStaff) return notFound();

  let csv: string;
  try {
    const [data, released] = await Promise.all([loadGradebook(db, offering.id), loadReleasedSnapshots(db, offering.id)]);
    if (data.summary === null) return notFound(); // the database did not confirm staff access
    const rows: CsvLearnerRow[] = data.learners.map((l) => {
      const totals = learnerTotals(l, data.items, data.cells, released);
      const cells: CsvLearnerRow["cells"] = {};
      for (const it of data.items) {
        const c = data.cells.get(cellKey(l.userId, it.id));
        if (c) cells[it.id] = { cell: c.cell, points: c.grade?.points ?? null };
      }
      return { name: l.name, enrollmentStatus: l.enrollmentStatus, cells, released: totals.released, working: totals.working };
    });
    csv = gradebookCsv(
      data.items.map((it) => ({ id: it.id, title: it.title, maxPoints: it.max_points })),
      rows,
      LABELS,
    );
  } catch {
    return new NextResponse(t("gradebook.exportFailed"), { status: 500, headers: noStore });
  }

  const code = String(offering.code).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "course";
  const filename = `${code}-gradebook-${todayIn(user.timezone)}.csv`;
  return new NextResponse(`﻿${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      ...noStore,
    },
  });
}
