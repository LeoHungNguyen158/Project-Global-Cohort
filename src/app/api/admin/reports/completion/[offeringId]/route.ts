import { NextResponse } from "next/server";
import { adminForRequest } from "@/lib/admin/access";
import { getAdminOffering } from "@/lib/admin/data";
import { completionCsv, completionFilename, type CompletionRow } from "@/lib/admin/reports";
import { createClient } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Completion report CSV for one offering. Only administrators of the offering's cohort
 * get it (404 for everyone else, without saying whether the offering exists); the
 * report itself is read with the caller's own session, so the database checks again.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await ctx.params;
  const notFound = () => new NextResponse("Not found", { status: 404, headers: NO_STORE });
  const admin = await adminForRequest();
  if (!admin) return notFound();
  const offering = await getAdminOffering(admin, offeringId);
  if (!offering) return notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("completion_report", { p_offering: offering.id });
  if (error) return new NextResponse("The report could not be generated", { status: 500, headers: NO_STORE });
  // UTF-8 byte-order mark so spreadsheet programs keep accented names intact.
  return new NextResponse(`﻿${completionCsv((data ?? []) as CompletionRow[])}`, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${completionFilename(offering.code)}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
