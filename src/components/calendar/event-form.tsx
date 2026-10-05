"use client";
import { useActionState, useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/datetime-field";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { submitWithoutReset } from "@/components/ui/submit-without-reset";
import { createEvent, updateEvent } from "@/app/actions/calendar";
import type { ActionResult } from "@/lib/errors";
import { t } from "@/i18n/client/grades";
import type { EventManage, ManageScope } from "./types";

const KIND_OPTIONS = [
  ["live_session", "cal.kind.liveSession"],
  ["office_hours", "cal.kind.officeHours"],
  ["event", "cal.kind.event"],
] as const;

/**
 * Create or edit a course or cohort event. Start and end are wall times in the chosen
 * IANA zone (default: the course or cohort zone); the server converts them to UTC.
 */
export function EventForm({
  scope,
  event,
  timezones,
  onDone,
}: {
  scope?: ManageScope;
  event?: EventManage;
  timezones: string[];
  onDone: (message: string) => void;
}) {
  const [tz, setTz] = useState(event?.timezone ?? scope?.defaultTz ?? "UTC");
  const [state, formAction] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const r = await (event ? updateEvent(prev, fd) : createEvent(prev, fd));
    if (r.ok) onDone(r.message ?? "");
    return r;
  }, null);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};
  const base = useId();
  const zones = Array.from(new Set([tz, ...(scope ? [scope.defaultTz] : []), ...timezones]));
  const described = (id: string, hint: boolean, field: string) =>
    [hint ? `${id}-hint` : "", fe[field] ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} className="space-y-4" noValidate>
      {event ? (
        <input type="hidden" name="event_id" value={event.eventId} />
      ) : scope ? (
        <>
          <input type="hidden" name="scope_type" value={scope.scopeType} />
          <input type="hidden" name="scope_id" value={scope.scopeId} />
        </>
      ) : null}
      <Field label={t("cal.form.title")} htmlFor={`${base}-title`} required error={fe.title}>
        <Input
          id={`${base}-title`}
          name="title"
          required
          maxLength={300}
          defaultValue={event?.title ?? ""}
          aria-invalid={fe.title ? true : undefined}
          aria-describedby={described(`${base}-title`, false, "title")}
        />
      </Field>
      <Field label={t("cal.form.kind")} htmlFor={`${base}-kind`} error={fe.kind}>
        <Select id={`${base}-kind`} name="kind" defaultValue={event?.kind ?? "live_session"}>
          {KIND_OPTIONS.map(([value, key]) => (
            <option key={value} value={value}>{t(key)}</option>
          ))}
        </Select>
      </Field>
      <Field label={t("cal.form.timezone")} htmlFor={`${base}-tz`} hint={t("cal.form.timezoneHint")} error={fe.timezone}>
        <Select
          id={`${base}-tz`}
          name="timezone"
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          aria-describedby={described(`${base}-tz`, true, "timezone")}
        >
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <DateTimeField name="starts_at" label={t("cal.form.start")} tz={tz} defaultValue={event?.startsAt} required error={fe.starts_at} />
        <DateTimeField name="ends_at" label={t("cal.form.end")} tz={tz} defaultValue={event?.endsAt} required error={fe.ends_at} />
      </div>
      <Field label={t("cal.form.location")} htmlFor={`${base}-location`} error={fe.location}>
        <Input
          id={`${base}-location`}
          name="location"
          maxLength={300}
          defaultValue={event?.location ?? ""}
          aria-invalid={fe.location ? true : undefined}
          aria-describedby={described(`${base}-location`, false, "location")}
        />
      </Field>
      <Field label={t("cal.form.meeting")} htmlFor={`${base}-meeting`} hint={t("cal.form.meetingHint")} error={fe.meeting_url}>
        <Input
          id={`${base}-meeting`}
          name="meeting_url"
          type="url"
          inputMode="url"
          placeholder="https://"
          maxLength={2000}
          defaultValue={event?.meetingUrl ?? ""}
          aria-invalid={fe.meeting_url ? true : undefined}
          aria-describedby={described(`${base}-meeting`, true, "meeting_url")}
        />
      </Field>
      <Field label={t("cal.form.description")} htmlFor={`${base}-description`} error={fe.description}>
        <Textarea
          id={`${base}-description`}
          name="description"
          maxLength={5000}
          defaultValue={event?.description ?? ""}
          aria-invalid={fe.description ? true : undefined}
          aria-describedby={described(`${base}-description`, false, "description")}
        />
      </Field>
      {state && !state.ok && Object.keys(fe).length === 0 ? <Alert tone="error">{state.error}</Alert> : null}
      <div className="flex justify-end">
        <SubmitButton>{event ? t("cal.form.save") : t("cal.form.create")}</SubmitButton>
      </div>
    </form>
  );
}

/** "Add event" button with its dialog; announces the server's confirmation. */
export function AddEventButton({ scope, timezones }: { scope: ManageScope; timezones: string[] }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" className={buttonClass("primary")} onClick={() => setOpen(true)}>
        {t("cal.addEvent")}
      </button>
      <div aria-live="polite" className="empty:hidden">
        {message ? <Alert tone="success">{message}</Alert> : null}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("cal.addEventTitle")} description={t("cal.addEventDescription", { scope: scope.scopeWord })} wide>
        {open ? (
          <EventForm
            scope={scope}
            timezones={timezones}
            onDone={(m) => {
              setMessage(m);
              setOpen(false);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
