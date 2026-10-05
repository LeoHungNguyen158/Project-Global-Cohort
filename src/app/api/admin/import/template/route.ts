import { NextResponse } from "next/server";
import { adminForRequest } from "@/lib/admin/access";
import { IMPORT_TEMPLATE_CSV } from "@/lib/admin/import";

/** Documented CSV template for the enrollment import (administrators only). */
export async function GET() {
  const ctx = await adminForRequest();
  if (!ctx) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  // UTF-8 byte-order mark so spreadsheet programs open Vietnamese names correctly.
  return new NextResponse(`﻿${IMPORT_TEMPLATE_CSV}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="enrollment-import-template.csv"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
