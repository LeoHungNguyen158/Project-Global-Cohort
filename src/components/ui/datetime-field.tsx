import { Field, Input } from "./field";
import { utcToWallTime, zoneAbbreviation } from "@/lib/time";

/**
 * Date and time input in a named zone. Submits the wall time plus `<name>__tz`;
 * read it in a server action with `dateTime(formData, name)` from "@/lib/forms".
 */
export function DateTimeField({
  name,
  label,
  tz,
  defaultValue,
  hint,
  required,
  error,
}: {
  name: string;
  label: string;
  tz: string;
  defaultValue?: string | null;
  hint?: string;
  required?: boolean;
  error?: string;
}) {
  const id = `dt-${name}`;
  const zone = zoneAbbreviation(defaultValue ?? new Date(), tz);
  return (
    <Field label={label} htmlFor={id} hint={hint ? `${hint} Time zone: ${tz} (${zone}).` : `Time zone: ${tz} (${zone}).`} required={required} error={error}>
      <Input id={id} name={name} type="datetime-local" defaultValue={utcToWallTime(defaultValue, tz)} required={required} aria-describedby={`${id}-hint`} />
      <input type="hidden" name={`${name}__tz`} value={tz} />
    </Field>
  );
}
