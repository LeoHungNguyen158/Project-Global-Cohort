-- Learning stream: a lesson condition that requires a quiz score no longer reveals a quiz
-- learners cannot see. While the quiz is not published, the lock reason carries no quiz
-- id or title (only "quiz_open": false), so learners read "a quiz that has not opened
-- yet" instead of a draft quiz's title and a link that would not open. Everything else
-- is unchanged from 20261005001000_learning_release_and_progress.sql.

create or replace function private.lesson_rule_reasons(p_offering uuid, p_lineage uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
  reasons jsonb := '[]'::jsonb;
  pct numeric;
  v_starts timestamptz;
  v_open boolean;
begin
  -- Content opens at the offering's start date.
  select o.starts_at into v_starts from public.course_offerings o where o.id = p_offering;
  if v_starts is not null and v_starts > now() then
    reasons := reasons || jsonb_build_object('kind', 'offering_start', 'starts_at', v_starts);
  end if;
  for r in
    select pr.*, l.title as required_title, l.id as required_lesson_id, q.title as quiz_title, q.status as quiz_status
    from public.prerequisite_rules pr
    left join public.course_offerings o on o.id = pr.offering_id
    left join public.lessons l on l.course_version_id = o.course_version_id and l.lineage_id = pr.required_lesson_lineage
    left join public.quizzes q on q.id = pr.quiz_id
    where pr.offering_id = p_offering and pr.target_lesson_lineage = p_lineage
    order by pr.created_at
  loop
    if r.kind = 'release_at' and r.release_at > now() then
      reasons := reasons || jsonb_build_object('kind', 'release_at', 'release_at', r.release_at);
    elsif r.kind = 'lesson_complete' and not exists (
      select 1 from public.lesson_progress lp
      where lp.offering_id = p_offering and lp.user_id = p_user
        and lp.lesson_lineage = r.required_lesson_lineage and lp.completed_at is not null
    ) then
      reasons := reasons || jsonb_build_object('kind', 'lesson_complete', 'lesson_id', r.required_lesson_id,
                                               'lesson_title', coalesce(r.required_title, 'a previous lesson'));
    elsif r.kind = 'quiz_min_score' then
      pct := private.released_quiz_pct(r.quiz_id, p_user);
      if pct is null or pct < r.min_score_pct then
        v_open := r.quiz_status = 'published';
        reasons := reasons || jsonb_build_object('kind', 'quiz_min_score',
                                                 'quiz_id', case when v_open then r.quiz_id end,
                                                 'quiz_title', case when v_open then r.quiz_title end,
                                                 'quiz_open', coalesce(v_open, false),
                                                 'min_score_pct', r.min_score_pct,
                                                 'current_pct', pct);
      end if;
    end if;
  end loop;
  return reasons;
end $$;

revoke execute on function private.lesson_rule_reasons(uuid, uuid, uuid) from public, anon, authenticated;
