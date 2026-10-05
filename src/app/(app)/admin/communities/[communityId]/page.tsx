import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/access";
import { getAdminCommunity, listAdminCohorts } from "@/lib/admin/data";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { addCommunityMember, removeCommunityMember, updateCommunity } from "@/app/actions/admin/communities";
import { PageBody } from "@/components/ui/page-header";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, td, th } from "@/components/admin/scroll-table";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ActionForm } from "@/components/ui/action-form";
import { ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { SectionTitle } from "@/components/admin/badges";
import { CommunityFields } from "@/components/admin/community-fields";
import { ResultConfirm } from "@/components/admin/result-form";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t("admin.community.title") };

// Email addresses come back for platform administrators only (null for coordinators).
type Person = { kind: "member" | "candidate"; user_id: string; display_name: string; email: string | null; suspended: boolean; joined_at: string | null };

export default async function AdminCommunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ communityId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { communityId } = await params;
  const sp = await searchParams;
  const ctx = await requireAdmin(`/admin/communities/${communityId}`);
  const community = await getAdminCommunity(ctx, communityId);
  if (!community) notFound();
  const tz = ctx.user.timezone;
  const supabase = await createClient();
  const [{ data: peopleData, error }, cohorts] = await Promise.all([
    supabase.rpc("admin_community_people", { p_community: community.id }),
    listAdminCohorts(ctx),
  ]);
  if (error) throw new Error("Could not load the community");
  const people = ((peopleData ?? []) as Person[]).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const members = people.filter((p) => p.kind === "member");
  const candidates = people.filter((p) => p.kind === "candidate");
  // Cohorts to choose from: active and upcoming ones, plus the current cohort even if archived.
  const cohortChoices = cohorts.filter((c) => c.status !== "archived" || c.id === community.cohort_id);
  const cohortLabel = community.cohorts ? `${community.cohorts.name} (${community.cohorts.code})` : t("admin.communities.programWide");

  return (
    <PageBody className="space-y-6">
      <SectionTitle
        back={{ href: "/admin/communities", label: t("admin.community.back") }}
        title={community.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{cohortLabel}</span>
            <Badge tone={community.join_policy === "open" ? "success" : "info"}>{t(`admin.communities.policy.${community.join_policy}`)}</Badge>
            {community.is_sample ? <Badge>{t("admin.common.sample")}</Badge> : null}
          </span>
        }
        actions={<ButtonLink href={`/cohorts/communities/${community.id}`} variant="secondary">{t("admin.community.viewInComms")}</ButtonLink>}
      />
      {sp.created === "1" ? <Alert tone="success">{t("admin.communities.created")}</Alert> : null}

      <Panel aria-labelledby="community-details">
        <PanelHeader id="community-details" title={t("admin.community.details")} />
        <div className="p-4 sm:px-6">
          <ActionForm action={updateCommunity} className="space-y-4">
            <input type="hidden" name="community" value={community.id} />
            <CommunityFields idPrefix="edit-community" community={community} cohorts={cohortChoices} allowProgramWide={ctx.isPlatformAdmin} />
            <SubmitButton>{t("admin.common.save")}</SubmitButton>
          </ActionForm>
        </div>
      </Panel>

      <Panel aria-labelledby="community-members">
        <PanelHeader id="community-members" title={t("admin.community.members", { count: members.length })} />
        <div className="space-y-4 p-4 sm:px-6">
          <p className="text-sm text-muted">{t("admin.community.membersHelp")}</p>
          {community.cohort_id ? (
            candidates.length === 0 ? (
              <p className="text-sm text-muted">{t("admin.community.noCandidates")}</p>
            ) : (
              <ActionForm action={addCommunityMember} resetOnSuccess className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="community" value={community.id} />
                <Field
                  label={t("admin.community.addFromCohort", { cohort: community.cohorts?.name ?? "" })}
                  htmlFor="add-member"
                  hint={t("admin.community.addFromCohortHint")}
                  className="min-w-[16rem] flex-1"
                >
                  <Select id="add-member" name="user" required defaultValue="" aria-describedby="add-member-hint">
                    <option value="" disabled>{t("admin.community.choosePerson")}</option>
                    {candidates.map((p) => (
                      <option key={p.user_id} value={p.user_id}>{p.email ? `${p.display_name} (${p.email})` : p.display_name}</option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton variant="secondary">{t("admin.community.addMember")}</SubmitButton>
              </ActionForm>
            )
          ) : (
            <ActionForm action={addCommunityMember} resetOnSuccess className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="community" value={community.id} />
              <Field label={t("admin.community.addByEmail")} htmlFor="add-member" hint={t("admin.community.addByEmailHint")} className="min-w-[16rem] flex-1">
                <Input id="add-member" name="email" type="email" required maxLength={320} autoComplete="off" aria-describedby="add-member-hint" />
              </Field>
              <SubmitButton variant="secondary">{t("admin.community.addMember")}</SubmitButton>
            </ActionForm>
          )}
          {members.length === 0 ? (
            <p className="text-sm text-muted">{t("admin.community.noMembers")}</p>
          ) : (
            <Table caption={t("admin.community.membersCaption")} captionHidden>
              <thead>
                <tr>
                  <th scope="col" className={th}>{t("admin.common.name")}</th>
                  {ctx.isPlatformAdmin ? <th scope="col" className={th}>{t("admin.common.email")}</th> : null}
                  <th scope="col" className={th}>{t("admin.common.status")}</th>
                  <th scope="col" className={th}>{t("admin.community.joined")}</th>
                  {/* Visible header text: an absolutely positioned sr-only span would escape the table's scroll area. */}
                  <th scope="col" className={th}>{t("admin.common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((p) => (
                  <tr key={p.user_id}>
                    <td className={td}>
                      {ctx.isPlatformAdmin ? (
                        <Link href={`/admin/users/${p.user_id}`} className="text-primary underline-offset-2 hover:underline">{p.display_name}</Link>
                      ) : (
                        p.display_name
                      )}
                    </td>
                    {ctx.isPlatformAdmin ? <td className={`${td} whitespace-nowrap`}>{p.email ?? ""}</td> : null}
                    <td className={td}>
                      {p.suspended ? <Badge tone="danger">{t("admin.account.suspended")}</Badge> : <Badge tone="success">{t("admin.account.active")}</Badge>}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{p.joined_at ? formatDate(p.joined_at, tz) : ""}</td>
                    <td className={td}>
                      <ResultConfirm
                        action={removeCommunityMember}
                        fields={{ community: community.id, user: p.user_id }}
                        trigger={t("admin.community.remove")}
                        triggerLabel={t("admin.community.removeFor", { name: p.display_name })}
                        tone="danger"
                        title={t("admin.community.removeTitle", { name: p.display_name })}
                        description={t("admin.community.removeDescription")}
                        confirmLabel={t("admin.community.remove")}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Panel>
      <p className="text-xs text-muted">{t("admin.common.timesShownIn", { tz })}</p>
    </PageBody>
  );
}
