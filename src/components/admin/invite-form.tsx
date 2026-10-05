"use client";
import { useMemo, useState } from "react";
import { createInvitation } from "@/app/actions/admin/invitations";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ResultForm } from "./result-form";
import { t } from "@/i18n";

export type ScopeOption = { id: string; label: string };
export type OfferingScopeOption = { id: string; label: string; cohortId: string };

const EXPIRY_DAYS = [3, 7, 14, 30, 60, 90];

/** Invitation form: picking an offering also fixes its cohort; staff roles need an offering. */
export function InviteForm({
  cohorts,
  offerings,
  defaultCohort,
  defaultOffering,
}: {
  cohorts: ScopeOption[];
  offerings: OfferingScopeOption[];
  defaultCohort?: string;
  defaultOffering?: string;
}) {
  const preset = offerings.find((o) => o.id === defaultOffering);
  const [role, setRole] = useState("participant");
  const [cohort, setCohort] = useState(preset?.cohortId ?? (defaultCohort && cohorts.some((c) => c.id === defaultCohort) ? defaultCohort : ""));
  const [offering, setOffering] = useState(preset?.id ?? "");
  const visibleOfferings = useMemo(() => (cohort ? offerings.filter((o) => o.cohortId === cohort) : offerings), [cohort, offerings]);
  const staffRole = role !== "participant";

  return (
    <ResultForm action={createInvitation} resetOnSuccess className="space-y-4" aria-label={t("admin.invite.formLabel")}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("admin.invite.email")} htmlFor="invite-email" required>
          <Input id="invite-email" name="email" type="email" required maxLength={320} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label={t("admin.invite.displayName")} htmlFor="invite-name" hint={t("admin.invite.displayNameHint")}>
          <Input id="invite-name" name="display_name" maxLength={120} autoComplete="off" aria-describedby="invite-name-hint" />
        </Field>
        <Field label={t("admin.common.role")} htmlFor="invite-role" required>
          <Select id="invite-role" name="role" value={role} onChange={(e) => setRole(e.target.value)} required>
            <option value="participant">{t("admin.inviteRole.participant")}</option>
            <option value="instructor">{t("admin.inviteRole.instructor")}</option>
            <option value="ta">{t("admin.inviteRole.ta")}</option>
          </Select>
        </Field>
        <Field label={t("admin.invite.expires")} htmlFor="invite-expiry" hint={t("admin.invite.expiresHint")} required>
          <Select id="invite-expiry" name="expires_days" defaultValue="14" required aria-describedby="invite-expiry-hint">
            {EXPIRY_DAYS.map((d) => (
              <option key={d} value={d}>{t("admin.invite.days", { days: d })}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.common.cohort")} htmlFor="invite-cohort" hint={t("admin.invite.cohortHint")} required={!offering}>
          <Select
            id="invite-cohort"
            name="cohort"
            value={cohort}
            aria-describedby="invite-cohort-hint"
            onChange={(e) => {
              setCohort(e.target.value);
              if (offering && !offerings.some((o) => o.id === offering && o.cohortId === e.target.value)) setOffering("");
            }}
          >
            <option value="">{t("admin.common.chooseCohort")}</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </Select>
        </Field>
        <Field
          label={t("admin.common.offering")}
          htmlFor="invite-offering"
          hint={staffRole ? t("admin.invite.offeringRequired") : t("admin.invite.offeringOptional")}
          required={staffRole}
        >
          <Select
            id="invite-offering"
            name="offering"
            value={offering}
            required={staffRole}
            aria-describedby="invite-offering-hint"
            onChange={(e) => {
              setOffering(e.target.value);
              const o = offerings.find((x) => x.id === e.target.value);
              if (o) setCohort(o.cohortId);
            }}
          >
            <option value="">{staffRole ? t("admin.common.chooseOffering") : t("admin.common.noOffering")}</option>
            {visibleOfferings.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="text-sm text-muted">{t("admin.invite.deliveryNote")}</p>
      <SubmitButton pendingText={t("admin.invite.sending")}>{t("admin.invite.submit")}</SubmitButton>
    </ResultForm>
  );
}
