import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/access";
import { pageWindow } from "@/lib/admin/data";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import { reviewAccessRequest } from "@/app/actions/admin/access-requests";
import { PageBody } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { Field, Textarea } from "@/components/ui/field";
import { cn } from "@/components/ui/cn";
import { SectionTitle } from "@/components/admin/badges";
import { ResultConfirm } from "@/components/admin/result-form";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.requests.title") };

const STATUSES = ["pending", "approved", "declined", "withdrawn", "all"] as const;
type Status = (typeof STATUSES)[number];
const PER_PAGE = 20;

type RequestRow = {
  id: string;
  offering_id: string;
  offering_code: string;
  offering_title: string;
  cohort_name: string;
  user_id: string;
  display_name: string;
  email: string | null; // platform administrators only
  message: string;
  status: "pending" | "approved" | "declined" | "withdrawn";
  created_at: string;
  reviewed_at: string | null;
  reviewer_name: string | null;
  review_note: string;
  total_count: number;
};

const TONES = { pending: "info", approved: "success", declined: "danger", withdrawn: "neutral" } as const;

export default async function AdminAccessRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireAdmin("/admin/access-requests");
  const tz = ctx.user.timezone;
  const status: Status = STATUSES.includes(sp.status as Status) ? (sp.status as Status) : "pending";
  const { page, offset, limit } = pageWindow(sp.page, PER_PAGE);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_access_requests", { p_status: status, p_limit: limit, p_offset: offset });
  if (error) throw new Error("Could not load access requests");
  const rows = (data ?? []) as RequestRow[];
  const total = Number(rows[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const href = (s: Status, p?: number) => {
    const q = new URLSearchParams();
    if (s !== "pending") q.set("status", s);
    if (p && p > 1) q.set("page", String(p));
    const qs = q.toString();
    return qs ? `/admin/access-requests?${qs}` : "/admin/access-requests";
  };

  return (
    <PageBody>
      <SectionTitle title={t("admin.requests.title")} description={t("admin.requests.description")} />
      <nav aria-label={t("admin.requests.statusNav")} className="mb-4">
        <ul className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <li key={s}>
              <Link
                href={href(s)}
                aria-current={s === status ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center rounded-full border px-4 text-sm",
                  s === status ? "border-primary bg-primary-soft font-semibold text-primary" : "border-line bg-panel hover:bg-canvas",
                )}
              >
                {t(`admin.requests.status.${s}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <p className="mb-3 text-sm" aria-live="polite">{total === 1 ? t("admin.common.result") : t("admin.common.results", { count: total })}</p>

      {rows.length === 0 ? (
        <EmptyState title={status === "pending" ? t("admin.requests.emptyPending") : t("admin.requests.empty")} />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-[var(--radius-panel)] border border-line bg-panel p-4 sm:px-6">
              <article aria-labelledby={`req-${r.id}`} className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 id={`req-${r.id}`} className="font-semibold [overflow-wrap:anywhere]">
                      {t("admin.requests.heading", { name: r.display_name, offering: r.offering_code })}
                    </h3>
                    <p className="text-sm text-muted [overflow-wrap:anywhere]">
                      {[r.email, r.offering_title, r.cohort_name].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-sm text-muted">{t("admin.requests.requestedAt", { date: formatDateTime(r.created_at, tz) })}</p>
                  </div>
                  <Badge tone={TONES[r.status]}>{t(`admin.requests.status.${r.status}`)}</Badge>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("admin.requests.message")}</p>
                  {r.message.trim() ? (
                    <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{r.message}</p>
                  ) : (
                    <p className="mt-1 text-sm text-muted">{t("admin.requests.noMessage")}</p>
                  )}
                </div>
                {r.status === "pending" ? (
                  <div className="flex flex-wrap gap-2">
                    <ResultConfirm
                      action={reviewAccessRequest}
                      fields={{ request: r.id, decision: "approve" }}
                      trigger={t("admin.requests.approve")}
                      triggerLabel={t("admin.requests.approveFor", { name: r.display_name })}
                      triggerVariant="primary"
                      size="md"
                      title={t("admin.requests.approveTitle", { name: r.display_name, offering: r.offering_code })}
                      description={t("admin.requests.approveDescription")}
                      confirmLabel={t("admin.requests.approve")}
                    >
                      <Field label={t("admin.common.note")} htmlFor={`approve-note-${r.id}`} hint={t("admin.requests.noteHint")}>
                        <Textarea id={`approve-note-${r.id}`} name="note" rows={3} maxLength={2000} aria-describedby={`approve-note-${r.id}-hint`} />
                      </Field>
                    </ResultConfirm>
                    <ResultConfirm
                      action={reviewAccessRequest}
                      fields={{ request: r.id, decision: "decline" }}
                      trigger={t("admin.requests.decline")}
                      triggerLabel={t("admin.requests.declineFor", { name: r.display_name })}
                      size="md"
                      tone="danger"
                      title={t("admin.requests.declineTitle", { name: r.display_name, offering: r.offering_code })}
                      description={t("admin.requests.declineDescription")}
                      confirmLabel={t("admin.requests.decline")}
                    >
                      <Field label={t("admin.common.note")} htmlFor={`decline-note-${r.id}`} hint={t("admin.requests.noteHint")}>
                        <Textarea id={`decline-note-${r.id}`} name="note" rows={3} maxLength={2000} aria-describedby={`decline-note-${r.id}-hint`} />
                      </Field>
                    </ResultConfirm>
                  </div>
                ) : r.reviewed_at ? (
                  <p className="text-sm text-muted">
                    {t("admin.requests.reviewed", { date: formatDateTime(r.reviewed_at, tz), name: r.reviewer_name ?? t("admin.user.unknownActor") })}
                    {r.review_note ? ` ${t("admin.requests.reviewNote", { note: r.review_note })}` : ""}
                  </p>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">{t("admin.common.timesShownIn", { tz })}</p>
      <Pagination page={Math.min(page, pages)} pages={pages} hrefFor={(p) => href(status, p)} />
    </PageBody>
  );
}
