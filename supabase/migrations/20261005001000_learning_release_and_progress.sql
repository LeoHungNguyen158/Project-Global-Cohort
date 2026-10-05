-- Learning stream: offering release, start-date gating, staff view of a learner's
-- lesson states, and two small fixes to existing guards.
--
-- 1. private.lesson_lock_reasons: lessons of an offering that has not started yet are
--    locked for learners until the offering's start (server time), so learners of an
--    upcoming offering see the dates but cannot open content or file links early.
--    Rules are factored into private.lesson_rule_reasons so staff can see what an
--    override bypasses. Overrides still unlock everything for that learner and lesson.
-- 2. public.publish_offering: authorized staff release a draft offering to learners once
--    it uses a published course version (audited; learners are notified by the existing
--    course_offerings_published trigger).
-- 3. public.learner_outline: staff read one enrolled learner's lesson states (locks,
--    overrides, progress) for the People tab. No emails or other private fields.
-- 4. private.guard_draft_content: deleting a draft lesson that has attached files
--    cascaded into lesson_assets after the lesson row was gone, so the guard could not
--    find the version and rejected the delete. The cascade is now allowed (the lesson's
--    own guard already verified it belongs to a draft).
-- 5. public.adopt_course_version: archived offerings keep their historical version.

-- ---------------------------------------------------------------------------
-- 1. Lock reasons
-- ---------------------------------------------------------------------------
create or replace function private.lesson_rule_reasons(p_offering uuid, p_lineage uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
  reasons jsonb := '[]'::jsonb;
  pct numeric;
  v_starts timestamptz;
begin
  -- Content opens at the offering's start date.
  select o.starts_at into v_starts from public.course_offerings o where o.id = p_offering;
  if v_starts is not null and v_starts > now() then
    reasons := reasons || jsonb_build_object('kind', 'offering_start', 'starts_at', v_starts);
  end if;
  for r in
    select pr.*, l.title as required_title, l.id as required_lesson_id, q.title as quiz_title
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
        reasons := reasons || jsonb_build_object('kind', 'quiz_min_score', 'quiz_id', r.quiz_id,
                                                 'quiz_title', r.quiz_title, 'min_score_pct', r.min_score_pct,
                                                 'current_pct', pct);
      end if;
    end if;
  end loop;
  return reasons;
end $$;

-- Returns a JSON array of unmet conditions for a learner. Empty array = unlocked.
create or replace function private.lesson_lock_reasons(p_offering uuid, p_lineage uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.prerequisite_overrides po
             where po.offering_id = p_offering and po.user_id = p_user
               and po.target_lesson_lineage = p_lineage and po.revoked_at is null) then
    return '[]'::jsonb;
  end if;
  return private.lesson_rule_reasons(p_offering, p_lineage, p_user);
end $$;

revoke execute on function private.lesson_rule_reasons(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Offering release
-- ---------------------------------------------------------------------------
create or replace function public.publish_offering(p_offering uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  o public.course_offerings;
  v public.course_versions;
begin
  select * into o from public.course_offerings where id = p_offering for update;
  if not found or not private.has_staff_perm(p_offering, 'author') then
    raise exception 'Not authorized to release this offering' using errcode = '42501';
  end if;
  if o.status = 'published' then
    raise exception 'This offering is already visible to learners';
  end if;
  if o.status = 'archived' then
    raise exception 'Archived offerings stay closed';
  end if;
  select * into v from public.course_versions where id = o.course_version_id;
  if v.status <> 'published' then
    raise exception 'Publish a course version and use it for this offering before releasing it to learners';
  end if;
  update public.course_offerings set status = 'published' where id = p_offering;
  perform private.audit('offering.publish', 'course_offerings', p_offering::text, p_offering, o.cohort_id,
                        jsonb_build_object('course_version_id', v.id, 'version_no', v.version_no, 'by', uid));
end $$;

revoke execute on function public.publish_offering(uuid) from public, anon;
grant execute on function public.publish_offering(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Staff view of one learner's lesson states
-- ---------------------------------------------------------------------------
create or replace function public.learner_outline(p_offering uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  o public.course_offerings;
  enr public.enrollments;
  result jsonb;
begin
  if not private.has_staff_perm(p_offering, 'view') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into enr from public.enrollments where offering_id = p_offering and user_id = p_user;
  if not found then
    raise exception 'This person is not enrolled in this offering';
  end if;
  select * into o from public.course_offerings where id = p_offering;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'lineage_id', m.lineage_id, 'title', m.title, 'position', m.position,
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'lineage_id', l.lineage_id, 'title', l.title, 'content_type', l.content_type, 'required', l.required,
        'duration_minutes', l.duration_minutes, 'completion_rule', l.completion_rule, 'position', l.position,
        'lock_reasons', private.lesson_lock_reasons(p_offering, l.lineage_id, p_user),
        'rule_reasons', private.lesson_rule_reasons(p_offering, l.lineage_id, p_user),
        'override_id', (select po.id from public.prerequisite_overrides po
                        where po.offering_id = p_offering and po.user_id = p_user
                          and po.target_lesson_lineage = l.lineage_id and po.revoked_at is null
                        order by po.created_at desc limit 1),
        'started_at', lp.started_at, 'completed_at', lp.completed_at, 'updated_at', lp.updated_at,
        'last_position_seconds', lp.last_position_seconds, 'max_position_seconds', lp.max_position_seconds,
        'duration_seconds', lp.duration_seconds
      ) order by l.position)
      from public.lessons l
      left join public.lesson_progress lp on lp.offering_id = p_offering and lp.user_id = p_user and lp.lesson_lineage = l.lineage_id
      where l.module_id = m.id), '[]'::jsonb)
  ) order by m.position), '[]'::jsonb)
  into result
  from public.modules m where m.course_version_id = o.course_version_id;
  return jsonb_build_object('offering_id', p_offering, 'user_id', p_user, 'viewer_id', uid,
                            'enrollment_status', enr.status, 'course_version_id', o.course_version_id, 'modules', result);
