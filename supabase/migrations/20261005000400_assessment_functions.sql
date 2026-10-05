-- Quizzes, assignments and grades. The server (database) owns time windows,
-- attempt limits, scoring and release; the browser countdown is informative only.

alter table public.submission_versions add column client_key text;
create unique index submission_versions_client_key on public.submission_versions (submission_id, client_key) where client_key is not null;
alter table public.submissions add column return_note text not null default '';

-- ---------------------------------------------------------------------------
-- Grade items follow their assessments
-- ---------------------------------------------------------------------------
create or replace function private.sync_assignment_grade_item() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.grade_items (offering_id, kind, assignment_id, title, max_points)
    values (new.offering_id, 'assignment', new.id, new.title, new.points);
  else
    update public.grade_items set title = new.title, max_points = new.points where assignment_id = new.id;
  end if;
  return new;
end $$;
create trigger assignments_grade_item after insert or update of title, points on public.assignments
  for each row execute function private.sync_assignment_grade_item();

create or replace function private.init_quiz() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.quiz_versions (quiz_id, version_no, status) values (new.id, 1, 'draft');
  insert into public.grade_items (offering_id, kind, quiz_id, title, max_points) values (new.offering_id, 'quiz', new.id, new.title, 100);
  return new;
end $$;
create trigger quizzes_init after insert on public.quizzes for each row execute function private.init_quiz();

create or replace function private.sync_quiz_title() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.grade_items set title = new.title where quiz_id = new.id;
  return new;
end $$;
create trigger quizzes_title after update of title on public.quizzes for each row execute function private.sync_quiz_title();

-- Quiz settings that change attempt semantics cannot be edited directly once attempts exist
-- except through explicit fields staff are expected to adjust (dates, release).
create or replace function private.guard_quiz_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.purge_allowed() then return new; end if;
  if new.offering_id <> old.offering_id then
    raise exception 'A quiz cannot move between offerings';
  end if;
  if new.current_version_id is distinct from old.current_version_id and current_setting('app.quiz_publish', true) is distinct from 'on' then
    raise exception 'Use publish_quiz_version to change the active quiz version';
  end if;
  if new.scoring_rule <> old.scoring_rule and exists (select 1 from public.quiz_attempts a where a.quiz_id = new.id and a.status <> 'in_progress') then
    raise exception 'The scoring rule is fixed once attempts have been submitted';
  end if;
  return new;
end $$;
create trigger quizzes_guard before update on public.quizzes for each row execute function private.guard_quiz_update();

-- Questions of published versions are immutable.
create or replace function private.guard_question() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.purge_allowed() then return coalesce(new, old); end if;
  if (select status from public.quiz_versions where id = coalesce(new.quiz_version_id, old.quiz_version_id)) <> 'draft' then
    raise exception 'Published quiz versions cannot be edited; create a new draft version';
  end if;
  return coalesce(new, old);
end $$;
create trigger questions_guard before insert or update or delete on public.questions for each row execute function private.guard_question();

-- ---------------------------------------------------------------------------
-- Quiz authoring
-- ---------------------------------------------------------------------------
create or replace function private.quiz_offering_for_version(p_version uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select q.offering_id from public.quiz_versions qv join public.quizzes q on q.id = qv.quiz_id where qv.id = p_version;
$$;

create or replace function public.upsert_question(p_version uuid, p_question uuid, p_type text, p_prompt text, p_points numeric,
  p_choices jsonb, p_correct text[], p_explanation text, p_position integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  qid uuid;
  ids text[];
  v_choices jsonb := coalesce(p_choices, '[]'::jsonb);
begin
  perform private.require_user();
  if not private.has_staff_perm(private.quiz_offering_for_version(p_version), 'author') then
    raise exception 'Not authorized to author this quiz' using errcode = '42501';
  end if;
  if p_type not in ('single_choice', 'multiple_select', 'true_false', 'short_answer') then
    raise exception 'Unsupported question type';
  end if;
  if p_type = 'true_false' then
    v_choices := '[{"id":"true","text":"True"},{"id":"false","text":"False"}]'::jsonb;
  elsif p_type = 'short_answer' then
    v_choices := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_choices) <> 'array' then raise exception 'Choices must be a list'; end if;
  select coalesce(array_agg(c ->> 'id'), '{}') into ids from jsonb_array_elements(v_choices) c;
  if p_type in ('single_choice', 'multiple_select') then
    if cardinality(ids) < 2 or cardinality(ids) > 20 then raise exception 'Provide between 2 and 20 choices'; end if;
    if (select count(distinct x) from unnest(ids) x) <> cardinality(ids) or exists (select 1 from unnest(ids) x where x is null or x = '') then
      raise exception 'Choice ids must be unique and non-empty';
    end if;
    if exists (select 1 from jsonb_array_elements(v_choices) c where coalesce(trim(c ->> 'text'), '') = '') then
      raise exception 'Every choice needs text';
    end if;
  end if;
  if p_type <> 'short_answer' then
    if p_correct is null or cardinality(p_correct) = 0 or not (p_correct <@ ids) then
      raise exception 'Mark the correct answer(s) from the listed choices';
    end if;
    if p_type in ('single_choice', 'true_false') and cardinality(p_correct) <> 1 then
      raise exception 'Single choice and true/false questions need exactly one correct answer';
    end if;
  end if;
  -- Store only id/text for choices (strip any other keys a client might send).
  select coalesce(jsonb_agg(jsonb_build_object('id', c ->> 'id', 'text', left(c ->> 'text', 2000))), '[]'::jsonb)
    into v_choices from jsonb_array_elements(v_choices) c;

  if p_question is null then
    insert into public.questions (quiz_version_id, position, type, prompt, points, choices)
    values (p_version, coalesce(p_position, (select coalesce(max(position), -1) + 1 from public.questions where quiz_version_id = p_version)),
            p_type, p_prompt, coalesce(p_points, 1), v_choices)
    returning id into qid;
  else
    update public.questions set type = p_type, prompt = p_prompt, points = coalesce(p_points, points), choices = v_choices,
      position = coalesce(p_position, position)
    where id = p_question and quiz_version_id = p_version
    returning id into qid;
    if qid is null then raise exception 'Question not found in this version'; end if;
  end if;
  insert into private.answer_keys (question_id, correct_choice_ids, explanation)
  values (qid, case when p_type = 'short_answer' then '{}' else p_correct end, coalesce(p_explanation, ''))
  on conflict (question_id) do update set correct_choice_ids = excluded.correct_choice_ids, explanation = excluded.explanation;
  return qid;
end $$;

create or replace function public.delete_question(p_question uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform private.require_user();
  select quiz_version_id into v from public.questions where id = p_question;
  if v is null or not private.has_staff_perm(private.quiz_offering_for_version(v), 'author') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  delete from public.questions where id = p_question;
end $$;

create or replace function public.reorder_questions(p_version uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.has_staff_perm(private.quiz_offering_for_version(p_version), 'author') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.questions q set position = x.ord - 1
  from unnest(p_ids) with ordinality as x(id, ord)
  where q.id = x.id and q.quiz_version_id = p_version;
end $$;

create or replace function public.get_quiz_authoring(p_version uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.has_staff_perm(private.quiz_offering_for_version(p_version), 'author') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', q.id, 'position', q.position, 'type', q.type, 'prompt', q.prompt, 'points', q.points, 'choices', q.choices,
      'correct', coalesce(k.correct_choice_ids, '{}'), 'explanation', coalesce(k.explanation, '')) order by q.position)
    from public.questions q left join private.answer_keys k on k.question_id = q.id
    where q.quiz_version_id = p_version), '[]'::jsonb);
