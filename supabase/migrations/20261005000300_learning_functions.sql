-- Learning-structure operations exposed as RPC. Every function validates the
-- caller with auth.uid() and the helper predicates; client-supplied role,
-- owner or score fields are never trusted.

create or replace function private.require_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null or not private.is_active_user() then
    raise exception 'Not signed in or account inactive' using errcode = '42501';
  end if;
  return uid;
end $$;

create or replace function private.notify(p_user uuid, p_kind text, p_offering uuid, p_cohort uuid, p_title text,
                                          p_body text, p_url text, p_dedupe text, p_at timestamptz default now())
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.notification_preferences np where np.user_id = p_user and np.kind = p_kind and not np.in_app) then
    return;
  end if;
  insert into public.notifications (user_id, kind, offering_id, cohort_id, title, body, target_url, dedupe_key, occurred_at)
  values (p_user, p_kind, p_offering, p_cohort, left(p_title, 300), left(coalesce(p_body, ''), 500), p_url, p_dedupe, p_at)
  on conflict (user_id, dedupe_key) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Caller context (UI hints only; every operation re-checks on the server/DB)
-- ---------------------------------------------------------------------------
create or replace function public.my_context() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then
    return null;
  end if;
  return jsonb_build_object(
    'user_id', uid,
    'active', private.is_active_user(),
    'is_platform_admin', private.is_platform_admin(),
    'coordinator_cohorts', coalesce((select jsonb_agg(s.cohort_id) from public.coordinator_scopes s
                                      join public.platform_role_grants g on g.user_id = s.user_id and g.role = 'coordinator' and g.revoked_at is null
                                      where s.user_id = uid), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('offering_id', sa.offering_id, 'role', sa.role,
                                       'can_author', sa.role = 'instructor' or sa.can_author,
                                       'can_grade', sa.role = 'instructor' or sa.can_grade,
                                       'can_publish_grades', sa.role = 'instructor' or sa.can_publish_grades))
                       from public.staff_assignments sa where sa.user_id = uid), '[]'::jsonb),
    'enrollments', coalesce((select jsonb_agg(jsonb_build_object('offering_id', e.offering_id, 'status', e.status))
                             from public.enrollments e where e.user_id = uid), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Catalog: deliberately limited metadata projection
-- ---------------------------------------------------------------------------
create or replace function public.catalog_list() returns table (
  offering_id uuid, offering_code text, course_code text, title text, summary text, audience text,
  expected_effort text, cohort_name text, term_label text, starts_at timestamptz, ends_at timestamptz,
  timezone text, catalog_state text, my_state text)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null and coalesce((select value from public.platform_settings where key = 'public_catalog'), 'false') <> 'true' then
    return;
  end if;
  return query
  select o.id, o.code, c.code, v.title, v.summary, v.audience, v.expected_effort, co.name, o.term_label,
         o.starts_at, o.ends_at, o.timezone, o.catalog_state,
         case
           when uid is null then 'signed_out'
           when exists (select 1 from public.enrollments e where e.offering_id = o.id and e.user_id = uid and e.status in ('active', 'completed')) then 'enrolled'
           when exists (select 1 from public.staff_assignments sa where sa.offering_id = o.id and sa.user_id = uid) then 'staff'
           when exists (select 1 from public.access_requests ar where ar.offering_id = o.id and ar.user_id = uid and ar.status = 'pending') then 'requested'
           when o.catalog_state = 'open_for_requests' then 'can_request'
           else 'not_open'
         end
  from public.course_offerings o
  join public.courses c on c.id = o.course_id
  join public.course_versions v on v.id = o.course_version_id
  join public.cohorts co on co.id = o.cohort_id
  where o.catalog_visible and o.status = 'published' and v.status in ('published', 'archived')
  order by o.starts_at nulls last, v.title;
end $$;

create or replace function public.request_access(p_offering uuid, p_message text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  rid uuid;
begin
  perform private.hit_rate_limit('access_request:' || uid, 10, 3600);
  if not exists (select 1 from public.course_offerings o where o.id = p_offering and o.catalog_visible
                 and o.status = 'published' and o.catalog_state = 'open_for_requests') then
    raise exception 'This offering is not open for access requests';
  end if;
  if exists (select 1 from public.enrollments e where e.offering_id = p_offering and e.user_id = uid) then
    raise exception 'You already have an enrollment record for this offering';
  end if;
  insert into public.access_requests (offering_id, user_id, message)
  values (p_offering, uid, left(coalesce(p_message, ''), 2000))
  on conflict do nothing
  returning id into rid;
  if rid is null then
    select id into rid from public.access_requests where offering_id = p_offering and user_id = uid and status = 'pending';
  end if;
  return rid;
end $$;

create or replace function public.review_access_request(p_request uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  r public.access_requests;
begin
  select * into r from public.access_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if not private.is_offering_admin(r.offering_id) then
    raise exception 'Not authorized to review this request' using errcode = '42501';
  end if;
  if r.status <> 'pending' then raise exception 'Request was already reviewed'; end if;
  update public.access_requests set status = case when p_approve then 'approved' else 'declined' end,
    reviewed_by = uid, reviewed_at = now(), review_note = left(coalesce(p_note, ''), 2000)
  where id = p_request;
  if p_approve then
    insert into public.enrollments (offering_id, user_id, status, source, created_by)
    values (r.offering_id, r.user_id, 'active', 'access_request', uid)
    on conflict (offering_id, user_id) do update set status = 'active';
  end if;
  perform private.audit(case when p_approve then 'access_request.approve' else 'access_request.decline' end,
                        'access_requests', r.id::text, r.offering_id, null, '{}'::jsonb);
  perform private.notify(r.user_id, 'access_request', r.offering_id, null,
    case when p_approve then 'Access request approved' else 'Access request declined' end, '',
    case when p_approve then '/courses/' || r.offering_id else '/catalog' end, 'access_request:' || r.id);
end $$;

-- ---------------------------------------------------------------------------
-- Invitations: matched against the caller's verified auth email
-- ---------------------------------------------------------------------------
create or replace function private.my_verified_email() returns extensions.citext
language sql stable security definer set search_path = '' as $$
  select u.email::extensions.citext from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
$$;

create or replace function public.list_my_invitations() returns table (
  id uuid, role text, cohort_name text, offering_code text, offering_title text, expires_at timestamptz, state text)
language sql stable security definer set search_path = '' as $$
  select i.id, i.role, co.name, o.code, v.title, i.expires_at,
         case when i.revoked_at is not null then 'revoked'
              when i.accepted_at is not null then 'accepted'
              when i.expires_at < now() then 'expired'
              else 'pending' end
  from public.invitations i
  left join public.course_offerings o on o.id = i.offering_id
  left join public.course_versions v on v.id = o.course_version_id
  left join public.cohorts co on co.id = coalesce(i.cohort_id, o.cohort_id)
  where i.email = private.my_verified_email()
  order by i.created_at desc;
$$;

create or replace function public.accept_invitation(p_invitation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  inv public.invitations;
  v_cohort uuid;
begin
  select * into inv from public.invitations where id = p_invitation for update;
  if not found or inv.email is distinct from private.my_verified_email() then
    raise exception 'Invitation not found for your verified email address' using errcode = '42501';
  end if;
  if inv.revoked_at is not null then raise exception 'This invitation was revoked'; end if;
  if inv.accepted_at is not null then raise exception 'This invitation was already used'; end if;
  if inv.expires_at < now() then raise exception 'This invitation has expired. Ask your program administrator for a new one.'; end if;

  v_cohort := coalesce(inv.cohort_id, private.offering_cohort(inv.offering_id));
  if inv.role = 'participant' then
    insert into public.cohort_participation (cohort_id, user_id, status, created_by)
    values (v_cohort, uid, 'active', inv.created_by)
    on conflict (cohort_id, user_id) do update set status = 'active';
    if inv.offering_id is not null then
      insert into public.enrollments (offering_id, user_id, status, source, created_by)
      values (inv.offering_id, uid, 'active', 'invitation', inv.created_by)
      on conflict (offering_id, user_id) do update set status = 'active';
    end if;
  else
    insert into public.staff_assignments (offering_id, user_id, role, can_author, can_grade, can_publish_grades, created_by)
    values (inv.offering_id, uid, inv.role, inv.role = 'instructor', true, inv.role = 'instructor', inv.created_by)
    on conflict (offering_id, user_id) do nothing;
  end if;
  update public.invitations set accepted_at = now(), accepted_by = uid where id = inv.id;
  return jsonb_build_object('offering_id', inv.offering_id, 'cohort_id', v_cohort);
end $$;

-- ---------------------------------------------------------------------------
-- Course versions: draft, publish, adopt
-- ---------------------------------------------------------------------------
create or replace function public.create_course_draft(p_course uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  src public.course_versions;
  new_id uuid;
  next_no integer;
  m record;
  new_module uuid;
  l record;
  new_lesson uuid;
begin
  if not private.can_author_course(p_course) then
    raise exception 'Not authorized to author this course' using errcode = '42501';
  end if;
  select id into new_id from public.course_versions where course_id = p_course and status = 'draft';
  if new_id is not null then
    return new_id;
  end if;
  select coalesce(max(version_no), 0) + 1 into next_no from public.course_versions where course_id = p_course;
  select * into src from public.course_versions where course_id = p_course and status in ('published', 'archived')
    order by version_no desc limit 1;
  if not found then
    insert into public.course_versions (course_id, version_no, title, created_by)
    select p_course, next_no, c.title, uid from public.courses c where c.id = p_course
    returning id into new_id;
    return new_id;
  end if;
  insert into public.course_versions (course_id, version_no, status, title, summary, objectives, audience, expected_effort,
    prerequisites_text, syllabus_html, grading_policy, based_on_version_id, created_by)
  values (p_course, next_no, 'draft', src.title, src.summary, src.objectives, src.audience, src.expected_effort,
    src.prerequisites_text, src.syllabus_html, src.grading_policy, src.id, uid)
  returning id into new_id;
  for m in select * from public.modules where course_version_id = src.id order by position loop
    insert into public.modules (course_version_id, lineage_id, position, title, description)
    values (new_id, m.lineage_id, m.position, m.title, m.description) returning id into new_module;
    for l in select * from public.lessons where module_id = m.id order by position loop
      insert into public.lessons (module_id, course_version_id, lineage_id, position, title, content_type, body_html, required,
        duration_minutes, completion_rule, external_url, embed_provider, embed_id, transcript)
      values (new_module, new_id, l.lineage_id, l.position, l.title, l.content_type, l.body_html, l.required,
        l.duration_minutes, l.completion_rule, l.external_url, l.embed_provider, l.embed_id, l.transcript)
      returning id into new_lesson;
      insert into public.lesson_assets (lesson_id, asset_id, role, position, caption_language)
      select new_lesson, la.asset_id, la.role, la.position, la.caption_language from public.lesson_assets la where la.lesson_id = l.id;
    end loop;
  end loop;
  perform private.audit('course_version.create_draft', 'course_versions', new_id::text, null, null,
                        jsonb_build_object('course_id', p_course, 'based_on', src.id));
  return new_id;
end $$;

create or replace function public.publish_course_version(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  v public.course_versions;
begin
  select * into v from public.course_versions where id = p_version for update;
  if not found or not private.can_author_course(v.course_id) then
    raise exception 'Not authorized to publish this course version' using errcode = '42501';
  end if;
  if v.status <> 'draft' then raise exception 'Only drafts can be published'; end if;
  if not exists (select 1 from public.lessons where course_version_id = p_version) then
    raise exception 'Add at least one lesson before publishing';
  end if;
  if exists (select 1 from public.lesson_assets la join public.lessons l on l.id = la.lesson_id
             join public.content_assets a on a.id = la.asset_id
             where l.course_version_id = p_version and a.status <> 'ready') then
    raise exception 'All attached files must finish uploading and screening before publishing';
  end if;
  update public.course_versions set status = 'published', published_at = now(), published_by = uid where id = p_version;
  perform private.audit('course_version.publish', 'course_versions', p_version::text, null, null,
                        jsonb_build_object('course_id', v.course_id, 'version_no', v.version_no));
end $$;

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
  select * into v from public.course_versions where id = p_version;
  if not found or v.course_id <> o.course_id or v.status <> 'published' then
    raise exception 'Only a published version of the same course can be adopted';
  end if;
  update public.course_offerings set course_version_id = p_version where id = p_offering;
  perform private.audit('offering.adopt_version', 'course_offerings', p_offering::text, p_offering, o.cohort_id,
                        jsonb_build_object('from', o.course_version_id, 'to', p_version));
  if o.status = 'published' then
    for r in select e.user_id from public.enrollments e where e.offering_id = p_offering and e.status = 'active' loop
      perform private.notify(r.user_id, 'content', p_offering, null, 'Course content updated', v.title,
                             '/courses/' || p_offering || '/content', 'content:' || p_offering || ':' || p_version);
    end loop;
  end if;
end $$;

-- Notify enrolled learners when an offering is first published.
create or replace function private.on_offering_published() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record; t text;
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    select title into t from public.course_versions where id = new.course_version_id;
    for r in select e.user_id from public.enrollments e where e.offering_id = new.id and e.status = 'active' loop
      perform private.notify(r.user_id, 'content', new.id, null, 'Course available', t,
                             '/courses/' || new.id, 'content:' || new.id || ':' || new.course_version_id);
    end loop;
  end if;
  return new;
end $$;
create trigger course_offerings_published after update on public.course_offerings
  for each row execute function private.on_offering_published();

-- ---------------------------------------------------------------------------
-- Outline, progress and completion
-- ---------------------------------------------------------------------------
create or replace function public.offering_outline(p_offering uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  o public.course_offerings;
  is_staff boolean;
  result jsonb;
begin
  if not private.can_view_offering(p_offering) then
    raise exception 'Not authorized to view this offering' using errcode = '42501';
  end if;
  select * into o from public.course_offerings where id = p_offering;
  is_staff := private.has_staff_perm(p_offering, 'view');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'lineage_id', m.lineage_id, 'title', m.title, 'description', m.description, 'position', m.position,
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'lineage_id', l.lineage_id, 'title', l.title, 'content_type', l.content_type, 'required', l.required,
        'duration_minutes', l.duration_minutes, 'completion_rule', l.completion_rule, 'position', l.position,
        'lock_reasons', case when is_staff then '[]'::jsonb else private.lesson_lock_reasons(p_offering, l.lineage_id, uid) end,
        'completed_at', lp.completed_at, 'last_position_seconds', lp.last_position_seconds
      ) order by l.position)
      from public.lessons l
      left join public.lesson_progress lp on lp.offering_id = p_offering and lp.user_id = uid and lp.lesson_lineage = l.lineage_id
      where l.module_id = m.id), '[]'::jsonb)
  ) order by m.position), '[]'::jsonb)
  into result
  from public.modules m where m.course_version_id = o.course_version_id;
  return jsonb_build_object('offering_id', p_offering, 'course_version_id', o.course_version_id, 'is_staff', is_staff, 'modules', result);