end $$;

revoke execute on function public.learner_outline(uuid, uuid) from public, anon;
grant execute on function public.learner_outline(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Draft content guard: allow the cascade from deleting a draft lesson
-- ---------------------------------------------------------------------------
create or replace function private.guard_draft_content() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_id uuid;
begin
  if private.purge_allowed() then return coalesce(new, old); end if;
  if tg_table_name = 'lesson_assets' then
    select l.course_version_id into v_id from public.lessons l where l.id = coalesce(new.lesson_id, old.lesson_id);
    -- Cascade from deleting a lesson: the lesson row is already gone, and the lessons
    -- guard has verified that it belonged to a draft version.
    if v_id is null and tg_op = 'DELETE' then
      return old;
    end if;
  else
    v_id := coalesce(new.course_version_id, old.course_version_id);
  end if;
  select status into v_status from public.course_versions where id = v_id;
  if v_status is distinct from 'draft' then
    raise exception 'Content of a published course version cannot be changed; create a new draft version';
  end if;
  if tg_table_name = 'lessons' and tg_op <> 'DELETE' then
    if not exists (select 1 from public.modules m where m.id = new.module_id and m.course_version_id = new.course_version_id) then
      raise exception 'Lesson module must belong to the same course version';
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Adopting a version: archived offerings keep their historical version
-- ---------------------------------------------------------------------------
create or replace function public.adopt_course_version(p_offering uuid, p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  o public.course_offerings;
  v public.course_versions;
  r record;
begin
  select * into o from public.course_offerings where id = p_offering for update;
  if not found or not private.has_staff_perm(p_offering, 'author') then
    raise exception 'Not authorized to change this offering' using errcode = '42501';
  end if;
  if o.status = 'archived' then
    raise exception 'Archived offerings keep the course version they were taught with';
  end if;
  select * into v from public.course_versions where id = p_version;
  if not found or v.course_id <> o.course_id or v.status <> 'published' then
    raise exception 'Only a published version of the same course can be adopted';
  end if;
  update public.course_offerings set course_version_id = p_version where id = p_offering;
  perform private.audit('offering.adopt_version', 'course_offerings', p_offering::text, p_offering, o.cohort_id,
                        jsonb_build_object('from', o.course_version_id, 'to', p_version, 'by', uid));
  if o.status = 'published' then
    for r in select e.user_id from public.enrollments e where e.offering_id = p_offering and e.status = 'active' loop
      perform private.notify(r.user_id, 'content', p_offering, null, 'Course content updated', v.title,
                             '/courses/' || p_offering || '/content', 'content:' || p_offering || ':' || p_version);
    end loop;
  end if;
end $$;

revoke execute on function public.adopt_course_version(uuid, uuid) from public, anon;
grant execute on function public.adopt_course_version(uuid, uuid) to authenticated;
