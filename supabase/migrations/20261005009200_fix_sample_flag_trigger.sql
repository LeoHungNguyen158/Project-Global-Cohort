-- private.inherit_sample_flag() read new.cohort_id and new.course_id in one expression with
-- the table-name test, and PL/pgSQL resolves every field in an expression: on cohorts and
-- courses (which have no such columns) an insert by anyone who is not a sample account failed
-- with 'record "new" has no field "cohort_id"'. The offering checks now run only for offerings.
create or replace function private.inherit_sample_flag() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_sample then
    return new;
  end if;
  if private.actor_is_sample() then
    new.is_sample := true;
  elsif tg_table_name = 'course_offerings' then
    if exists (select 1 from public.cohorts c where c.id = new.cohort_id and c.is_sample)
       or exists (select 1 from public.courses c where c.id = new.course_id and c.is_sample) then
      new.is_sample := true;
    end if;
  end if;
  return new;
end $$;
