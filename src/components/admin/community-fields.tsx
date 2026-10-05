import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { t } from "@/i18n";

type CommunityValues = {
  name: string;
  description: string;
  cohort_id: string | null;
  join_policy: "open" | "invite";
};

/**
 * Community form fields shared by the create and edit forms. `cohorts` are the cohorts the
 * administrator may choose; program-wide (no cohort) is offered to platform administrators only.
 */
export function CommunityFields({
  community,
  cohorts,
  allowProgramWide,
  idPrefix,
}: {
  community?: CommunityValues;
  cohorts: { id: string; code: string; name: string }[];
  allowProgramWide: boolean;
  idPrefix: string;
}) {
  const id = (f: string) => `${idPrefix}-${f}`;
  const cohortHint = `${allowProgramWide ? t("admin.communities.cohortHintPlatform") : t("admin.communities.cohortHintCoordinator")}${
    community ? ` ${t("admin.communities.cohortMoveHint")}` : ""
  }`;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label={t("admin.communities.name")} htmlFor={id("name")} required>
        <Input id={id("name")} name="name" required maxLength={200} defaultValue={community?.name} />
      </Field>
      <Field label={t("admin.communities.joinPolicy")} htmlFor={id("join-policy")} hint={t("admin.communities.joinPolicyHint")} required>
        <Select id={id("join-policy")} name="join_policy" required defaultValue={community?.join_policy ?? "invite"} aria-describedby={`${id("join-policy")}-hint`}>
          <option value="open">{t("admin.communities.policy.open")}</option>
          <option value="invite">{t("admin.communities.policy.invite")}</option>
        </Select>
      </Field>
      <Field label={t("admin.communities.descriptionLabel")} htmlFor={id("description")} className="md:col-span-2">
        <Textarea id={id("description")} name="description" rows={3} maxLength={2000} defaultValue={community?.description} />
      </Field>
      <Field label={t("admin.communities.cohort")} htmlFor={id("cohort")} hint={cohortHint} required={!allowProgramWide} className="md:col-span-2">
        <Select id={id("cohort")} name="cohort" required={!allowProgramWide} defaultValue={community?.cohort_id ?? ""} aria-describedby={`${id("cohort")}-hint`}>
          {allowProgramWide ? <option value="">{t("admin.communities.noCohort")}</option> : null}
          {cohorts.map((c) => (
            <option key={c.id} value={c.id}>{`${c.name} (${c.code})`}</option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
