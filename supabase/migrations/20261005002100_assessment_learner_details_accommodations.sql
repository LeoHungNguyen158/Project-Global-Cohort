-- Assessment area additions (quizzes and assignments).
--
-- 1. private.attempt_score_released: one rule for when a learner may see an individual
--    attempt's score. Scores that release immediately are visible once the attempt is
--    fully graded; otherwise only when the quiz result was published at or after the
--    attempt's final grading. get_attempt_review is replaced to use this rule (it used to
--    treat ANY earlier publication as releasing every later attempt's per-question points).
-- 2. public.quiz_learner_details: learner-safe quiz facts the attempt engine already knows
--    (total points, practice flag, per-attempt outcome, authoritative review availability).
--    It never returns questions, keys, explanations or per-question scores.
-- 3. public.set_quiz_grade_settings: gradebook points and graded/practice for a quiz's grade
--    item (quiz grade items are not writable through RLS). Changing points recomputes results.
-- 4. public.set_quiz_accommodation / clear_quiz_accommodation: staff with 'manage' permission
--    grant extra time, attempts or a later closing time. An attempt in progress is only ever
--    extended, never shortened.
-- 5. public.grade_submission_version: grades exactly the version the grader reviewed and
--    refuses if the learner submitted a newer version meanwhile; audited.
-- 6. Audit trail for quiz and assignment setting changes (dates, limits, status, policy).
-- 7. Hardening: assessment helpers in `private` are callable only by their definer callers.

-- ---------------------------------------------------------------------------
-- 1. Per-attempt score visibility
-- ---------------------------------------------------------------------------
create or replace function private.attempt_score_released(p_attempt uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.quiz_attempts a
    join public.quizzes q on q.id = a.quiz_id
    where a.id = p_attempt
      and a.status = 'graded'
      and (
        q.score_release = 'immediate'
        or exists (
          select 1
          from public.grade_items gi
          join public.released_grades rg on rg.grade_item_id = gi.id and rg.user_id = a.user_id
          where gi.quiz_id = a.quiz_id
            and rg.released_at >= greatest(
              coalesce(a.submitted_at, a.started_at),
              coalesce((select max(r.graded_at) from private.attempt_results r where r.attempt_id = a.id), a.submitted_at, a.started_at))
        )
      )
  );
$$;
revoke execute on function private.attempt_score_released(uuid) from public, anon, authenticated;

-- Same output shape as before; only the score visibility rule changed.
create or replace function public.get_attempt_review(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  a public.quiz_attempts;
  is_staff boolean;
  allowed boolean;
  score_released boolean;
begin
  select * into a from public.quiz_attempts where id = p_attempt;
  if not found then raise exception 'Attempt not found' using errcode = '42501'; end if;
  is_staff := private.has_staff_perm(a.offering_id, 'grade');
  if a.user_id <> uid and not is_staff then
    raise exception 'Attempt not found' using errcode = '42501';
  end if;
  allowed := is_staff or private.review_allowed(a.id);
  score_released := is_staff or private.attempt_score_released(a.id);
  return jsonb_build_object(
    'id', a.id, 'quiz_id', a.quiz_id, 'attempt_no', a.attempt_no, 'status', a.status, 'submitted_at', a.submitted_at,
    'finalized_reason', a.finalized_reason, 'review_available', allowed, 'scores_visible', allowed and score_released,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'type', q.type, 'prompt', q.prompt, 'points', q.points, 'choices', q.choices,
        'response', ans.response,
        'correct', case when allowed then to_jsonb(k.correct_choice_ids) end,
        'explanation', case when allowed then k.explanation end,
        'earned', case when allowed and score_released then coalesce(r.manual_points, r.auto_points) end,
        'needs_manual', r.needs_manual and r.manual_points is null,
        'feedback', case when allowed and score_released then r.feedback end) order by ord.n)
      from unnest(a.question_order) with ordinality as ord(qid, n)
      join public.questions q on q.id = ord.qid
      left join public.attempt_answers ans on ans.attempt_id = a.id and ans.question_id = q.id
      left join private.answer_keys k on k.question_id = q.id
      left join private.attempt_results r on r.attempt_id = a.id and r.question_id = q.id), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 2. Learner-safe quiz details