end $$;

create or replace function public.create_quiz_draft(p_quiz uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  qz public.quizzes;
  vid uuid;
  src uuid;
  r record;
  nq uuid;
begin
  perform private.require_user();
  select * into qz from public.quizzes where id = p_quiz;
  if not found or not private.has_staff_perm(qz.offering_id, 'author') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select id into vid from public.quiz_versions where quiz_id = p_quiz and status = 'draft';
  if vid is not null then return vid; end if;
  src := qz.current_version_id;
  insert into public.quiz_versions (quiz_id, version_no, status, instructions)
  select p_quiz, coalesce(max(version_no), 0) + 1, 'draft', coalesce((select instructions from public.quiz_versions where id = src), '')
  from public.quiz_versions where quiz_id = p_quiz
  returning id into vid;
  for r in select q.*, k.correct_choice_ids, k.explanation from public.questions q
           left join private.answer_keys k on k.question_id = q.id where q.quiz_version_id = src loop
    insert into public.questions (quiz_version_id, lineage_id, position, type, prompt, points, choices)
    values (vid, r.lineage_id, r.position, r.type, r.prompt, r.points, r.choices) returning id into nq;
    insert into private.answer_keys (question_id, correct_choice_ids, explanation)
    values (nq, coalesce(r.correct_choice_ids, '{}'), coalesce(r.explanation, ''));
  end loop;
  return vid;
end $$;

create or replace function public.update_quiz_instructions(p_version uuid, p_instructions text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.has_staff_perm(private.quiz_offering_for_version(p_version), 'author') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.quiz_versions set instructions = left(coalesce(p_instructions, ''), 20000) where id = p_version and status = 'draft';
  if not found then raise exception 'Only draft versions can be edited'; end if;
end $$;

create or replace function public.publish_quiz_version(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  qv public.quiz_versions;
  qz public.quizzes;
begin
  select * into qv from public.quiz_versions where id = p_version for update;
  select * into qz from public.quizzes where id = qv.quiz_id for update;
  if qz.id is null or not private.has_staff_perm(qz.offering_id, 'author') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if qv.status <> 'draft' then raise exception 'Only drafts can be published'; end if;
  if not exists (select 1 from public.questions where quiz_version_id = p_version) then
    raise exception 'Add at least one question before publishing';
  end if;
  if exists (select 1 from public.questions q left join private.answer_keys k on k.question_id = q.id
             where q.quiz_version_id = p_version and q.type <> 'short_answer' and coalesce(cardinality(k.correct_choice_ids), 0) = 0) then
    raise exception 'Every objective question needs a correct answer';
  end if;
  update public.quiz_versions set status = 'retired' where quiz_id = qz.id and status = 'published';
  update public.quiz_versions set status = 'published', published_at = now(), published_by = uid where id = p_version;
  perform set_config('app.quiz_publish', 'on', true);
  update public.quizzes set current_version_id = p_version, status = 'published' where id = qz.id;
  perform set_config('app.quiz_publish', 'off', true);
  perform private.audit('quiz.publish', 'quizzes', qz.id::text, qz.offering_id, null, jsonb_build_object('version_id', p_version, 'version_no', qv.version_no));
end $$;

-- ---------------------------------------------------------------------------
-- Attempt engine
-- ---------------------------------------------------------------------------
create or replace function private.effective_close(p_quiz uuid, p_user uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select coalesce(a.extended_closes_at, q.closes_at)
  from public.quizzes q left join public.quiz_accommodations a on a.quiz_id = q.id and a.user_id = p_user
  where q.id = p_quiz;
$$;

-- Effective deadline = earlier of (start + time limit + approved extra minutes) and the
-- effective closing time when the quiz truncates at close; a missing bound is omitted.
create or replace function private.compute_deadline(p_quiz uuid, p_user uuid, p_start timestamptz) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  q public.quizzes;
  extra integer;
  limit_deadline timestamptz;
  close_at timestamptz;
begin
  select * into q from public.quizzes where id = p_quiz;
  select coalesce(extra_minutes, 0) into extra from public.quiz_accommodations where quiz_id = p_quiz and user_id = p_user;
  extra := coalesce(extra, 0);
  close_at := private.effective_close(p_quiz, p_user);
  if q.time_limit_minutes is not null then
    limit_deadline := p_start + make_interval(mins => q.time_limit_minutes + extra);
  end if;
  if limit_deadline is null then
    return close_at;
  end if;
  if close_at is null or not q.truncate_at_close then
    return limit_deadline;
  end if;
  return least(limit_deadline, close_at);
end $$;

create or replace function private.recompute_quiz_grade(p_quiz uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  qz public.quizzes;
  item public.grade_items;
  best record;
  has_pending boolean;
  new_points numeric;
  g public.grades;
begin
  select * into qz from public.quizzes where id = p_quiz;
  select * into item from public.grade_items where quiz_id = p_quiz;
  -- Fully graded, non-voided attempts with their percentage.
  select a.id, a.attempt_no,
         round(sum(coalesce(r.manual_points, r.auto_points, 0)) / nullif(sum(r.max_points), 0) * 100, 4) as pct
  into best
  from public.quiz_attempts a
  join private.attempt_results r on r.attempt_id = a.id
  where a.quiz_id = p_quiz and a.user_id = p_user and a.status = 'graded'
  group by a.id, a.attempt_no
  order by case when qz.scoring_rule = 'highest' then round(sum(coalesce(r.manual_points, r.auto_points, 0)) / nullif(sum(r.max_points), 0) * 100, 4) end desc nulls last,
           case when qz.scoring_rule = 'highest' then a.attempt_no end asc,
           case when qz.scoring_rule = 'latest' then a.attempt_no end desc
  limit 1;
  has_pending := exists (select 1 from public.quiz_attempts a where a.quiz_id = p_quiz and a.user_id = p_user and a.status = 'submitted');

  select * into g from public.grades where grade_item_id = item.id and user_id = p_user for update;
  if best.id is null then
    if not has_pending then
      if g.id is not null and g.source_attempt_id is not null then
        update public.grades set status = 'pending', points = null, source_attempt_id = null, dirty = true where id = g.id;
      end if;
      return;
    end if;
    if g.id is null then
      insert into public.grades (grade_item_id, offering_id, user_id, status, points) values (item.id, qz.offering_id, p_user, 'pending', null);
    elsif g.source_attempt_id is not null or g.status = 'pending' then
      update public.grades set status = 'pending', points = null, source_attempt_id = null, dirty = true where id = g.id;
    end if;
    return;
  end if;
  new_points := round(best.pct / 100 * item.max_points, 2);
  if g.id is null then
    insert into public.grades (grade_item_id, offering_id, user_id, status, points, source_attempt_id, dirty)
    values (item.id, qz.offering_id, p_user, 'graded', new_points, best.id, true)
    returning * into g;
  elsif g.points is distinct from new_points or g.source_attempt_id is distinct from best.id or g.status <> 'graded' then
    update public.grades set status = 'graded', points = new_points, source_attempt_id = best.id, dirty = true
    where id = g.id returning * into g;
  end if;
  if qz.score_release = 'immediate' and g.dirty then
    perform private.release_grade(g.id, null);
  end if;
end $$;

create or replace function private.finalize_attempt(p_attempt uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.quiz_attempts;
  any_manual boolean;
begin
  select * into a from public.quiz_attempts where id = p_attempt for update;
  if a.status <> 'in_progress' then return; end if;
  insert into private.attempt_results (attempt_id, question_id, auto_points, max_points, needs_manual)
  select a.id, q.id,
    case
      when q.type = 'short_answer' then null
      when q.type in ('single_choice', 'true_false') then
        case when (ans.response ->> 'choice') is not null and array[ans.response ->> 'choice'] = k.correct_choice_ids then q.points else 0 end
      when q.type = 'multiple_select' then
        -- All-or-nothing: the selected set must equal the correct set exactly. Never negative.
        case when ans.response is not null and jsonb_typeof(ans.response -> 'choices') = 'array'
                  and (select coalesce(array_agg(distinct x order by x), '{}') from jsonb_array_elements_text(ans.response -> 'choices') x)
                      = (select coalesce(array_agg(distinct y order by y), '{}') from unnest(k.correct_choice_ids) y)
             then q.points else 0 end
    end,
    q.points,
    q.type = 'short_answer'
  from public.questions q
  left join public.attempt_answers ans on ans.attempt_id = a.id and ans.question_id = q.id
  left join private.answer_keys k on k.question_id = q.id
  where q.quiz_version_id = a.quiz_version_id
  on conflict (attempt_id, question_id) do nothing;
  any_manual := exists (select 1 from private.attempt_results r where r.attempt_id = a.id and r.needs_manual and r.manual_points is null);
  update public.quiz_attempts set
    status = case when any_manual then 'submitted' else 'graded' end,
    submitted_at = case when p_reason = 'expired' then coalesce(a.deadline_at, now()) else now() end,
    finalized_reason = p_reason
  where id = a.id;
  perform private.recompute_quiz_grade(a.quiz_id, a.user_id);
end $$;

-- Lazy expiry: finalize any overdue in-progress attempts in scope. Safe to call repeatedly.
create or replace function private.finalize_expired(p_quiz uuid, p_user uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select id from public.quiz_attempts
           where status = 'in_progress' and deadline_at is not null and deadline_at <= now()
             and (p_quiz is null or quiz_id = p_quiz) and (p_user is null or user_id = p_user)
  loop
    perform private.finalize_attempt(r.id, 'expired');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.finalize_expired_attempts(p_offering uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  r record;
  n integer := 0;
begin
  if p_offering is null then
    return private.finalize_expired(null, uid);
  end if;
  if not private.has_staff_perm(p_offering, 'view') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  for r in select id from public.quizzes where offering_id = p_offering loop
    n := n + private.finalize_expired(r.id, null);
  end loop;
  return n;
end $$;

create or replace function public.quiz_overview(p_quiz uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  qz public.quizzes;
  acc public.quiz_accommodations;
  used integer;
  allowed integer;
  in_prog public.quiz_attempts;
  close_at timestamptz;
  reason text := null;
  is_learner boolean;
begin
  select * into qz from public.quizzes where id = p_quiz;
  if not found or not (private.has_staff_perm(qz.offering_id, 'view') or (qz.status = 'published' and private.can_view_offering(qz.offering_id))) then
    raise exception 'Quiz not found' using errcode = '42501';
  end if;
  perform private.finalize_expired(p_quiz, uid);
  is_learner := private.is_active_learner(qz.offering_id);
  select * into acc from public.quiz_accommodations where quiz_id = p_quiz and user_id = uid;
  select count(*) into used from public.quiz_attempts where quiz_id = p_quiz and user_id = uid and status <> 'voided';
  allowed := qz.attempt_limit + coalesce(acc.extra_attempts, 0);
  select * into in_prog from public.quiz_attempts where quiz_id = p_quiz and user_id = uid and status = 'in_progress';
  close_at := private.effective_close(p_quiz, uid);
  if not is_learner then reason := 'not_learner';
  elsif qz.status <> 'published' then reason := 'not_published';
  elsif in_prog.id is not null then reason := null;
  elsif qz.available_from is not null and now() < qz.available_from then reason := 'not_open';
  elsif close_at is not null and now() >= close_at then reason := 'closed';
  elsif used >= allowed then reason := 'no_attempts_left';
  end if;
  return jsonb_build_object(
    'quiz_id', qz.id, 'title', qz.title, 'offering_id', qz.offering_id, 'status', qz.status,
    'instructions', (select instructions from public.quiz_versions where id = qz.current_version_id),
    'question_count', (select count(*) from public.questions where quiz_version_id = qz.current_version_id),
    'available_from', qz.available_from, 'closes_at', qz.closes_at, 'effective_closes_at', close_at,
    'time_limit_minutes', qz.time_limit_minutes, 'extra_minutes', coalesce(acc.extra_minutes, 0),
    'truncate_at_close', qz.truncate_at_close,
    'attempts_used', used, 'attempts_allowed', allowed,
    'pass_pct', qz.pass_pct, 'review_policy', qz.review_policy, 'scoring_rule', qz.scoring_rule,
    'in_progress_attempt_id', in_prog.id, 'in_progress_deadline', in_prog.deadline_at,
    'deadline_if_started_now', case when reason is null and in_prog.id is null then private.compute_deadline(p_quiz, uid, now()) end,
    'cannot_start_reason', reason,
    'server_now', now(),
    'released_pct', private.released_quiz_pct(p_quiz, uid),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'attempt_no', a.attempt_no, 'status', a.status,
                       'started_at', a.started_at, 'submitted_at', a.submitted_at, 'finalized_reason', a.finalized_reason) order by a.attempt_no)
                       from public.quiz_attempts a where a.quiz_id = p_quiz and a.user_id = uid), '[]'::jsonb)
  );
end $$;

create or replace function public.start_quiz_attempt(p_quiz uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  qz public.quizzes;
  acc public.quiz_accommodations;
  existing uuid;
  used integer;
  total integer;
  close_at timestamptz;
  qorder uuid[];
  corder jsonb := '{}'::jsonb;
  r record;
  new_id uuid;
begin
  select * into qz from public.quizzes where id = p_quiz;
  if not found or qz.status <> 'published' or qz.current_version_id is null then
    raise exception 'This quiz is not available';
  end if;
  if not private.is_active_learner(qz.offering_id) then
    raise exception 'Only actively enrolled learners can take this quiz' using errcode = '42501';
  end if;
  -- Serialize starts per learner and quiz: double clicks and parallel tabs cannot gain attempts.
  perform pg_advisory_xact_lock(hashtextextended(p_quiz::text || uid::text, 0));
  perform private.finalize_expired(p_quiz, uid);
  select id into existing from public.quiz_attempts where quiz_id = p_quiz and user_id = uid and status = 'in_progress';
  if existing is not null then
    return existing;
  end if;
  perform private.hit_rate_limit('quiz_start:' || uid, 30, 3600);
  if qz.available_from is not null and now() < qz.available_from then
    raise exception 'This quiz is not open yet';
  end if;
  close_at := private.effective_close(p_quiz, uid);
  if close_at is not null and now() >= close_at then
    raise exception 'This quiz is closed';
  end if;
  select * into acc from public.quiz_accommodations where quiz_id = p_quiz and user_id = uid;
  select count(*) filter (where status <> 'voided'), count(*) into used, total from public.quiz_attempts where quiz_id = p_quiz and user_id = uid;
  if used >= qz.attempt_limit + coalesce(acc.extra_attempts, 0) then
    raise exception 'No attempts remaining';
  end if;
  select array_agg(id order by case when qz.shuffle_questions then random() else position end) into qorder
  from public.questions where quiz_version_id = qz.current_version_id;
  if qz.shuffle_choices then
    for r in select id, choices, type from public.questions where quiz_version_id = qz.current_version_id and type in ('single_choice', 'multiple_select') loop
      corder := corder || jsonb_build_object(r.id::text, (select jsonb_agg(c ->> 'id' order by random()) from jsonb_array_elements(r.choices) c));
    end loop;
  end if;
  insert into public.quiz_attempts (quiz_id, quiz_version_id, offering_id, user_id, attempt_no, started_at, deadline_at, question_order, choice_order)
  values (p_quiz, qz.current_version_id, qz.offering_id, uid, total + 1, now(), private.compute_deadline(p_quiz, uid, now()), qorder, corder)
  returning id into new_id;
  return new_id;
end $$;

-- Learner view of an attempt: question content only (never keys or scores).
create or replace function public.get_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  a public.quiz_attempts;
begin
  select * into a from public.quiz_attempts where id = p_attempt;
  if not found or a.user_id <> uid then
    raise exception 'Attempt not found' using errcode = '42501';
  end if;
  if a.status = 'in_progress' and a.deadline_at is not null and a.deadline_at <= now() then
    perform private.finalize_attempt(a.id, 'expired');
    select * into a from public.quiz_attempts where id = p_attempt;
  end if;
  return jsonb_build_object(
    'id', a.id, 'quiz_id', a.quiz_id, 'attempt_no', a.attempt_no, 'status', a.status, 'started_at', a.started_at,
    'deadline_at', a.deadline_at, 'submitted_at', a.submitted_at, 'finalized_reason', a.finalized_reason, 'server_now', now(),
    'quiz_title', (select title from public.quizzes where id = a.quiz_id),
    'offering_id', a.offering_id,
    'instructions', (select instructions from public.quiz_versions where id = a.quiz_version_id),
    'questions', case when a.status = 'in_progress' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'type', q.type, 'prompt', q.prompt, 'points', q.points,
        'choices', case when a.choice_order ? q.id::text then
                     (select jsonb_agg(c order by array_position(array(select jsonb_array_elements_text(a.choice_order -> q.id::text)), c ->> 'id'))
                      from jsonb_array_elements(q.choices) c)
                   else q.choices end,
        'response', ans.response, 'saved_at', ans.saved_at) order by ord.n)
      from unnest(a.question_order) with ordinality as ord(qid, n)
      join public.questions q on q.id = ord.qid
      left join public.attempt_answers ans on ans.attempt_id = a.id and ans.question_id = q.id), '[]'::jsonb)
    else '[]'::jsonb end
  );
end $$;

create or replace function public.save_attempt_answer(p_attempt uuid, p_question uuid, p_response jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  a public.quiz_attempts;
  q public.questions;
  saved timestamptz;
begin
  select * into a from public.quiz_attempts where id = p_attempt for update;
  if not found or a.user_id <> uid then
    raise exception 'Attempt not found' using errcode = '42501';
  end if;
  if a.status <> 'in_progress' then
    raise exception 'This attempt is already submitted; the answer was not saved' using errcode = 'P0410';
  end if;
  if a.deadline_at is not null and now() >= a.deadline_at then
    perform private.finalize_attempt(a.id, 'expired');
    raise exception 'Time is up; this answer was not saved. Your earlier saved answers were submitted.' using errcode = 'P0410';
  end if;
  select * into q from public.questions where id = p_question and quiz_version_id = a.quiz_version_id;
  if not found then raise exception 'Question is not part of this attempt'; end if;
  -- Validate response shape.
  if p_response is not null and p_response <> 'null'::jsonb then
    if q.type in ('single_choice', 'true_false') then
      if jsonb_typeof(p_response -> 'choice') <> 'string'
         or not exists (select 1 from jsonb_array_elements(q.choices) c where c ->> 'id' = p_response ->> 'choice') then
        raise exception 'Invalid answer';
      end if;
      p_response := jsonb_build_object('choice', p_response ->> 'choice');
    elsif q.type = 'multiple_select' then
      if jsonb_typeof(p_response -> 'choices') <> 'array' or exists (
        select 1 from jsonb_array_elements_text(p_response -> 'choices') x
        where not exists (select 1 from jsonb_array_elements(q.choices) c where c ->> 'id' = x)) then
        raise exception 'Invalid answer';
      end if;
      p_response := jsonb_build_object('choices', p_response -> 'choices');
    else
      if jsonb_typeof(p_response -> 'text') <> 'string' or char_length(p_response ->> 'text') > 10000 then
        raise exception 'Answer text must be at most 10,000 characters';
      end if;
      p_response := jsonb_build_object('text', p_response ->> 'text');
    end if;
  end if;
  insert into public.attempt_answers (attempt_id, question_id, response, saved_at)
  values (a.id, q.id, coalesce(p_response, 'null'::jsonb), now())
  on conflict (attempt_id, question_id) do update set response = excluded.response, saved_at = excluded.saved_at
  returning saved_at into saved;
  return jsonb_build_object('saved_at', saved, 'deadline_at', a.deadline_at, 'server_now', now());
end $$;

create or replace function public.submit_quiz_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  a public.quiz_attempts;
begin
  select * into a from public.quiz_attempts where id = p_attempt for update;
  if not found or a.user_id <> uid then
    raise exception 'Attempt not found' using errcode = '42501';
  end if;
  if a.status = 'in_progress' then
    perform private.finalize_attempt(a.id, case when a.deadline_at is not null and now() >= a.deadline_at then 'expired' else 'submitted' end);
    select * into a from public.quiz_attempts where id = p_attempt;
  end if;
  -- Idempotent: repeated submits return the same final state.
  return jsonb_build_object('id', a.id, 'status', a.status, 'submitted_at', a.submitted_at, 'finalized_reason', a.finalized_reason);
end $$;

create or replace function private.review_allowed(p_attempt uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  a public.quiz_attempts;
  qz public.quizzes;
  close_at timestamptz;
begin
  select * into a from public.quiz_attempts where id = p_attempt;
  select * into qz from public.quizzes where id = a.quiz_id;
  if a.status not in ('submitted', 'graded') then return false; end if;
  close_at := private.effective_close(qz.id, a.user_id);
  return case qz.review_policy
    when 'never' then false
    when 'after_submit' then true
    when 'after_close' then close_at is not null and now() >= close_at
    when 'manual' then qz.answers_released_at is not null and qz.answers_released_at <= now()
  end;
end $$;

-- Review endpoint: only the permitted attempt, only after policy conditions are met.
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
  -- A learner sees per-question points only once this attempt's result has been released.
  score_released := is_staff or exists (
    select 1 from public.released_grades rg join public.grades g on g.id = rg.grade_id
    join public.grade_items gi on gi.id = rg.grade_item_id
    where gi.quiz_id = a.quiz_id and rg.user_id = a.user_id and g.source_attempt_id is not null);
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

create or replace function public.staff_quiz_attempts(p_quiz uuid) returns table (
  attempt_id uuid, user_id uuid, display_name text, attempt_no integer, status text, started_at timestamptz,
  submitted_at timestamptz, finalized_reason text, score numeric, max_score numeric, pending_manual integer)
language plpgsql security definer set search_path = '' as $$
declare off uuid;
begin
  select offering_id into off from public.quizzes where id = p_quiz;
  if not private.has_staff_perm(off, 'view') then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform private.finalize_expired(p_quiz, null);
  return query
  select a.id, a.user_id, p.display_name, a.attempt_no, a.status, a.started_at, a.submitted_at, a.finalized_reason,
         (select sum(coalesce(r.manual_points, r.auto_points, 0)) from private.attempt_results r where r.attempt_id = a.id),
         (select sum(r.max_points) from private.attempt_results r where r.attempt_id = a.id),
         (select count(*)::integer from private.attempt_results r where r.attempt_id = a.id and r.needs_manual and r.manual_points is null)
  from public.quiz_attempts a join public.profiles p on p.id = a.user_id
  where a.quiz_id = p_quiz
  order by p.display_name, a.attempt_no;
end $$;

create or replace function public.grade_attempt_question(p_attempt uuid, p_question uuid, p_points numeric, p_feedback text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  a public.quiz_attempts;
  r private.attempt_results;
begin
  select * into a from public.quiz_attempts where id = p_attempt for update;
  if not found or not private.has_staff_perm(a.offering_id, 'grade') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if a.status not in ('submitted', 'graded') then raise exception 'Only submitted attempts can be graded'; end if;
  select * into r from private.attempt_results where attempt_id = p_attempt and question_id = p_question for update;
  if not found then raise exception 'Question not in attempt'; end if;
  if p_points is null or p_points < 0 or p_points > r.max_points then
    raise exception 'Points must be between 0 and %', r.max_points;
  end if;
  update private.attempt_results set manual_points = p_points, feedback = left(coalesce(p_feedback, ''), 10000),
    graded_by = uid, graded_at = now()
  where attempt_id = p_attempt and question_id = p_question;
  if not exists (select 1 from private.attempt_results where attempt_id = p_attempt and needs_manual and manual_points is null) then
    update public.quiz_attempts set status = 'graded' where id = p_attempt and status = 'submitted';
  end if;
  perform private.audit('quiz_attempt.grade_question', 'quiz_attempts', p_attempt::text, a.offering_id, null,
    jsonb_build_object('question_id', p_question, 'from', coalesce(r.manual_points, r.auto_points), 'to', p_points));
  perform private.recompute_quiz_grade(a.quiz_id, a.user_id);
end $$;

create or replace function public.void_attempt(p_attempt uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.quiz_attempts;
begin
  perform private.require_user();
  select * into a from public.quiz_attempts where id = p_attempt for update;
  if not found or not private.has_staff_perm(a.offering_id, 'grade') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if char_length(coalesce(p_reason, '')) < 3 then raise exception 'A reason is required'; end if;
  if a.status = 'in_progress' then perform private.finalize_attempt(a.id, 'submitted'); end if;
  update public.quiz_attempts set status = 'voided' where id = p_attempt;
  perform private.audit('quiz_attempt.void', 'quiz_attempts', p_attempt::text, a.offering_id, null, jsonb_build_object('reason', p_reason));
  perform private.recompute_quiz_grade(a.quiz_id, a.user_id);
end $$;

create or replace function public.release_quiz_answers(p_quiz uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare qz public.quizzes;
begin
  perform private.require_user();
  select * into qz from public.quizzes where id = p_quiz;
  if not found or not private.has_staff_perm(qz.offering_id, 'author') then raise exception 'Not authorized' using errcode = '42501'; end if;
  update public.quizzes set answers_released_at = now() where id = p_quiz;
  perform private.audit('quiz.release_answers', 'quizzes', p_quiz::text, qz.offering_id, null, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Assignments
-- ---------------------------------------------------------------------------
create or replace function private.validate_submission_assets(p_assets uuid[], p_offering uuid, p_user uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from unnest(coalesce(p_assets, '{}')) x
             where not exists (select 1 from public.content_assets a where a.id = x and a.owner_id = p_user
                               and a.purpose = 'submission' and a.status = 'ready' and a.offering_id = p_offering)) then
    raise exception 'One or more files are not ready or not yours';
  end if;
end $$;

create or replace function public.save_submission_draft(p_assignment uuid, p_text text, p_url text, p_assets uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  asg public.assignments;
  s public.submissions;
begin
  select * into asg from public.assignments where id = p_assignment;
  if not found or asg.status <> 'published' or not private.is_active_learner(asg.offering_id) then
    raise exception 'Assignment not available' using errcode = '42501';
  end if;
  if p_url is not null and p_url <> '' and p_url !~ '^https://' then raise exception 'Links must start with https://'; end if;
  perform private.validate_submission_assets(p_assets, asg.offering_id, uid);
  insert into public.submissions (assignment_id, offering_id, user_id, draft_text, draft_url, draft_asset_ids, draft_saved_at)
  values (asg.id, asg.offering_id, uid, coalesce(p_text, ''), nullif(p_url, ''), coalesce(p_assets, '{}'), now())
  on conflict (assignment_id, user_id) do update set draft_text = excluded.draft_text, draft_url = excluded.draft_url,
    draft_asset_ids = excluded.draft_asset_ids, draft_saved_at = now()
  returning * into s;
  return jsonb_build_object('submission_id', s.id, 'draft_saved_at', s.draft_saved_at);
end $$;

create or replace function public.submit_assignment(p_assignment uuid, p_client_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  asg public.assignments;
  s public.submissions;
  v public.submission_versions;
  late boolean;
  r record;
begin
  select * into asg from public.assignments where id = p_assignment;
  if not found or asg.status <> 'published' or not private.is_active_learner(asg.offering_id) then
    raise exception 'Assignment not available' using errcode = '42501';
  end if;
  select * into s from public.submissions where assignment_id = p_assignment and user_id = uid for update;
  if not found then raise exception 'Save your work before submitting'; end if;
  if p_client_key is not null then
    select * into v from public.submission_versions where submission_id = s.id and client_key = p_client_key;
    if found then
      return jsonb_build_object('version_no', v.version_no, 'receipt_code', v.receipt_code, 'submitted_at', v.submitted_at, 'is_late', v.is_late, 'duplicate', true);
    end if;
  end if;
  if asg.available_from is not null and now() < asg.available_from then raise exception 'This assignment is not open yet'; end if;
  if asg.closes_at is not null and now() > asg.closes_at then raise exception 'This assignment is closed'; end if;
  late := asg.due_at is not null and now() > asg.due_at;
  if late and asg.late_policy = 'reject' then raise exception 'The due date has passed and late work is not accepted'; end if;
  if s.status = 'graded' then raise exception 'This submission has been graded; ask your instructor to return it for revision'; end if;
  if s.submitted_count >= asg.max_submissions then raise exception 'Submission limit reached'; end if;
  if coalesce(trim(s.draft_text), '') = '' and s.draft_url is null and cardinality(s.draft_asset_ids) = 0 then
    raise exception 'Your submission is empty';
  end if;
  if (not ('text' = any (asg.submission_types)) and coalesce(trim(s.draft_text), '') <> '')
     or (not ('url' = any (asg.submission_types)) and s.draft_url is not null)
     or (not ('file' = any (asg.submission_types)) and cardinality(s.draft_asset_ids) > 0) then
    raise exception 'This assignment does not accept one of the included submission types';
  end if;
  perform private.validate_submission_assets(s.draft_asset_ids, asg.offering_id, uid);
  insert into public.submission_versions (submission_id, version_no, body_text, url, asset_ids, is_late, receipt_code, client_key)
  values (s.id, s.submitted_count + 1, s.draft_text, s.draft_url, s.draft_asset_ids, late,
          'CS-' || upper(encode(extensions.gen_random_bytes(5), 'hex')), p_client_key)
  returning * into v;
  update public.submissions set status = 'submitted', submitted_count = submitted_count + 1, return_note = '' where id = s.id;
  for r in select sa.user_id from public.staff_assignments sa where sa.offering_id = asg.offering_id and (sa.role = 'instructor' or sa.can_grade) loop
    perform private.notify(r.user_id, 'submission', asg.offering_id, null, 'New submission: ' || asg.title, '',
      '/courses/' || asg.offering_id || '/assignments/' || asg.id || '/grade', 'submission:' || v.id);
  end loop;
  return jsonb_build_object('version_no', v.version_no, 'receipt_code', v.receipt_code, 'submitted_at', v.submitted_at, 'is_late', v.is_late, 'duplicate', false);
end $$;

create or replace function public.grade_submission(p_submission uuid, p_points numeric, p_feedback text, p_rubric jsonb, p_return boolean, p_return_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  s public.submissions;
  asg public.assignments;
  item uuid;
  crit record;
begin
  select * into s from public.submissions where id = p_submission for update;
  if not found or s.status = 'draft' or not private.has_staff_perm(s.offering_id, 'grade') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into asg from public.assignments where id = s.assignment_id;
  select id into item from public.grade_items where assignment_id = asg.id;
  if p_return then
    update public.submissions set status = 'returned', return_note = left(coalesce(p_return_note, ''), 5000) where id = s.id;
    perform private.notify(s.user_id, 'submission', s.offering_id, null, 'Returned for revision: ' || asg.title, '',
      '/courses/' || s.offering_id || '/assignments/' || asg.id, 'returned:' || s.id || ':' || s.submitted_count);
    perform private.audit('submission.return', 'submissions', s.id::text, s.offering_id, null, '{}'::jsonb);
    return;
  end if;
  if p_points is null or p_points < 0 or p_points > asg.points then
    raise exception 'Points must be between 0 and %', asg.points;
  end if;
  for crit in select c ->> 'id' as id, (c ->> 'points')::numeric as pts from jsonb_array_elements(asg.rubric) c loop
    if p_rubric ? crit.id and ((p_rubric ->> crit.id)::numeric < 0 or (p_rubric ->> crit.id)::numeric > crit.pts) then
      raise exception 'Rubric score out of range';
    end if;
  end loop;
  insert into public.grades (grade_item_id, offering_id, user_id, status, points, feedback, rubric_scores, graded_by, dirty)
  values (item, s.offering_id, s.user_id, 'graded', p_points, coalesce(p_feedback, ''), coalesce(p_rubric, '{}'::jsonb), uid, true)
  on conflict (grade_item_id, user_id) do update set status = 'graded', points = excluded.points, feedback = excluded.feedback,
    rubric_scores = excluded.rubric_scores, graded_by = uid, dirty = true;
  update public.submissions set status = 'graded' where id = s.id;
end $$;

-- ---------------------------------------------------------------------------
-- Grades and publication
-- ---------------------------------------------------------------------------
create or replace function public.set_grade(p_item uuid, p_user uuid, p_status text, p_points numeric, p_feedback text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  gi public.grade_items;
begin
  select * into gi from public.grade_items where id = p_item;
  if not found or not private.has_staff_perm(gi.offering_id, 'grade') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.enrollments e where e.offering_id = gi.offering_id and e.user_id = p_user) then
    raise exception 'Learner is not enrolled in this offering';
  end if;
  if p_status not in ('graded', 'missing', 'exempt') then raise exception 'Invalid status'; end if;
  if p_status = 'graded' and (p_points is null or p_points < 0 or p_points > gi.max_points) then
    raise exception 'Points must be between 0 and %', gi.max_points;
  end if;
  insert into public.grades (grade_item_id, offering_id, user_id, status, points, feedback, graded_by, dirty)
  values (gi.id, gi.offering_id, p_user, p_status, case when p_status = 'graded' then p_points when p_status = 'missing' then 0 end,
          coalesce(p_feedback, ''), uid, true)
  on conflict (grade_item_id, user_id) do update set status = excluded.status, points = excluded.points,
    feedback = excluded.feedback, graded_by = uid, dirty = true;
end $$;

create or replace function private.release_grade(p_grade uuid, p_actor uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  g public.grades;
  gi public.grade_items;
begin
  select * into g from public.grades where id = p_grade for update;
  if g.status = 'pending' then return false; end if;
  select * into gi from public.grade_items where id = g.grade_item_id;
  insert into public.released_grades (grade_id, grade_item_id, offering_id, user_id, status, points, max_points, feedback, rubric_scores, released_at, released_by)
  values (g.id, g.grade_item_id, g.offering_id, g.user_id, g.status, g.points, gi.max_points, g.feedback, g.rubric_scores, now(), p_actor)
  on conflict (grade_id) do update set status = excluded.status, points = excluded.points, max_points = excluded.max_points,
    feedback = excluded.feedback, rubric_scores = excluded.rubric_scores, released_at = now(), released_by = p_actor;
  update public.grades set dirty = false where id = g.id;
  perform private.notify(g.user_id, 'grade', g.offering_id, null, 'Grade posted: ' || gi.title, '',
    '/grades/' || g.offering_id || '#item-' || gi.id, 'grade:' || g.id || ':' || floor(extract(epoch from now())));
  return true;
end $$;

create or replace function public.publish_grades(p_offering uuid, p_grade_ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  r record;
  n integer := 0;
begin
  if not private.has_staff_perm(p_offering, 'publish_grades') then
    raise exception 'Not authorized to publish grades' using errcode = '42501';
  end if;
  for r in select id from public.grades where offering_id = p_offering and id = any (p_grade_ids) and status <> 'pending' and dirty loop
    if private.release_grade(r.id, uid) then n := n + 1; end if;
  end loop;
  perform private.audit('grades.publish', 'grades', null, p_offering, null, jsonb_build_object('count', n, 'grade_ids', p_grade_ids));
  return n;
end $$;

create or replace function public.unpublish_grade(p_grade uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g public.grades;
begin
  perform private.require_user();
  select * into g from public.grades where id = p_grade;
  if not found or not private.has_staff_perm(g.offering_id, 'publish_grades') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  delete from public.released_grades where grade_id = p_grade;
  update public.grades set dirty = true where id = p_grade;
  perform private.audit('grades.unpublish', 'grades', p_grade::text, g.offering_id, null, '{}'::jsonb);
end $$;

create or replace function public.staff_offering_summary(p_offering uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_staff_perm(p_offering, 'view') then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform public.finalize_expired_attempts(p_offering);
  return jsonb_build_object(
    'submissions_to_grade', (select count(*) from public.submissions s where s.offering_id = p_offering and s.status = 'submitted'),
    'attempts_to_grade', (select count(distinct r.attempt_id) from private.attempt_results r join public.quiz_attempts a on a.id = r.attempt_id
                          where a.offering_id = p_offering and a.status = 'submitted' and r.needs_manual and r.manual_points is null),
    'grades_to_publish', (select count(*) from public.grades g where g.offering_id = p_offering and g.dirty and g.status <> 'pending'),
    'learners', (select count(*) from public.enrollments e where e.offering_id = p_offering and e.status = 'active')
  );
end $$;
