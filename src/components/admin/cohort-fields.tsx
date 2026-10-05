import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { COMMON_TIMEZONES } from "@/lib/time";
import { timeZoneOptions } from "@/lib/admin/validation";
import { t } from "@/i18n";

type CohortValues = {
  code: string;
  name: string;
  description: string;
  timezone: string;
  starts_on: string | null;
  ends_on: string | null;
  status: string;
};

/** Cohort form fields shared by the create and edit forms. */
export function CohortFields({ cohort, idPrefix }: { cohort?: CohortValues; idPrefix: string }) {
  const zones = timeZoneOptions(COMMON_TIMEZONES);
  const id = (f: string) => `${idPrefix}-${f}`;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label={t("admin.common.code")} htmlFor={id("code")} hint={t("admin.cohorts.codeHint")} required>
        <Input id={id("code")} name="code" required minLength={2} maxLength={64} pattern="[A-Za-z0-9_.\-]{2,64}" defaultValue={cohort?.code} aria-describedby={`${id("code")}-hint`} />
      </Field>
      <Field label={t("admin.cohorts.name")} htmlFor={id("name")} required>
        <Input id={id("name")} name="name" required maxLength={200} defaultValue={cohort?.name} />
      </Field>
      <Field label={t("admin.cohorts.descriptionLabel")} htmlFor={id("description")} className="md:col-span-2">
        <Textarea id={id("description")} name="description" rows={3} maxLength={2000} defaultValue={cohort?.description} />
      </Field>
      <Field label={t("admin.cohorts.timezone")} htmlFor={id("timezone")} hint={t("admin.cohorts.timezoneHint")} required>
        <Select id={id("timezone")} name="timezone" required defaultValue={cohort?.timezone ?? "America/New_York"} aria-describedby={`${id("timezone")}-hint`}>
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </Select>
      </Field>
      <Field label={t("admin.common.status")} htmlFor={id("status")} required>
        <Select id={id("status")} name="status" required defaultValue={cohort && cohort.status !== "archived" ? cohort.status : "active"}>
          <option value="upcoming">{t("admin.cohortStatus.upcoming")}</option>
          <option value="active">{t("admin.cohortStatus.active")}</option>
        </Select>
      </Field>
      <Field label={t("admin.cohorts.startsOn")} htmlFor={id("starts")}>
        <Input id={id("starts")} name="starts_on" type="date" defaultValue={cohort?.starts_on ?? ""} />
      </Field>
      <Field label={t("admin.cohorts.endsOn")} htmlFor={id("ends")}>
        <Input id={id("ends")} name="ends_on" type="date" defaultValue={cohort?.ends_on ?? ""} />
      </Field>
    </div>
  );
}
