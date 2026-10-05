-- Grades & calendar stream: calendar event lifecycle.
--
-- Staff can cancel an event instead of deleting it: a cancelled event stays visible
-- (marked "Cancelled") so learners who saw or downloaded it learn about the change, and
-- it can be restored. Every change increments SEQUENCE so a re-downloaded .ics replaces
-- the copy in a person's calendar application (RFC 5545). Event changes are audited.
-- Authorization is unchanged: the existing calendar_write policy (offering staff with the
-- communicate permission, or cohort administrators) still governs every insert/update/delete.

alter table public.calendar_events
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles (id),
  add column if not exists cancel_reason text not null default '' check (char_length(cancel_reason) <= 500),
  add column if not exists sequence integer not null default 0 check (sequence >= 0),
  add column if not exists updated_at timestamptz not null default now();

comment on column public.calendar_events.cancelled_at is 'Set when staff cancel the event; cancelled events stay listed as cancelled.';
comment on column public.calendar_events.sequence is 'iCalendar SEQUENCE: incremented on every change so downloaded .ics files update.';

create index if not exists calendar_events_offering_starts_idx on public.calendar_events (offering_id, starts_at) where offering_id is not null;
create index if not exists calendar_events_cohort_starts_idx on public.calendar_events (cohort_id, starts_at) where cohort_id is not null;

-- Server-owned fields: creator, cancellation actor/time and the sequence number cannot be
-- supplied by the client; an event cannot move to another course or cohort.
create or replace function private.guard_calendar_event() returns trigger
language plpgsql set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if uid is not null then
      new.created_by := uid;
    end if;
    new.sequence := 0;
    new.updated_at := now();
    if new.cancelled_at is null then
      new.cancelled_by := null;
      new.cancel_reason := '';
    else
      new.cancelled_at := now();
      new.cancelled_by := coalesce(uid, new.cancelled_by);
    end if;
    return new;
  end if;

  if new.offering_id is distinct from old.offering_id or new.cohort_id is distinct from old.cohort_id then
    raise exception 'An event cannot be moved to another course or cohort' using errcode = 'P0001';
  end if;
  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if new.cancelled_at is null then
    new.cancelled_by := null;
    new.cancel_reason := '';
  elsif old.cancelled_at is null then
    new.cancelled_at := now();
    new.cancelled_by := coalesce(uid, new.cancelled_by);
  else
    new.cancelled_at := old.cancelled_at;
    new.cancelled_by := old.cancelled_by;
  end if;
  if (to_jsonb(new) - 'sequence' - 'updated_at') is distinct from (to_jsonb(old) - 'sequence' - 'updated_at') then
    new.sequence := old.sequence + 1;
    new.updated_at := now();
  else
    new.sequence := old.sequence;
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;
revoke execute on function private.guard_calendar_event() from public, anon, authenticated;

drop trigger if exists calendar_events_guard on public.calendar_events;
create trigger calendar_events_guard before insert or update on public.calendar_events
  for each row execute function private.guard_calendar_event();

drop trigger if exists calendar_events_audit on public.calendar_events;
create trigger calendar_events_audit after insert or update or delete on public.calendar_events
  for each row execute function private.audit_row_change();