-- ---------------------------------------------------------------------------
create or replace function public.quiz_learner_details(p_quiz uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  qz public.quizzes;
  item public.grade_items;
  rel public.released_grades;
begin
  select * into qz from public.quizzes where id = p_quiz;
  if not found or not (private.has_staff_perm(qz.offering_id, 'view')
                       or (qz.status = 'published' and private.can_view_offering(qz.offering_id))) then
    raise exception 'Quiz not found' using errcode = '42501';
  end if;
  -- Lazy expiry, as in quiz_overview: an overdue attempt is finalized with its saved answers.
  perform private.finalize_expired(p_quiz, uid);
  select * into item from public.grade_items where quiz_id = p_quiz;
  select * into rel from public.released_grades where grade_item_id = item.id and user_id = uid;
  return jsonb_build_object(
    'quiz_id', qz.id,
    'version_no', (select v.version_no from public.quiz_versions v where v.id = qz.current_version_id),
    'question_count', (select count(*) from public.questions q where q.quiz_version_id = qz.current_version_id),
    'total_points', (select coalesce(sum(q.points), 0) from public.questions q where q.quiz_version_id = qz.current_version_id),
    'counts_toward_total', coalesce(item.counts_toward_total, true),
    'grade_max_points', item.max_points,
    'score_release', qz.score_release,
    'answers_released_at', qz.answers_released_at,
    'released', case when rel.grade_id is null then null else jsonb_build_object(
      'status', rel.status, 'points', rel.points, 'max_points', rel.max_points, 'released_at', rel.released_at) end,
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'attempt_no', a.attempt_no, 'status', a.status, 'started_at', a.started_at, 'deadline_at', a.deadline_at,
        'submitted_at', a.submitted_at, 'finalized_reason', a.finalized_reason, 'version_no', v.version_no,
        'pending_manual', (select count(*) from private.attempt_results r
                           where r.attempt_id = a.id and r.needs_manual and r.manual_points is null),
        'review_available', private.review_allowed(a.id),
        'score_visible', s.visible,
        'score', case when s.visible then (select sum(coalesce(r.manual_points, r.auto_points, 0)) from private.attempt_results r where r.attempt_id = a.id) end,
        'max_score', case when s.visible then (select sum(r.max_points) from private.attempt_results r where r.attempt_id = a.id) end
      ) order by a.attempt_no)
      from public.quiz_attempts a
      join public.quiz_versions v on v.id = a.quiz_version_id
      cross join lateral (select private.attempt_score_released(a.id) as visible) s
      where a.quiz_id = p_quiz and a.user_id = uid), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 3. Quiz grade item settings
