import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { COMMON_TIMEZONES, utcToWallTime } from "@/lib/time";
import { timeZoneOptions } from "@/lib/admin/validation";
import { t } from "@/i18n";

type OfferingValues = {
  code: string;
  term_label: string;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  accent_color: string;
  catalog_visible: boolean;
  catalog_state: string;
};

/**
 * Offering fields shared by the create and edit forms. Start and end are wall-clock
 * times in the offering's time zone (the zone chosen in this form), stored as UTC.
 */
export function OfferingFields({ offering, idPrefix, defaultTimezone }: { offering?: OfferingValues; idPrefix: string; defaultTimezone?: string }) {
  const zones = timeZoneOptions(COMMON_TIMEZONES);
  const tz = offering?.timezone ?? defaultTimezone ?? "America/New_York";
  const id = (f: string) => `${idPrefix}-${f}`;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label={t("admin.common.code")} htmlFor={id("code")} hint={t("admin.offerings.codeHint")} required>
        <Input id={id("code")} name="code" required minLength={2} maxLength={64} pattern="[A-Za-z0-9_.\-]{2,64}" defaultValue={offering?.code} aria-describedby={`${id("code")}-hint`} />
      </Field>
      <Field label={t("admin.offerings.termLabel")} htmlFor={id("term")} hint={t("admin.offerings.termHint")}>
        <Input id={id("term")} name="term_label" maxLength={100} defaultValue={offering?.term_label} aria-describedby={`${id("term")}-hint`} />
      </Field>
      <Field label={t("admin.offerings.timezone")} htmlFor={id("tz")} hint={t("admin.offerings.timezoneHint")} required>
        <Select id={id("tz")} name="timezone" required defaultValue={tz} aria-describedby={`${id("tz")}-hint`}>
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </Select>
      </Field>
      <Field label={t("admin.offerings.accent")} htmlFor={id("color")} hint={t("admin.offerings.accentHint")}>
        <input
          id={id("color")}
          name="accent_color"
          type="color"
          defaultValue={offering?.accent_color ?? "#1D4ED8"}
          className="block h-10 w-24 cursor-pointer rounded-md border border-line bg-white p-1"
          aria-describedby={`${id("color")}-hint`}
        />
      </Field>
      <Field label={t("admin.offerings.startsAt")} htmlFor={id("starts")} hint={t("admin.offerings.wallTimeHint")}>
        <Input id={id("starts")} name="starts_local" type="datetime-local" defaultValue={utcToWallTime(offering?.starts_at, tz)} aria-describedby={`${id("starts")}-hint`} />
      </Field>
      <Field label={t("admin.offerings.endsAt")} htmlFor={id("ends")} hint={t("admin.offerings.wallTimeHint")}>
        <Input id={id("ends")} name="ends_local" type="datetime-local" defaultValue={utcToWallTime(offering?.ends_at, tz)} aria-describedby={`${id("ends")}-hint`} />
      </Field>
      <fieldset className="space-y-2 rounded-md border border-line p-4 md:col-span-2">
        <legend className="px-1 text-sm font-semibold">{t("admin.offerings.catalog")}</legend>
        <Checkbox name="catalog_visible" label={t("admin.offerings.catalogVisible")} defaultChecked={offering?.catalog_visible ?? false} />
        <Field label={t("admin.offerings.catalogState")} htmlFor={id("catalog")} hint={t("admin.offerings.catalogStateHint")}>
          <Select id={id("catalog")} name="catalog_state" defaultValue={offering?.catalog_state ?? "not_open"} aria-describedby={`${id("catalog")}-hint`}>
            <option value="not_open">{t("admin.offerings.catalogNotOpen")}</option>
            <option value="open_for_requests">{t("admin.offerings.catalogOpen")}</option>
          </Select>
        </Field>
      </fieldset>
    </div>
  );
}