end $$;

-- Required-item progress: computed on the server from the offering's adopted version.
create or replace function public.course_progress(p_offering uuid, p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  target uuid := coalesce(p_user, uid);
  total integer;
  done integer;
  next_lesson uuid;
begin
  if target <> uid and not private.has_staff_perm(p_offering, 'view') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if target = uid and not private.can_view_offering(p_offering) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select count(*), count(lp.completed_at) into total, done
  from public.course_offerings o
  join public.lessons l on l.course_version_id = o.course_version_id and l.required
  left join public.lesson_progress lp on lp.offering_id = o.id and lp.user_id = target and lp.lesson_lineage = l.lineage_id
  where o.id = p_offering;
  select l.id into next_lesson
  from public.course_offerings o
  join public.modules m on m.course_version_id = o.course_version_id
  join public.lessons l on l.module_id = m.id
  left join public.lesson_progress lp on lp.offering_id = o.id and lp.user_id = target and lp.lesson_lineage = l.lineage_id
  where o.id = p_offering and lp.completed_at is null
  order by m.position, l.position limit 1;
  return jsonb_build_object('required_total', total, 'required_completed', done,
                            'percent', case when total = 0 then null else round(done::numeric / total * 100, 0) end,
                            'next_lesson_id', next_lesson);
end $$;

create or replace function public.mark_lesson_progress(p_offering uuid, p_lesson uuid, p_position_seconds integer,
                                                      p_duration_seconds integer, p_complete boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  l public.lessons;
  o public.course_offerings;
  allow_complete boolean;
  prog public.lesson_progress;
  total integer; done integer;
begin
  select * into o from public.course_offerings where id = p_offering;
  select * into l from public.lessons where id = p_lesson;
  if o.id is null or l.id is null or l.course_version_id <> o.course_version_id then
    raise exception 'Lesson does not belong to this offering';
  end if;
  if not private.is_active_learner(p_offering) then
    raise exception 'Only actively enrolled learners record progress' using errcode = '42501';
  end if;
  if jsonb_array_length(private.lesson_lock_reasons(p_offering, l.lineage_id, uid)) > 0 then
    raise exception 'This lesson is locked' using errcode = '42501';
  end if;
  insert into public.lesson_progress (offering_id, user_id, lesson_lineage, last_lesson_id, last_position_seconds, max_position_seconds, duration_seconds)
  values (p_offering, uid, l.lineage_id, l.id, greatest(coalesce(p_position_seconds, 0), 0), greatest(coalesce(p_position_seconds, 0), 0), p_duration_seconds)
  on conflict (offering_id, user_id, lesson_lineage) do update set
    last_lesson_id = excluded.last_lesson_id,
    last_position_seconds = excluded.last_position_seconds,
    max_position_seconds = greatest(public.lesson_progress.max_position_seconds, excluded.last_position_seconds),
    duration_seconds = coalesce(excluded.duration_seconds, public.lesson_progress.duration_seconds),
    updated_at = now()
  returning * into prog;

  if p_complete and prog.completed_at is null then
    -- Video lessons with a playback rule: furthest position must reach 90% of the duration.
    allow_complete := l.completion_rule <> 'video_watched'
      or (prog.duration_seconds is not null and prog.duration_seconds > 0 and prog.max_position_seconds >= prog.duration_seconds * 0.9);
    if not allow_complete then
      raise exception 'Watch at least 90%% of the video before marking it complete';
    end if;
    update public.lesson_progress set completed_at = now()
    where offering_id = p_offering and user_id = uid and lesson_lineage = l.lineage_id
    returning * into prog;
    -- Completion snapshot once all required items are complete.
    select count(*), count(lp.completed_at) into total, done
    from public.lessons rl
    left join public.lesson_progress lp on lp.offering_id = p_offering and lp.user_id = uid and lp.lesson_lineage = rl.lineage_id
    where rl.course_version_id = o.course_version_id and rl.required;
    if total > 0 and total = done then
      insert into public.completion_snapshots (offering_id, user_id, course_version_id, required_total, required_completed)
      values (p_offering, uid, o.course_version_id, total, done)
      on conflict (offering_id, user_id) do nothing;
    end if;
  end if;
  return jsonb_build_object('completed_at', prog.completed_at, 'last_position_seconds', prog.last_position_seconds);
end $$;

-- ---------------------------------------------------------------------------
-- Directory helpers (no emails)
-- ---------------------------------------------------------------------------
create or replace function public.list_scope_members(p_offering uuid, p_cohort uuid) returns table (
  user_id uuid, display_name text, scope_role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  if p_offering is not null then
    if not private.can_view_offering(p_offering) then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
    return query
      select p.id, p.display_name, sa.role from public.staff_assignments sa join public.profiles p on p.id = sa.user_id
      where sa.offering_id = p_offering and p.suspended_at is null
      union
      select p.id, p.display_name, 'learner' from public.enrollments e join public.profiles p on p.id = e.user_id
      where e.offering_id = p_offering and e.status = 'active' and p.suspended_at is null
        and not exists (select 1 from public.staff_assignments sa2 where sa2.offering_id = p_offering and sa2.user_id = e.user_id)
      order by 3 desc, 2;
  elsif p_cohort is not null then
    if not private.is_cohort_member(p_cohort) then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
    return query
      select distinct on (p.id) p.id, p.display_name,
             case when exists (select 1 from public.staff_assignments sa join public.course_offerings o on o.id = sa.offering_id
                               where o.cohort_id = p_cohort and sa.user_id = p.id) then 'staff' else 'participant' end
      from public.profiles p
      where p.suspended_at is null and (
        exists (select 1 from public.cohort_participation cp where cp.cohort_id = p_cohort and cp.user_id = p.id and cp.status = 'active')
        or exists (select 1 from public.staff_assignments sa join public.course_offerings o on o.id = sa.offering_id
                   where o.cohort_id = p_cohort and sa.user_id = p.id))
      order by p.id, p.display_name;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Administration
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_users(p_search text default '') returns table (
  user_id uuid, display_name text, email text, email_confirmed boolean, suspended boolean, roles text[], created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;
  return query
  select p.id, p.display_name, u.email::text, u.email_confirmed_at is not null, p.suspended_at is not null,
         coalesce(array(select g.role from public.platform_role_grants g where g.user_id = p.id and g.revoked_at is null), '{}'),
         p.created_at
  from public.profiles p join auth.users u on u.id = p.id
  where coalesce(p_search, '') = '' or p.display_name ilike '%' || p_search || '%' or u.email ilike '%' || p_search || '%'
  order by p.created_at desc
  limit 200;
end $$;

create or replace function public.admin_set_suspended(p_user uuid, p_suspended boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  if p_user = uid then raise exception 'You cannot suspend your own account'; end if;
  update public.profiles set suspended_at = case when p_suspended then now() else null end where id = p_user;
  perform private.audit(case when p_suspended then 'account.suspend' else 'account.reinstate' end, 'profiles', p_user::text, null, null, '{}'::jsonb);
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role text, p_grant boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  if p_role not in ('platform_admin', 'coordinator') then raise exception 'Unknown role'; end if;
  if p_grant then
    insert into public.platform_role_grants (user_id, role, granted_by) values (p_user, p_role, uid) on conflict do nothing;
  else
    if p_user = uid and p_role = 'platform_admin' then raise exception 'You cannot remove your own administrator role'; end if;
    update public.platform_role_grants set revoked_at = now(), revoked_by = uid
    where user_id = p_user and role = p_role and revoked_at is null;
  end if;
end $$;

create or replace function public.completion_report(p_offering uuid) returns table (
  user_id uuid, display_name text, enrollment_status text, required_total integer, required_completed integer, completed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_staff_perm(p_offering, 'view') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select e.user_id, p.display_name, e.status,
         (select count(*)::integer from public.lessons l join public.course_offerings o on o.course_version_id = l.course_version_id
          where o.id = p_offering and l.required),
         (select count(*)::integer from public.lessons l join public.course_offerings o on o.course_version_id = l.course_version_id
          join public.lesson_progress lp on lp.offering_id = o.id and lp.user_id = e.user_id and lp.lesson_lineage = l.lineage_id and lp.completed_at is not null
          where o.id = p_offering and l.required),
         cs.completed_at
  from public.enrollments e
  join public.profiles p on p.id = e.user_id
  left join public.completion_snapshots cs on cs.offering_id = e.offering_id and cs.user_id = e.user_id
  where e.offering_id = p_offering
  order by p.display_name;
end $$;