-- ---------------------------------------------------------------------------
create or replace function public.set_quiz_grade_settings(p_quiz uuid, p_max_points numeric, p_counts_toward_total boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  qz public.quizzes;
  item public.grade_items;
  new_max numeric := round(p_max_points, 2);
  new_counts boolean := coalesce(p_counts_toward_total, true);
  r record;
begin
  perform private.require_user();
  select * into qz from public.quizzes where id = p_quiz;
  if not found or not private.has_staff_perm(qz.offering_id, 'author') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if new_max is null or new_max <= 0 or new_max > 10000 then
    raise exception 'Gradebook points must be between 0.01 and 10000';
  end if;
  select * into item from public.grade_items where quiz_id = p_quiz for update;
  if item.max_points = new_max and item.counts_toward_total = new_counts then
    return;
  end if;
  update public.grade_items set max_points = new_max, counts_toward_total = new_counts where id = item.id;
  if item.max_points <> new_max then
    -- Results are stored as points of the grade item: recompute them and mark them changed
    -- so released results are republished (immediately when the quiz releases scores immediately).
    update public.grades set dirty = true where grade_item_id = item.id and status <> 'pending' and source_attempt_id is not null;
    for r in select distinct a.user_id from public.quiz_attempts a where a.quiz_id = p_quiz loop
      perform private.recompute_quiz_grade(p_quiz, r.user_id);
    end loop;
  end if;
  perform private.audit('quiz.grade_settings', 'grade_items', item.id::text, qz.offering_id, null,
    jsonb_build_object('quiz_id', p_quiz,
                       'max_points', jsonb_build_object('from', item.max_points, 'to', new_max),
                       'counts_toward_total', jsonb_build_object('from', item.counts_toward_total, 'to', new_counts)));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Accommodations
-- ---------------------------------------------------------------------------
create or replace function public.set_quiz_accommodation(p_quiz uuid, p_user uuid, p_extra_minutes integer, p_extra_attempts integer,
                                                        p_extended_closes_at timestamptz, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  qz public.quizzes;
  r record;
  new_deadline timestamptz;
  extended integer := 0;
begin
  select * into qz from public.quizzes where id = p_quiz;
  if not found or not private.has_staff_perm(qz.offering_id, 'manage') then
    raise exception 'Only instructors and administrators can grant accommodations' using errcode = '42501';
  end if;
  if not exists (select 1 from public.enrollments e where e.offering_id = qz.offering_id and e.user_id = p_user) then
    raise exception 'This person is not enrolled in this course';
  end if;
  if coalesce(p_extra_minutes, 0) not between 0 and 10000 then
    raise exception 'Extra time must be between 0 and 10000 minutes';
  end if;
  if coalesce(p_extra_attempts, 0) not between 0 and 100 then
    raise exception 'Extra attempts must be between 0 and 100';
  end if;
  if p_extended_closes_at is not null then
    if qz.closes_at is null then
      raise exception 'This quiz has no closing time to extend';
    end if;
    if p_extended_closes_at <= qz.closes_at then
      raise exception 'The extended closing time must be later than the quiz closing time';
    end if;
  end if;
  -- An attempt whose deadline already passed is finalized first; time is never given back to it.
  perform private.finalize_expired(p_quiz, p_user);
  insert into public.quiz_accommodations (quiz_id, user_id, extra_minutes, extra_attempts, extended_closes_at, note, granted_by)
  values (p_quiz, p_user, coalesce(p_extra_minutes, 0), coalesce(p_extra_attempts, 0), p_extended_closes_at, left(coalesce(p_note, ''), 1000), uid)
  on conflict (quiz_id, user_id) do update set
    extra_minutes = excluded.extra_minutes, extra_attempts = excluded.extra_attempts,
    extended_closes_at = excluded.extended_closes_at, note = excluded.note, granted_by = excluded.granted_by;
  -- An attempt in progress is only ever extended, never shortened.
  for r in select a.id, a.started_at, a.deadline_at from public.quiz_attempts a
           where a.quiz_id = p_quiz and a.user_id = p_user and a.status = 'in_progress' for update loop
    new_deadline := private.compute_deadline(p_quiz, p_user, r.started_at);
    if r.deadline_at is not null and (new_deadline is null or new_deadline > r.deadline_at) then
      update public.quiz_attempts set deadline_at = new_deadline where id = r.id;
      extended := extended + 1;
      perform private.audit('quiz_attempt.extend', 'quiz_attempts', r.id::text, qz.offering_id, null,
        jsonb_build_object('from', r.deadline_at, 'to', new_deadline));
    end if;
  end loop;
  return jsonb_build_object('extended_attempts', extended);
end $$;

create or replace function public.clear_quiz_accommodation(p_quiz uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  qz public.quizzes;
begin
  perform private.require_user();
  select * into qz from public.quizzes where id = p_quiz;
  if not found or not private.has_staff_perm(qz.offering_id, 'manage') then
    raise exception 'Only instructors and administrators can change accommodations' using errcode = '42501';
  end if;
  -- Attempts already in progress keep their deadline.
  delete from public.quiz_accommodations where quiz_id = p_quiz and user_id = p_user;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Version-checked grading
-- ---------------------------------------------------------------------------
create or replace function public.grade_submission_version(p_submission uuid, p_version_no integer, p_points numeric, p_feedback text,
                                                          p_rubric jsonb, p_return boolean, p_return_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.submissions;
begin
  perform private.require_user();
  select * into s from public.submissions where id = p_submission for update;
  if not found or s.status = 'draft' or not private.has_staff_perm(s.offering_id, 'grade') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_version_no is distinct from s.submitted_count then
    raise exception 'The learner submitted version % while you were grading. Review it before saving.', s.submitted_count;
  end if;
  perform public.grade_submission(p_submission, p_points, p_feedback, p_rubric, coalesce(p_return, false), p_return_note);
  if not coalesce(p_return, false) then
    perform private.audit('submission.grade', 'submissions', s.id::text, s.offering_id, null,
      jsonb_build_object('version_no', p_version_no, 'points', p_points));
  end if;
  return jsonb_build_object('status', (select status from public.submissions where id = p_submission), 'version_no', p_version_no);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Audit of assessment settings (direct table writes are authorized by RLS)
-- ---------------------------------------------------------------------------
create or replace function private.audit_assessment_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  watched text[];
  changed jsonb := '{}'::jsonb;
  k text;
  o jsonb;
  n jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.audit(tg_table_name || '.create', tg_table_name, new.id::text, new.offering_id, null,
      jsonb_build_object('title', new.title, 'status', new.status));
    return new;
  end if;
  watched := case tg_table_name
    when 'quizzes' then array['title', 'status', 'available_from', 'closes_at', 'time_limit_minutes', 'attempt_limit', 'pass_pct',
                              'shuffle_questions', 'shuffle_choices', 'review_policy', 'score_release', 'scoring_rule', 'truncate_at_close']
    else array['title', 'status', 'submission_types', 'points', 'rubric', 'available_from', 'due_at', 'closes_at', 'late_policy', 'max_submissions']
  end;
  o := to_jsonb(old);
  n := to_jsonb(new);
  foreach k in array watched loop
    if (o -> k) is distinct from (n -> k) then
      changed := changed || jsonb_build_object(k, jsonb_build_object('from', o -> k, 'to', n -> k));
    end if;
  end loop;
  if changed <> '{}'::jsonb then
    perform private.audit(tg_table_name || '.update', tg_table_name, new.id::text, new.offering_id, null, jsonb_build_object('changed', changed));
  end if;
  return new;
end $$;
revoke execute on function private.audit_assessment_settings() from public, anon, authenticated;

drop trigger if exists quizzes_settings_audit on public.quizzes;
create trigger quizzes_settings_audit after insert or update on public.quizzes
  for each row execute function private.audit_assessment_settings();
drop trigger if exists assignments_settings_audit on public.assignments;
create trigger assignments_settings_audit after insert or update on public.assignments
  for each row execute function private.audit_assessment_settings();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.quiz_learner_details(uuid) from public, anon;
revoke execute on function public.set_quiz_grade_settings(uuid, numeric, boolean) from public, anon;
revoke execute on function public.set_quiz_accommodation(uuid, uuid, integer, integer, timestamptz, text) from public, anon;
revoke execute on function public.clear_quiz_accommodation(uuid, uuid) from public, anon;
revoke execute on function public.grade_submission_version(uuid, integer, numeric, text, jsonb, boolean, text) from public, anon;
grant execute on function
  public.get_attempt_review(uuid),
  public.quiz_learner_details(uuid),
  public.set_quiz_grade_settings(uuid, numeric, boolean),
  public.set_quiz_accommodation(uuid, uuid, integer, integer, timestamptz, text),
  public.clear_quiz_accommodation(uuid, uuid),
  public.grade_submission_version(uuid, integer, numeric, text, jsonb, boolean, text)
to authenticated;

-- 7. Engine helpers run only inside the security definer functions above (as their owner);
-- API roles never call them directly.
revoke execute on function
  private.quiz_offering_for_version(uuid),
  private.effective_close(uuid, uuid),
  private.compute_deadline(uuid, uuid, timestamptz),
  private.recompute_quiz_grade(uuid, uuid),
  private.finalize_attempt(uuid, text),
  private.finalize_expired(uuid, uuid),
  private.review_allowed(uuid),
  private.validate_submission_assets(uuid[], uuid, uuid)
from public, anon, authenticated;
