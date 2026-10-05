import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/access";
import { listAdminCohorts, listAdminOfferings, offeringLabel, pageWindow } from "@/lib/admin/data";
import { isUuid } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/time";
import { resendInvitation, revokeInvitation } from "@/app/actions/admin/invitations";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, td, th } from "@/components/admin/scroll-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { AutoSubmit } from "@/components/ui/auto-submit";
import { buttonClass } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EmailStatusBadge, InvitationBadge, InviteRoleLabel, SectionTitle, invitationState } from "@/components/admin/badges";
import { InviteForm } from "@/components/admin/invite-form";
import { ResultConfirm, ResultForm } from "@/components/admin/result-form";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.invitations.title") };

const STATUSES = ["pending", "accepted", "expired", "revoked", "all"] as const;
type Status = (typeof STATUSES)[number];
const PER_PAGE = 25;
const selectClass = "block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-ink";

type SP = { status?: string; delivery?: string; cohort?: string; q?: string; page?: string; offering?: string };

type InvitationRow = {
  id: string;
  email: string;
  role: string;
  cohort_id: string | null;
  offering_id: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  email_status: string;
  email_error: string | null;
  created_at: string;
  cohorts: { code: string; name: string } | null;
  course_offerings: { code: string } | null;
  creator: { display_name: string } | null;
};

