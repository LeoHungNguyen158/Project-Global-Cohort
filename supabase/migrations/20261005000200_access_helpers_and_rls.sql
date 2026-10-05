-- Authorization helpers and row-level security.
-- Helpers are SECURITY DEFINER with an empty search_path so RLS policies can ask
-- "is the current user X?" without recursive policy evaluation. They only ever
-- answer about auth.uid(); none returns another person's data.

-- ---------------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------------
create or replace function private.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.suspended_at is null
  );
$$;

create or replace function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_user() and exists (
    select 1 from public.platform_role_grants g
    where g.user_id = (select auth.uid()) and g.role = 'platform_admin' and g.revoked_at is null
  );
$$;

create or replace function private.is_cohort_admin(p_cohort uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin() or (
    private.is_active_user() and exists (
      select 1 from public.platform_role_grants g
      join public.coordinator_scopes s on s.user_id = g.user_id
      where g.user_id = (select auth.uid()) and g.role = 'coordinator' and g.revoked_at is null
        and s.cohort_id = p_cohort
    )
  );
$$;

create or replace function private.offering_cohort(p_offering uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select cohort_id from public.course_offerings where id = p_offering;
$$;

create or replace function private.is_offering_admin(p_offering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_cohort_admin(private.offering_cohort(p_offering));
$$;

-- perm: view | author | grade | publish_grades | communicate | manage
create or replace function private.has_staff_perm(p_offering uuid, p_perm text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  sa public.staff_assignments;
begin
  if p_offering is null or not private.is_active_user() then
    return false;
  end if;
  if private.is_offering_admin(p_offering) then
    return true;
  end if;
  select * into sa from public.staff_assignments
   where offering_id = p_offering and user_id = (select auth.uid());
  if not found then
    return false;
  end if;
  if sa.role = 'instructor' then
    return true;
  end if;
  -- Teaching assistant: explicit permissions only.
  return case p_perm
    when 'view' then true
    when 'communicate' then true
    when 'author' then sa.can_author
    when 'grade' then sa.can_grade
    when 'publish_grades' then sa.can_publish_grades
    else false
  end;
end $$;

create or replace function private.offering_learner_visible(p_offering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.course_offerings o
    join public.course_versions v on v.id = o.course_version_id
    where o.id = p_offering and o.status in ('published', 'archived') and v.status in ('published', 'archived')
  );
$$;

create or replace function private.is_enrolled(p_offering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_user() and exists (
    select 1 from public.enrollments e
    where e.offering_id = p_offering and e.user_id = (select auth.uid()) and e.status in ('active', 'completed')
  );
$$;

-- Learner write access requires an active (not completed/withdrawn) enrollment
-- in an offering that is published (archived offerings are read-only).
create or replace function private.is_active_learner(p_offering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_user() and exists (
    select 1 from public.enrollments e
    join public.course_offerings o on o.id = e.offering_id
    where e.offering_id = p_offering and e.user_id = (select auth.uid())
      and e.status = 'active' and o.status = 'published'
  );
$$;

create or replace function private.can_view_offering(p_offering uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_staff_perm(p_offering, 'view')
      or (private.is_enrolled(p_offering) and private.offering_learner_visible(p_offering));
$$;

create or replace function private.is_cohort_member(p_cohort uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_cohort_admin(p_cohort) or (
    private.is_active_user() and (
      exists (select 1 from public.cohort_participation cp
              where cp.cohort_id = p_cohort and cp.user_id = (select auth.uid()) and cp.status = 'active')
      or exists (select 1 from public.course_offerings o
                 join public.staff_assignments sa on sa.offering_id = o.id
                 where o.cohort_id = p_cohort and sa.user_id = (select auth.uid()))
      or exists (select 1 from public.course_offerings o
                 join public.enrollments e on e.offering_id = o.id
                 where o.cohort_id = p_cohort and e.user_id = (select auth.uid())
                   and e.status in ('active', 'completed') and o.status in ('published', 'archived'))
    )
  );
$$;

create or replace function private.is_community_member(p_community uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_user() and (
    exists (select 1 from public.community_members m where m.community_id = p_community and m.user_id = (select auth.uid()))
    or exists (select 1 from public.communities c where c.id = p_community and c.cohort_id is not null and private.is_cohort_admin(c.cohort_id))
    or (private.is_platform_admin())
  );
$$;

create or replace function private.can_view_community(p_community uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_user() and exists (
    select 1 from public.communities c
    where c.id = p_community and (c.cohort_id is null or private.is_cohort_member(c.cohort_id))
  );
$$;

create or replace function private.can_author_course(p_course uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin() or exists (
    select 1 from public.course_offerings o
    where o.course_id = p_course and private.has_staff_perm(o.id, 'author')
  );
$$;

create or replace function private.can_view_course_version(p_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.course_versions v
    where v.id = p_version and (
      private.can_author_course(v.course_id)
      or exists (select 1 from public.course_offerings o
                 where o.course_version_id = v.id and private.can_view_offering(o.id))
    )
  );
$$;

-- Do the current user and p_other share any academic scope (offering or cohort)?
create or replace function private.shares_scope(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with mine as (
    select e.offering_id from public.enrollments e
      where e.user_id = (select auth.uid()) and e.status in ('active', 'completed')
    union
    select sa.offering_id from public.staff_assignments sa where sa.user_id = (select auth.uid())
  ), theirs as (
    select e.offering_id from public.enrollments e
      where e.user_id = p_other and e.status in ('active', 'completed')
    union
    select sa.offering_id from public.staff_assignments sa where sa.user_id = p_other
  )
  select private.is_active_user() and (
    exists (select 1 from mine join theirs using (offering_id))
    or exists (
      select 1 from public.cohort_participation a
      join public.cohort_participation b on a.cohort_id = b.cohort_id
      where a.user_id = (select auth.uid()) and b.user_id = p_other and a.status = 'active' and b.status = 'active'
    )
    or exists (
      select 1 from public.thread_participants a
      join public.thread_participants b on a.thread_id = b.thread_id
      where a.user_id = (select auth.uid()) and b.user_id = p_other
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Prerequisites / lesson locks
-- ---------------------------------------------------------------------------
-- Effective released quiz percentage for a learner (null when nothing released).
create or replace function private.released_quiz_pct(p_quiz uuid, p_user uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when rg.status = 'graded' and rg.max_points > 0 then round(rg.points / rg.max_points * 100, 2) end
  from public.grade_items gi
  join public.released_grades rg on rg.grade_item_id = gi.id and rg.user_id = p_user
  where gi.quiz_id = p_quiz;
$$;

-- Returns a JSON array of unmet conditions for a learner. Empty array = unlocked.
create or replace function private.lesson_lock_reasons(p_offering uuid, p_lineage uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
  reasons jsonb := '[]'::jsonb;
  pct numeric;
begin
  if exists (select 1 from public.prerequisite_overrides po
             where po.offering_id = p_offering and po.user_id = p_user
               and po.target_lesson_lineage = p_lineage and po.revoked_at is null) then
    return reasons;
  end if;
  for r in
    select pr.*, l.title as required_title, l.id as required_lesson_id, q.title as quiz_title
    from public.prerequisite_rules pr
    left join public.course_offerings o on o.id = pr.offering_id
    left join public.lessons l on l.course_version_id = o.course_version_id and l.lineage_id = pr.required_lesson_lineage
    left join public.quizzes q on q.id = pr.quiz_id
    where pr.offering_id = p_offering and pr.target_lesson_lineage = p_lineage
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

create or replace function private.can_read_lesson(p_lesson uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.lessons l
    join public.course_versions v on v.id = l.course_version_id
    where l.id = p_lesson and (
      private.can_author_course(v.course_id)
      or exists (
        select 1 from public.course_offerings o
        where o.course_version_id = l.course_version_id
          and (
            private.has_staff_perm(o.id, 'view')
            or (private.is_enrolled(o.id) and private.offering_learner_visible(o.id)
                and jsonb_array_length(private.lesson_lock_reasons(o.id, l.lineage_id, (select auth.uid()))) = 0)
          )
      )
    )
  );
$$;

create or replace function private.can_read_asset(p_asset uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  a public.content_assets;
begin
  if not private.is_active_user() then
    return false;
  end if;
  select * into a from public.content_assets where id = p_asset;
  if not found or a.status = 'deleted' then
    return false;
  end if;
  if a.owner_id = (select auth.uid()) then
    return true;
  end if;
  if a.status <> 'ready' then
    return false;
  end if;
  if a.purpose = 'lesson' then
    -- Draft authoring access, or access through an unlocked lesson the asset is attached to.
    if a.course_version_id is not null and exists (
      select 1 from public.course_versions v where v.id = a.course_version_id and private.can_author_course(v.course_id)
    ) then
      return true;
    end if;
    return exists (select 1 from public.lesson_assets la where la.asset_id = a.id and private.can_read_lesson(la.lesson_id));
  elsif a.purpose = 'submission' then
    return a.offering_id is not null and private.has_staff_perm(a.offering_id, 'grade') and exists (
      select 1 from public.submission_versions sv where a.id = any (sv.asset_ids)
      union all
      select 1 from public.submissions s where a.id = any (s.draft_asset_ids) and s.status <> 'draft'
    );
  elsif a.purpose = 'message' then
    return exists (
      select 1 from public.messages m
      join public.thread_participants tp on tp.thread_id = m.thread_id and tp.user_id = (select auth.uid())
      where a.id = any (m.asset_ids)
    );
  elsif a.purpose = 'avatar' then
    return true;
  end if;
  return false;
end $$;

create or replace function private.asset_id_from_object(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[a-z-]+/[0-9a-f-]{36}/[0-9a-f-]{36}$'
              then split_part(p_name, '/', 2)::uuid end;
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting (database-backed; no in-process state)
-- ---------------------------------------------------------------------------
create or replace function private.hit_rate_limit(p_bucket text, p_max integer, p_window_seconds integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  ws timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into private.rate_limits as rl (bucket, window_start, hits) values (p_bucket, ws, 1)
  on conflict (bucket, window_start) do update set hits = rl.hits + 1
  returning hits into n;
  if n > p_max then
    raise exception 'Rate limit exceeded. Please wait and try again.' using errcode = 'P0429';
  end if;
  delete from private.rate_limits where window_start < now() - interval '1 day';
end $$;

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------
create or replace function private.audit(p_action text, p_table text, p_target text, p_offering uuid, p_cohort uuid, p_meta jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events (actor_id, action, target_table, target_id, offering_id, cohort_id, metadata)
  values ((select auth.uid()), p_action, p_table, p_target, p_offering, p_cohort, coalesce(p_meta, '{}'::jsonb));
$$;

create or replace function private.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
  old_j jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_j jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  changed jsonb := '{}'::jsonb;
  k text;
  target text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(new_j) loop
      if k not in ('updated_at') and (old_j -> k) is distinct from (new_j -> k) then
        changed := changed || jsonb_build_object(k, jsonb_build_object('from', old_j -> k, 'to', new_j -> k));
      end if;
    end loop;
    if changed = '{}'::jsonb then
      return new;
    end if;
  end if;
  target := coalesce(rec ->> 'id', concat_ws(':', rec ->> 'offering_id', rec ->> 'cohort_id', rec ->> 'user_id'));
  insert into public.audit_events (actor_id, action, target_table, target_id, offering_id, cohort_id, metadata)
  values (
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    target,
    case when rec ? 'offering_id' then (rec ->> 'offering_id')::uuid end,
    case when rec ? 'cohort_id' then (rec ->> 'cohort_id')::uuid end,
    case when tg_op = 'UPDATE' then jsonb_build_object('changed', changed)
         when tg_op = 'INSERT' then jsonb_build_object('row', new_j - 'body_html' - 'feedback')
         else jsonb_build_object('row', old_j - 'body_html' - 'feedback') end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['platform_role_grants','coordinator_scopes','cohort_participation','staff_assignments','enrollments',
                           'invitations','course_offerings','prerequisite_rules','prerequisite_overrides','grades','quiz_accommodations',
                           'cohorts','courses']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Integrity guards
-- ---------------------------------------------------------------------------
-- Published course versions are immutable (archiving is the only allowed change).
-- Maintenance bypass for sample-data purges: only a direct database session (never the
-- API roles) can set app.allow_purge.
create or replace function private.purge_allowed() returns boolean
language sql stable set search_path = '' as $$
  select current_setting('app.allow_purge', true) = 'on' and current_user not in ('authenticated', 'anon');
$$;

create or replace function private.guard_course_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.purge_allowed() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Published course versions cannot be deleted';
    end if;
    return old;
  end if;
  if old.status in ('published', 'archived') then
    if (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at')
       or not (new.status = 'archived' or new.status = old.status) then
      raise exception 'Published course versions are immutable; create a new draft version instead';
    end if;
  end if;
  return new;
end $$;
create trigger course_versions_guard before update or delete on public.course_versions
  for each row execute function private.guard_course_version();

create or replace function private.guard_draft_content() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_id uuid;
begin
  if private.purge_allowed() then return coalesce(new, old); end if;
  if tg_table_name = 'lesson_assets' then
    select l.course_version_id into v_id from public.lessons l where l.id = coalesce(new.lesson_id, old.lesson_id);
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
create trigger modules_guard before insert or update or delete on public.modules for each row execute function private.guard_draft_content();
create trigger lessons_guard before insert or update or delete on public.lessons for each row execute function private.guard_draft_content();
create trigger lesson_assets_guard before insert or update or delete on public.lesson_assets for each row execute function private.guard_draft_content();

-- Offerings may only reference versions of their own course.
create or replace function private.guard_offering_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.course_versions v where v.id = new.course_version_id and v.course_id = new.course_id) then
    raise exception 'Offering must reference a version of its own course';
  end if;
  if new.status <> 'draft' and not exists (
    select 1 from public.course_versions v where v.id = new.course_version_id and v.status in ('published', 'archived')
  ) then
    raise exception 'A published offering must use a published course version';
  end if;
  return new;
end $$;
create trigger course_offerings_version_guard before insert or update on public.course_offerings
  for each row execute function private.guard_offering_version();

-- Reject cyclic lesson prerequisite graphs within an offering.
create or replace function private.guard_prerequisite_cycle() returns trigger
language plpgsql set search_path = '' as $$
declare
  cyclic boolean;
begin
  if new.kind <> 'lesson_complete' then
    return new;
  end if;
  with recursive deps(lineage) as (
    select new.required_lesson_lineage
    union
    select pr.required_lesson_lineage
    from public.prerequisite_rules pr
    join deps d on pr.target_lesson_lineage = d.lineage
    where pr.offering_id = new.offering_id and pr.kind = 'lesson_complete' and pr.id <> new.id
  )
  select exists (select 1 from deps where lineage = new.target_lesson_lineage) into cyclic;
  if cyclic then
    raise exception 'This prerequisite would create a cycle' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger prerequisite_rules_cycle_guard before insert or update on public.prerequisite_rules
  for each row execute function private.guard_prerequisite_cycle();

-- Users may edit only safe profile columns (also enforced by column grants).
create or replace function private.guard_profile_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'authenticated' and (
       new.suspended_at is distinct from old.suspended_at or new.is_sample is distinct from old.is_sample or new.id <> old.id) then
    raise exception 'Not allowed to change protected profile fields';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function private.guard_profile_update();

-- Create profile rows for new auth users.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Grants: explicit, least privilege. RLS still applies on top of every grant.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon;

grant select on all tables in schema public to authenticated;
revoke select on public.notification_outbox from authenticated;

grant update (display_name, avatar_asset_id, locale, timezone, courses_view, bio) on public.profiles to authenticated;
grant insert, update, delete on public.cohorts, public.coordinator_scopes, public.cohort_participation, public.communities,
  public.courses, public.course_offerings, public.staff_assignments, public.enrollments, public.invitations,
  public.modules, public.lessons, public.lesson_assets, public.prerequisite_rules, public.quizzes, public.quiz_accommodations,
  public.assignments, public.grade_items, public.announcements, public.calendar_events, public.discussion_topics,
  public.tool_resources, public.platform_settings, public.notification_preferences
  to authenticated;
grant insert, delete on public.favorites, public.community_members to authenticated;
grant insert (offering_id, user_id, target_lesson_lineage, reason, granted_by) on public.prerequisite_overrides to authenticated;
grant update (revoked_at) on public.prerequisite_overrides to authenticated;
grant insert (course_id, version_no, status, title, summary, objectives, audience, expected_effort, prerequisites_text,
              syllabus_html, grading_policy, based_on_version_id, created_by) on public.course_versions to authenticated;
grant update (title, summary, objectives, audience, expected_effort, prerequisites_text, syllabus_html, grading_policy)
  on public.course_versions to authenticated;
grant insert (topic_id, parent_id, author_id, body_html) on public.discussion_posts to authenticated;
grant update (body_html) on public.discussion_posts to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.is_platform_admin() or private.shares_scope(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()) and private.is_active_user()) with check (id = (select auth.uid()));

-- platform roles
create policy role_grants_select on public.platform_role_grants for select to authenticated
  using (user_id = (select auth.uid()) or private.is_platform_admin());

-- cohorts
create policy cohorts_select on public.cohorts for select to authenticated using (private.is_cohort_member(id));
create policy cohorts_insert on public.cohorts for insert to authenticated with check (private.is_platform_admin());
create policy cohorts_update on public.cohorts for update to authenticated using (private.is_cohort_admin(id)) with check (private.is_cohort_admin(id));

create policy coordinator_scopes_select on public.coordinator_scopes for select to authenticated
  using (user_id = (select auth.uid()) or private.is_platform_admin());
create policy coordinator_scopes_write on public.coordinator_scopes for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());

create policy cohort_participation_select on public.cohort_participation for select to authenticated
  using (user_id = (select auth.uid()) or private.is_cohort_member(cohort_id));
create policy cohort_participation_write on public.cohort_participation for all to authenticated
  using (private.is_cohort_admin(cohort_id)) with check (private.is_cohort_admin(cohort_id));

create policy communities_select on public.communities for select to authenticated
  using (private.is_active_user() and (cohort_id is null or private.is_cohort_member(cohort_id)));
create policy communities_write on public.communities for all to authenticated
  using (case when cohort_id is null then private.is_platform_admin() else private.is_cohort_admin(cohort_id) end)
  with check (case when cohort_id is null then private.is_platform_admin() else private.is_cohort_admin(cohort_id) end);

create policy community_members_select on public.community_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_community_member(community_id));
create policy community_members_join on public.community_members for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_view_community(community_id)
              and exists (select 1 from public.communities c where c.id = community_id and c.join_policy = 'open'));
create policy community_members_leave on public.community_members for delete to authenticated
  using (user_id = (select auth.uid()) or exists (select 1 from public.communities c where c.id = community_id
         and case when c.cohort_id is null then private.is_platform_admin() else private.is_cohort_admin(c.cohort_id) end));

-- courses and versions
create policy courses_select on public.courses for select to authenticated
  using (private.can_author_course(id) or exists (select 1 from public.course_offerings o where o.course_id = id and private.can_view_offering(o.id)));
create policy courses_write on public.courses for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());

create policy course_versions_select on public.course_versions for select to authenticated
  using (private.can_author_course(course_id)
         or exists (select 1 from public.course_offerings o where o.course_version_id = course_versions.id and private.can_view_offering(o.id)));
create policy course_versions_insert on public.course_versions for insert to authenticated
  with check (status = 'draft' and private.can_author_course(course_id));
create policy course_versions_update on public.course_versions for update to authenticated
  using (status = 'draft' and private.can_author_course(course_id)) with check (status = 'draft' and private.can_author_course(course_id));

create policy modules_select on public.modules for select to authenticated using (private.can_view_course_version(course_version_id));
create policy modules_write on public.modules for all to authenticated
  using (exists (select 1 from public.course_versions v where v.id = course_version_id and v.status = 'draft' and private.can_author_course(v.course_id)))
  with check (exists (select 1 from public.course_versions v where v.id = course_version_id and v.status = 'draft' and private.can_author_course(v.course_id)));

create policy lessons_select on public.lessons for select to authenticated
  using (exists (select 1 from public.course_versions v where v.id = course_version_id and private.can_author_course(v.course_id))
         or private.can_read_lesson(id));
create policy lessons_write on public.lessons for all to authenticated
  using (exists (select 1 from public.course_versions v where v.id = course_version_id and v.status = 'draft' and private.can_author_course(v.course_id)))
  with check (exists (select 1 from public.course_versions v where v.id = course_version_id and v.status = 'draft' and private.can_author_course(v.course_id)));

create policy lesson_assets_select on public.lesson_assets for select to authenticated using (private.can_read_lesson(lesson_id));
create policy lesson_assets_write on public.lesson_assets for all to authenticated
  using (exists (select 1 from public.lessons l join public.course_versions v on v.id = l.course_version_id
                 where l.id = lesson_id and v.status = 'draft' and private.can_author_course(v.course_id)))
  with check (exists (select 1 from public.lessons l join public.course_versions v on v.id = l.course_version_id
                      where l.id = lesson_id and v.status = 'draft' and private.can_author_course(v.course_id))
              and exists (select 1 from public.content_assets a where a.id = asset_id and a.purpose = 'lesson' and a.status = 'ready'));

-- offerings, staff, enrollment
create policy offerings_select on public.course_offerings for select to authenticated
  using (private.can_view_offering(id) or private.is_cohort_admin(cohort_id));
create policy offerings_insert on public.course_offerings for insert to authenticated with check (private.is_cohort_admin(cohort_id));
create policy offerings_update on public.course_offerings for update to authenticated
  using (private.is_cohort_admin(cohort_id)) with check (private.is_cohort_admin(cohort_id));

create policy staff_select on public.staff_assignments for select to authenticated
  using (user_id = (select auth.uid()) or private.can_view_offering(offering_id));
create policy staff_write on public.staff_assignments for all to authenticated
  using (private.is_offering_admin(offering_id)) with check (private.is_offering_admin(offering_id));

create policy enrollments_select on public.enrollments for select to authenticated
  using (user_id = (select auth.uid()) or private.has_staff_perm(offering_id, 'view'));
create policy enrollments_write on public.enrollments for all to authenticated
  using (private.is_offering_admin(offering_id)) with check (private.is_offering_admin(offering_id));

create policy invitations_select on public.invitations for select to authenticated
  using (private.is_cohort_admin(coalesce(cohort_id, private.offering_cohort(offering_id))));
create policy invitations_write on public.invitations for all to authenticated
  using (private.is_cohort_admin(coalesce(cohort_id, private.offering_cohort(offering_id))))
  with check (private.is_cohort_admin(coalesce(cohort_id, private.offering_cohort(offering_id))));

create policy access_requests_select on public.access_requests for select to authenticated
  using (user_id = (select auth.uid()) or private.is_offering_admin(offering_id) or private.has_staff_perm(offering_id, 'manage'));

-- prerequisites and progress
create policy prereq_rules_select on public.prerequisite_rules for select to authenticated using (private.can_view_offering(offering_id));
create policy prereq_rules_write on public.prerequisite_rules for all to authenticated
  using (private.has_staff_perm(offering_id, 'author')) with check (private.has_staff_perm(offering_id, 'author'));

create policy prereq_overrides_select on public.prerequisite_overrides for select to authenticated
  using (user_id = (select auth.uid()) or private.has_staff_perm(offering_id, 'view'));
create policy prereq_overrides_insert on public.prerequisite_overrides for insert to authenticated
  with check (granted_by = (select auth.uid()) and private.has_staff_perm(offering_id, 'author')
              and exists (select 1 from public.enrollments e where e.offering_id = prerequisite_overrides.offering_id and e.user_id = prerequisite_overrides.user_id));
create policy prereq_overrides_update on public.prerequisite_overrides for update to authenticated
  using (private.has_staff_perm(offering_id, 'author')) with check (private.has_staff_perm(offering_id, 'author'));

create policy lesson_progress_select on public.lesson_progress for select to authenticated
  using (user_id = (select auth.uid()) or private.has_staff_perm(offering_id, 'view'));
create policy completion_snapshots_select on public.completion_snapshots for select to authenticated
  using (user_id = (select auth.uid()) or private.has_staff_perm(offering_id, 'view'));

-- assets: metadata visible when the file itself is readable
create policy content_assets_select on public.content_assets for select to authenticated using (private.can_read_asset(id));

-- assessments
create policy quizzes_select on public.quizzes for select to authenticated
  using (private.has_staff_perm(offering_id, 'view') or (status = 'published' and private.can_view_offering(offering_id)));
create policy quizzes_write on public.quizzes for all to authenticated
  using (private.has_staff_perm(offering_id, 'author')) with check (private.has_staff_perm(offering_id, 'author'));

create policy quiz_versions_select on public.quiz_versions for select to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and private.has_staff_perm(q.offering_id, 'view')));
create policy questions_select on public.questions for select to authenticated
  using (exists (select 1 from public.quiz_versions qv join public.quizzes q on q.id = qv.quiz_id
                 where qv.id = quiz_version_id and private.has_staff_perm(q.offering_id, 'view')));

create policy accommodations_select on public.quiz_accommodations for select to authenticated
  using (user_id = (select auth.uid()) or exists (select 1 from public.quizzes q where q.id = quiz_id and private.has_staff_perm(q.offering_id, 'view')));
create policy accommodations_write on public.quiz_accommodations for all to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and private.has_staff_perm(q.offering_id, 'manage')))
  with check (granted_by = (select auth.uid()) and exists (select 1 from public.quizzes q where q.id = quiz_id and private.has_staff_perm(q.offering_id, 'manage')));

create policy attempts_select on public.quiz_attempts for select to authenticated
  using (user_id = (select auth.uid()) or private.has_staff_perm(offering_id, 'view'));
create policy attempt_answers_select on public.attempt_answers for select to authenticated
  using (exists (select 1 from public.quiz_attempts a where a.id = attempt_id
                 and (a.user_id = (select auth.uid()) or private.has_staff_perm(a.offering_id, 'grade'))));

create policy assignments_select on public.assignments for select to authenticated
  using (private.has_staff_perm(offering_id, 'view')
         or (status in ('published', 'archived') and (available_from is null or available_from <= now()) and private.can_view_offering(offering_id)));
create policy assignments_write on public.assignments for all to authenticated
  using (private.has_staff_perm(offering_id, 'author')) with check (private.has_staff_perm(offering_id, 'author'));

create policy submissions_select on public.submissions for select to authenticated
  using (user_id = (select auth.uid()) or (status <> 'draft' and private.has_staff_perm(offering_id, 'grade')));
create policy submission_versions_select on public.submission_versions for select to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id
                 and (s.user_id = (select auth.uid()) or private.has_staff_perm(s.offering_id, 'grade'))));

create policy grade_items_select on public.grade_items for select to authenticated
  using (private.has_staff_perm(offering_id, 'view') or (visible_to_learners and private.can_view_offering(offering_id)));
create policy grade_items_write on public.grade_items for all to authenticated
  using (kind in ('participation', 'manual') and private.has_staff_perm(offering_id, 'author'))
  with check (kind in ('participation', 'manual') and private.has_staff_perm(offering_id, 'author'));

create policy grades_select on public.grades for select to authenticated using (private.has_staff_perm(offering_id, 'view'));
create policy released_grades_select on public.released_grades for select to authenticated
  using ((user_id = (select auth.uid()) and private.can_view_offering(offering_id)) or private.has_staff_perm(offering_id, 'view'));

-- communication
create policy announcements_select on public.announcements for select to authenticated
  using (
    case when offering_id is not null then
      private.has_staff_perm(offering_id, 'communicate')
      or (status = 'published' and coalesce(publish_at, created_at) <= now() and private.can_view_offering(offering_id))
    else
      private.is_cohort_admin(cohort_id)
      or (status = 'published' and coalesce(publish_at, created_at) <= now() and private.is_cohort_member(cohort_id))
    end);
create policy announcements_write on public.announcements for all to authenticated
  using (case when offering_id is not null then private.has_staff_perm(offering_id, 'communicate') else private.is_cohort_admin(cohort_id) end)
  with check (case when offering_id is not null then private.has_staff_perm(offering_id, 'communicate') else private.is_cohort_admin(cohort_id) end);
create policy announcement_revisions_select on public.announcement_revisions for select to authenticated
  using (exists (select 1 from public.announcements a where a.id = announcement_id and
                 case when a.offering_id is not null then private.has_staff_perm(a.offering_id, 'communicate') else private.is_cohort_admin(a.cohort_id) end));

create policy calendar_select on public.calendar_events for select to authenticated
  using (case when offering_id is not null then private.can_view_offering(offering_id) else private.is_cohort_member(cohort_id) end);
create policy calendar_write on public.calendar_events for all to authenticated
  using (case when offering_id is not null then private.has_staff_perm(offering_id, 'communicate') else private.is_cohort_admin(cohort_id) end)
  with check (case when offering_id is not null then private.has_staff_perm(offering_id, 'communicate') else private.is_cohort_admin(cohort_id) end);

create or replace function private.is_thread_participant(p_thread uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_user() and exists (
    select 1 from public.thread_participants tp where tp.thread_id = p_thread and tp.user_id = (select auth.uid()));
$$;
grant execute on function private.is_thread_participant(uuid) to authenticated;

create policy threads_select on public.threads for select to authenticated using (private.is_thread_participant(id));
create policy thread_participants_select on public.thread_participants for select to authenticated
  using (private.is_thread_participant(thread_id));
create policy messages_select on public.messages for select to authenticated using (private.is_thread_participant(thread_id));

create or replace function private.can_view_topic(p_topic uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.discussion_topics t where t.id = p_topic and (
    (t.offering_id is not null and private.can_view_offering(t.offering_id))
    or (t.cohort_id is not null and private.is_cohort_member(t.cohort_id))
    or (t.community_id is not null and private.is_community_member(t.community_id))));
$$;
create or replace function private.can_moderate_topic(p_topic uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.discussion_topics t left join public.communities c on c.id = t.community_id where t.id = p_topic and (
    (t.offering_id is not null and private.has_staff_perm(t.offering_id, 'communicate'))
    or (t.cohort_id is not null and private.is_cohort_admin(t.cohort_id))
    or (t.community_id is not null and (private.is_platform_admin() or (c.cohort_id is not null and private.is_cohort_admin(c.cohort_id))))));
$$;
grant execute on function private.can_view_topic(uuid), private.can_moderate_topic(uuid) to authenticated;

-- Policies avoid looking up their own row through a helper so INSERT ... RETURNING works.
create policy topics_select on public.discussion_topics for select to authenticated
  using ((offering_id is not null and private.can_view_offering(offering_id))
         or (cohort_id is not null and private.is_cohort_member(cohort_id))
         or (community_id is not null and private.is_community_member(community_id)));
create policy topics_insert on public.discussion_topics for insert to authenticated
  with check (created_by = (select auth.uid()) and (
    (offering_id is not null and private.has_staff_perm(offering_id, 'communicate'))
    or (cohort_id is not null and private.is_cohort_admin(cohort_id))
    or (community_id is not null and private.is_community_member(community_id))));
create policy topics_update on public.discussion_topics for update to authenticated
  using (private.can_moderate_topic(id)) with check (private.can_moderate_topic(id));
create policy topics_delete on public.discussion_topics for delete to authenticated
  using (private.can_moderate_topic(id) and not exists (select 1 from public.discussion_posts p where p.topic_id = discussion_topics.id));

create policy posts_select on public.discussion_posts for select to authenticated using (private.can_view_topic(topic_id));
create policy posts_insert on public.discussion_posts for insert to authenticated
  with check (author_id = (select auth.uid()) and private.can_view_topic(topic_id)
              and exists (select 1 from public.discussion_topics t where t.id = topic_id and not t.locked)
              and (parent_id is null or exists (select 1 from public.discussion_posts p where p.id = discussion_posts.parent_id and p.topic_id = discussion_posts.topic_id)));
create policy posts_update_own on public.discussion_posts for update to authenticated
  using (author_id = (select auth.uid()) and hidden_at is null and private.can_view_topic(topic_id))
  with check (author_id = (select auth.uid()));
create policy post_revisions_select on public.discussion_post_revisions for select to authenticated
  using (exists (select 1 from public.discussion_posts p where p.id = post_id and (p.author_id = (select auth.uid()) or private.can_moderate_topic(p.topic_id))));

create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notification_prefs_all on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy favorites_select on public.favorites for select to authenticated using (user_id = (select auth.uid()));
create policy favorites_insert on public.favorites for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_view_offering(offering_id));
create policy favorites_delete on public.favorites for delete to authenticated using (user_id = (select auth.uid()));

create policy tools_select on public.tool_resources for select to authenticated
  using (private.is_active_user() and (
    (offering_id is null and cohort_id is null and (published or private.is_platform_admin()))
    or (offering_id is not null and ((published and private.can_view_offering(offering_id)) or private.has_staff_perm(offering_id, 'communicate')))
    or (cohort_id is not null and ((published and private.is_cohort_member(cohort_id)) or private.is_cohort_admin(cohort_id)))));
create policy tools_write on public.tool_resources for all to authenticated
  using (case when offering_id is not null then private.has_staff_perm(offering_id, 'communicate')
              when cohort_id is not null then private.is_cohort_admin(cohort_id)
              else private.is_platform_admin() end)
  with check (case when offering_id is not null then private.has_staff_perm(offering_id, 'communicate')
                   when cohort_id is not null then private.is_cohort_admin(cohort_id)
                   else private.is_platform_admin() end);

create policy settings_select on public.platform_settings for select to authenticated using (private.is_active_user());
create policy settings_write on public.platform_settings for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());

create policy audit_select on public.audit_events for select to authenticated
  using (private.is_platform_admin() or (cohort_id is not null and private.is_cohort_admin(cohort_id))
         or (offering_id is not null and private.is_offering_admin(offering_id)));
