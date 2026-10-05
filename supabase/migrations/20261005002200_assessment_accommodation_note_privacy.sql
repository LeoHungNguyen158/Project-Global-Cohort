-- Accommodation notes are for staff only. Learners may read their own accommodation row
-- (RLS policy accommodations_select), so the note column is withheld from the API roles and
-- staff read accommodations, notes included, through public.staff_quiz_accommodations,
-- which checks the caller's staff permission for the quiz's offering.

revoke select on public.quiz_accommodations from anon, authenticated;
grant select (quiz_id, user_id, extra_minutes, extended_closes_at, extra_attempts, granted_by, created_at)
  on public.quiz_accommodations to authenticated;

create or replace function public.staff_quiz_accommodations(p_quiz uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  off uuid;
begin
  perform private.require_user();
  select offering_id into off from public.quizzes where id = p_quiz;
  if off is null or not private.has_staff_perm(off, 'view') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', a.user_id,
             'display_name', p.display_name,
             'extra_minutes', a.extra_minutes,
             'extra_attempts', a.extra_attempts,
             'extended_closes_at', a.extended_closes_at,
             'note', a.note,
             'created_at', a.created_at)
           order by p.display_name)
    from public.quiz_accommodations a
    join public.profiles p on p.id = a.user_id
    where a.quiz_id = p_quiz), '[]'::jsonb);
end $$;
revoke execute on function public.staff_quiz_accommodations(uuid) from public, anon;
grant execute on function public.staff_quiz_accommodations(uuid) to authenticated;