function likeEscape(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export default async function AdminInvitationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requireAdmin("/admin/invitations");
  const tz = ctx.user.timezone;
  const status: Status = STATUSES.includes(sp.status as Status) ? (sp.status as Status) : "pending";
  const delivery = sp.delivery === "failed" ? "failed" : "";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const { page, offset } = pageWindow(sp.page, PER_PAGE);

  const [cohorts, offerings] = await Promise.all([listAdminCohorts(ctx), listAdminOfferings(ctx)]);
  const cohortFilter = isUuid(sp.cohort) && cohorts.some((c) => c.id === sp.cohort) ? sp.cohort : "";

  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  let query = supabase
    .from("invitations")
    .select(
      "id, email, role, cohort_id, offering_id, expires_at, accepted_at, revoked_at, email_status, email_error, created_at, cohorts(code, name), course_offerings(code), creator:profiles!invitations_created_by_fkey(display_name)",
      { count: "exact" },
    );
  if (status === "pending") query = query.is("accepted_at", null).is("revoked_at", null).gt("expires_at", nowIso);
  if (status === "accepted") query = query.not("accepted_at", "is", null);
  if (status === "expired") query = query.is("accepted_at", null).is("revoked_at", null).lte("expires_at", nowIso);
  if (status === "revoked") query = query.not("revoked_at", "is", null);
  if (delivery) query = query.eq("email_status", delivery);
  if (q) query = query.ilike("email", `%${likeEscape(q.toLowerCase())}%`);
  if (cohortFilter) {
    const inCohort = offerings.filter((o) => o.cohort_id === cohortFilter).map((o) => o.id);
    query = inCohort.length > 0 ? query.or(`cohort_id.eq.${cohortFilter},offering_id.in.(${inCohort.join(",")})`) : query.eq("cohort_id", cohortFilter);
  }
  const { data, count, error } = await query.order("created_at", { ascending: false }).range(offset, offset + PER_PAGE - 1);
  if (error) throw new Error("Could not load invitations");
  const rows = (data ?? []) as unknown as InvitationRow[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const now = new Date(nowIso).getTime();

  const openCohorts = cohorts.filter((c) => c.status !== "archived");
  const openOfferings = offerings.filter((o) => o.status !== "archived" && o.cohorts?.status !== "archived");
  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged = { status: status === "pending" ? "" : status, delivery, cohort: cohortFilter, q, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const s = p.toString();
    return s ? `/admin/invitations?${s}` : "/admin/invitations";
  };

  return (
    <PageBody className="space-y-6">
      <SectionTitle title={t("admin.invitations.title")} description={t("admin.invitations.description")} />

      <Panel aria-labelledby="new-invitation-title" id="new-invitation">
        <PanelHeader id="new-invitation-title" title={t("admin.invite.newTitle")} />
        <div className="p-4 sm:px-6">
          {openCohorts.length === 0 ? (
            <p className="text-sm text-muted">{t("admin.invite.noScopes")}</p>
          ) : (
            <InviteForm
              cohorts={openCohorts.map((c) => ({ id: c.id, label: `${c.name} (${c.code})` }))}
              offerings={openOfferings.map((o) => ({ id: o.id, label: offeringLabel(o), cohortId: o.cohort_id }))}
              defaultCohort={cohortFilter || undefined}
              defaultOffering={isUuid(sp.offering) ? sp.offering : undefined}
            />
          )}
        </div>
      </Panel>

      <section aria-labelledby="invitation-list" className="space-y-3">
        <h3 id="invitation-list" className="text-lg font-semibold">{t("admin.invitations.listTitle")}</h3>
        <form method="get" action="/admin/invitations" role="search" aria-label={t("admin.invitations.filters")} className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 basis-full sm:basis-auto sm:flex-[2_1_14rem]">
            <label htmlFor="inv-q" className="block text-xs text-muted">{t("admin.invitations.searchEmail")}</label>
            <input id="inv-q" name="q" type="search" defaultValue={q} className="block min-h-10 w-full rounded-md border border-line bg-white px-3 py-2" />
          </div>
          <div className="min-w-[9rem] flex-[1_1_9rem]">
            <label htmlFor="inv-status" className="block text-xs text-muted">{t("admin.common.status")}</label>
            <select id="inv-status" name="status" defaultValue={status} className={selectClass}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s === "all" ? t("admin.invitations.allStatuses") : t(`admin.invitationState.${s}`)}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[9rem] flex-[1_1_9rem]">
            <label htmlFor="inv-delivery" className="block text-xs text-muted">{t("admin.invitations.delivery")}</label>
            <select id="inv-delivery" name="delivery" defaultValue={delivery} className={selectClass}>
              <option value="">{t("admin.invitations.anyDelivery")}</option>
              <option value="failed">{t("admin.emailStatus.failed")}</option>
            </select>
          </div>
          <div className="min-w-[10rem] flex-[1_1_10rem]">
            <label htmlFor="inv-cohort" className="block text-xs text-muted">{t("admin.common.cohort")}</label>
            <select id="inv-cohort" name="cohort" defaultValue={cohortFilter} className={selectClass}>
              <option value="">{t("admin.common.anyCohort")}</option>
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" data-apply className={buttonClass("secondary")}>{t("admin.common.apply")}</button>
          <AutoSubmit />
        </form>

        <p className="text-sm" aria-live="polite">{total === 1 ? t("admin.common.result") : t("admin.common.results", { count: total })}</p>

        {rows.length === 0 ? (
          <EmptyState title={t("admin.invitations.empty")} action={<Link className={buttonClass("secondary")} href="/admin/invitations?status=all">{t("admin.invitations.showAll")}</Link>} />
        ) : (
          <Table caption={t("admin.invitations.caption")} captionHidden>
            <thead>
              <tr>
                <th scope="col" className={th}>{t("admin.common.email")}</th>
                <th scope="col" className={th}>{t("admin.invitations.scope")}</th>
                <th scope="col" className={th}>{t("admin.common.status")}</th>
                <th scope="col" className={th}>{t("admin.invitations.emailColumn")}</th>
                <th scope="col" className={th}>{t("admin.common.created")}</th>
                <th scope="col" className={th}>{t("admin.common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const state = invitationState(r, now);
                return (
                  <tr key={r.id}>
                    <td className={`${td} whitespace-nowrap`}>
                      <span className="font-medium">{r.email}</span>
                      <span className="block text-xs text-muted"><InviteRoleLabel role={r.role} /></span>
                    </td>
                    <td className={td}>
                      {r.course_offerings ? <span className="block">{r.course_offerings.code}</span> : null}
                      <span className="block text-xs text-muted">{r.cohorts?.name ?? (r.course_offerings ? "" : "—")}</span>
                    </td>
                    <td className={td}>
                      <InvitationBadge state={state} />
                      <span className="mt-1 block text-xs text-muted">
                        {state === "accepted" && r.accepted_at
                          ? t("admin.invitations.acceptedOn", { date: formatDate(r.accepted_at, tz) })
                          : state === "revoked" && r.revoked_at
                            ? t("admin.invitations.revokedOn", { date: formatDate(r.revoked_at, tz) })
                            : state === "expired"
                              ? t("admin.invitations.expiredOn", { date: formatDate(r.expires_at, tz) })
                              : t("admin.invitations.expiresOn", { date: formatDateTime(r.expires_at, tz) })}
                      </span>
                    </td>
                    <td className={td}>
                      <EmailStatusBadge status={r.email_status} />
                      {r.email_error ? <span className="mt-1 block max-w-xs text-xs text-muted">{r.email_error}</span> : null}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {formatDate(r.created_at, tz)}
                      {r.creator?.display_name ? <span className="block text-xs text-muted">{t("admin.invitations.by", { name: r.creator.display_name })}</span> : null}
                    </td>
                    <td className={td}>
                      {state === "pending" || state === "expired" ? (
                        <div className="flex min-w-[12rem] flex-wrap items-start gap-2">
                          {state === "pending" ? (
                            <ResultForm action={resendInvitation} flash>
                              <input type="hidden" name="invitation" value={r.id} />
                              <SubmitButton size="sm" variant="secondary" pendingText={t("admin.invite.sending")} aria-label={t("admin.invitations.resendFor", { email: r.email })}>
                                {t("admin.invitations.resend")}
                              </SubmitButton>
                            </ResultForm>
                          ) : (
                            <ResultConfirm
                              action={resendInvitation}
                              fields={{ invitation: r.id, renew: "1" }}
                              trigger={t("admin.invitations.renew")}
                              triggerLabel={t("admin.invitations.renewFor", { email: r.email })}
                              title={t("admin.invitations.renewTitle", { email: r.email })}
                              description={t("admin.invitations.renewDescription")}
                              confirmLabel={t("admin.invitations.renewConfirm")}
                              cancelLabel={t("admin.common.cancel")}
                              pendingLabel={t("admin.invite.sending")}
                            />
                          )}
                          <ResultConfirm
                            action={revokeInvitation}
                            fields={{ invitation: r.id }}
                            trigger={t("admin.invitations.revoke")}
                            triggerLabel={t("admin.invitations.revokeFor", { email: r.email })}
                            triggerVariant="ghost"
                            tone="danger"
                            title={t("admin.invitations.revokeTitle", { email: r.email })}
                            description={t("admin.invitations.revokeDescription")}
                            confirmLabel={t("admin.invitations.revokeConfirm")}
                            cancelLabel={t("admin.common.cancel")}
                            pendingLabel={t("admin.common.working")}
                          >
                            <Field label={t("admin.common.note")} htmlFor={`revoke-reason-${r.id}`} hint={t("admin.invitations.revokeReasonHint")}>
                              <Textarea id={`revoke-reason-${r.id}`} name="reason" rows={2} maxLength={500} aria-describedby={`revoke-reason-${r.id}-hint`} />
                            </Field>
                          </ResultConfirm>
                        </div>
                      ) : (
                        <span className="text-sm text-muted">{state === "accepted" ? t("admin.invitations.noActionsAccepted") : t("admin.invitations.noActionsRevoked")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <p className="text-xs text-muted">{t("admin.common.timesShownIn", { tz })}</p>
        <Pagination page={Math.min(page, pages)} pages={pages} hrefFor={(p) => qs({ page: String(p) })} />
      </section>
    </PageBody>
  );
}
