-- Comms area (messages, announcements, discussions, cohorts and communities).
--
-- Read helpers below return display names only (never emails or other private
-- fields) and only for scopes the caller may already see; each one re-checks access
-- with the private helpers. They exist because profile RLS (shares_scope) does not
-- cover every legitimate case: community co-members, cohort coordinators, and
-- authors in a cohort or community discussion who share no course with the reader.
--
-- Writes still go through the tables (RLS) and the 0500 RPCs. This file adds:
--   * a server-time publication stamp and audit entries for announcements,
--   * a rate limit for discussion topic creation (learners can open community topics).
-- Safe to re-apply: functions are replaced and triggers recreated.

-- ---------------------------------------------------------------------------
-- Announcements: publication time comes from the database clock
-- ---------------------------------------------------------------------------
-- "Publish now" (status published, no publish_at) records the database time as the
-- publication time, so the posted date is the real release time and visibility never
-- depends on the web server's clock. Existing published rows without publish_at keep
-- it null when they are merely edited or pinned.
create or replace function private.comms_stamp_announcement() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'published' and new.publish_at is null
     and (tg_op = 'INSERT' or old.status is distinct from 'published' or old.publish_at is not null) then
    new.publish_at := now();
  end if;
  return new;
end $$;

drop trigger if exists announcements_stamp on public.announcements;
create trigger announcements_stamp before insert or update on public.announcements
  for each row execute function private.comms_stamp_announcement();

-- Publication and archiving are audited (actor, scope, time, target).
create or replace function private.comms_audit_announcement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published'
                                   or old.publish_at is distinct from new.publish_at) then
    perform private.audit('announcement.publish', 'announcements', new.id::text, new.offering_id, new.cohort_id,
      jsonb_build_object('publish_at', new.publish_at, 'scheduled', new.publish_at > now()));
  elsif tg_op = 'UPDATE' and new.status <> old.status then
    perform private.audit('announcement.' || new.status, 'announcements', new.id::text, new.offering_id, new.cohort_id,
      jsonb_build_object('from', old.status));
  end if;
  return null;
end $$;

drop trigger if exists announcements_audit on public.announcements;
create trigger announcements_audit after insert or update on public.announcements
  for each row execute function private.comms_audit_announcement();

-- ---------------------------------------------------------------------------
-- Discussions
-- ---------------------------------------------------------------------------
create or replace function private.comms_on_topic_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.hit_rate_limit('topic:' || new.created_by, 20, 3600);
  return new;
end $$;

drop trigger if exists discussion_topics_rate on public.discussion_topics;
create trigger discussion_topics_rate before insert on public.discussion_topics
  for each row execute function private.comms_on_topic_insert();

-- One page of topics for a course offering, cohort or community, with post counts and
-- last activity. Pinned topics first, then most recent activity.
create or replace function public.comms_topic_list(p_offering uuid, p_cohort uuid, p_community uuid,
                                                  p_page integer default 1, p_page_size integer default 20)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  size integer := greatest(least(coalesce(p_page_size, 20), 100), 1);
  pg integer := greatest(coalesce(p_page, 1), 1);
  total integer;
  items jsonb;
begin
  if num_nonnulls(p_offering, p_cohort, p_community) <> 1 then
    raise exception 'Choose one course, cohort or community';
  end if;
  if not ((p_offering is not null and private.can_view_offering(p_offering))
       or (p_cohort is not null and private.is_cohort_member(p_cohort))
       or (p_community is not null and private.is_community_member(p_community))) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select count(*)::integer into total
  from public.discussion_topics t
  where (p_offering is not null and t.offering_id = p_offering)
     or (p_cohort is not null and t.cohort_id = p_cohort)
     or (p_community is not null and t.community_id = p_community);

  with scoped as (
    select t.id, t.title, t.pinned, t.locked, t.created_at, t.created_by,
           (select count(*)::integer from public.discussion_posts dp where dp.topic_id = t.id) as post_count,
           greatest(t.created_at, coalesce((select max(dp.created_at) from public.discussion_posts dp where dp.topic_id = t.id), t.created_at)) as last_activity_at
    from public.discussion_topics t
    where (p_offering is not null and t.offering_id = p_offering)
       or (p_cohort is not null and t.cohort_id = p_cohort)
       or (p_community is not null and t.community_id = p_community)
  ), page as (
    select s.* from scoped s
    order by s.pinned desc, s.last_activity_at desc, s.id
    limit size offset (pg - 1) * size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'title', p.title, 'pinned', p.pinned, 'locked', p.locked, 'created_at', p.created_at,
           'author_name', pr.display_name, 'post_count', p.post_count, 'last_activity_at', p.last_activity_at)
         order by p.pinned desc, p.last_activity_at desc, p.id), '[]'::jsonb)
  into items
  from page p
  left join public.profiles pr on pr.id = p.created_by;

  return jsonb_build_object('total', total, 'page', pg, 'page_size', size, 'topics', items);
end $$;

-- A topic with one page of top-level posts and every reply beneath them. Hidden-post
-- reasons are returned only to moderators and the post's author.
create or replace function public.comms_topic_posts(p_topic uuid, p_page integer default 1, p_page_size integer default 20)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  t public.discussion_topics;
  size integer := greatest(least(coalesce(p_page_size, 20), 50), 1);
  pg integer := greatest(coalesce(p_page, 1), 1);
  is_mod boolean;
  total integer;
  roots uuid[];
  posts jsonb;
begin
  select * into t from public.discussion_topics where id = p_topic;
  if not found or not private.can_view_topic(p_topic) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  is_mod := private.can_moderate_topic(p_topic);

  select count(*)::integer into total from public.discussion_posts where topic_id = p_topic and parent_id is null;
  select coalesce(array_agg(r.id order by r.created_at, r.id), '{}') into roots
  from (select dp.id, dp.created_at from public.discussion_posts dp
        where dp.topic_id = p_topic and dp.parent_id is null
        order by dp.created_at, dp.id
        limit size offset (pg - 1) * size) r;

  with recursive tree as (
    select dp.id, dp.id as root_id from public.discussion_posts dp where dp.id = any (roots)
    union all
    select c.id, tr.root_id from public.discussion_posts c join tree tr on c.parent_id = tr.id
    where c.topic_id = p_topic
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', dp.id, 'parent_id', dp.parent_id, 'root_id', tr.root_id, 'author_id', dp.author_id,
           'author_name', pr.display_name, 'body_html', dp.body_html, 'created_at', dp.created_at,
           'edited_at', dp.edited_at, 'hidden_at', dp.hidden_at,
           'hidden_reason', case when is_mod or dp.author_id = uid then dp.hidden_reason end,
           'revision_count', (select count(*)::integer from public.discussion_post_revisions rv where rv.post_id = dp.id))
         order by dp.created_at, dp.id), '[]'::jsonb)
  into posts
  from tree tr
  join public.discussion_posts dp on dp.id = tr.id
  left join public.profiles pr on pr.id = dp.author_id;

  return jsonb_build_object(
    'topic', jsonb_build_object(
      'id', t.id, 'title', t.title, 'body_html', t.body_html, 'pinned', t.pinned, 'locked', t.locked,
      'created_at', t.created_at, 'author_name', (select p.display_name from public.profiles p where p.id = t.created_by),
      'offering_id', t.offering_id, 'cohort_id', t.cohort_id, 'community_id', t.community_id),
    'can_moderate', is_mod,
    'total', total, 'page', pg, 'page_size', size,
    'posts', posts);
end $$;

-- ---------------------------------------------------------------------------
-- Messaging: the exact people the caller may address in a scope
-- ---------------------------------------------------------------------------
-- Names only. The caller must be able to message in the scope (no enumeration of
-- other courses or cohorts), and every row passes the same check create_thread uses.
create or replace function public.comms_recipients(p_offering uuid, p_cohort uuid)
returns table (user_id uuid, display_name text, scope_role text)
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  v_cohort uuid;
begin
  if (p_offering is null) = (p_cohort is null) then
    raise exception 'Choose one course or cohort';
  end if;
  if not private.can_message_in_scope(p_offering, p_cohort, uid) then
    raise exception 'You cannot send messages in this course or cohort' using errcode = '42501';
  end if;
  v_cohort := coalesce(p_cohort, (select o.cohort_id from public.course_offerings o where o.id = p_offering));
  return query
  with candidates as (
    select sa.user_id as uid_, (case when sa.role = 'instructor' then 'instructor' else 'ta' end) as role_, 1 as rank_
      from public.staff_assignments sa where p_offering is not null and sa.offering_id = p_offering
    union all
    select e.user_id, 'learner', 3 from public.enrollments e
      where p_offering is not null and e.offering_id = p_offering and e.status = 'active'
    union all
    select sa.user_id, (case when sa.role = 'instructor' then 'instructor' else 'ta' end), 1
      from public.staff_assignments sa join public.course_offerings o on o.id = sa.offering_id
      where p_cohort is not null and o.cohort_id = p_cohort
    union all
    select cp.user_id, 'participant', 3 from public.cohort_participation cp
      where p_cohort is not null and cp.cohort_id = p_cohort and cp.status = 'active'
    union all
    select cs.user_id, 'coordinator', 2 from public.coordinator_scopes cs
      join public.platform_role_grants g on g.user_id = cs.user_id and g.role = 'coordinator' and g.revoked_at is null
      where cs.cohort_id = v_cohort
  ), best as (
    select distinct on (c.uid_) c.uid_, c.role_
    from candidates c
    order by c.uid_, c.rank_, c.role_
  )
  select p.id, p.display_name, b.role_
  from best b
  join public.profiles p on p.id = b.uid_
  where b.uid_ <> uid and p.suspended_at is null
    and private.can_message_in_scope(p_offering, p_cohort, b.uid_)
  order by p.display_name;
end $$;

-- ---------------------------------------------------------------------------
-- Cohorts and communities
-- ---------------------------------------------------------------------------
-- Cohort page directory: course offerings, staff, coordinators and the approved
-- (active) participant roster. Draft offerings appear only to people who may open them.
create or replace function public.comms_cohort_overview(p_cohort uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  is_admin boolean;
begin
  if not private.is_cohort_member(p_cohort) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  is_admin := private.is_cohort_admin(p_cohort);
  return jsonb_build_object(
    'offerings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'code', o.code, 'title', v.title, 'term_label', o.term_label, 'status', o.status,
               'accent_color', o.accent_color, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'timezone', o.timezone,
               'can_open', private.can_view_offering(o.id) or is_admin)
             order by o.starts_at nulls last, o.code)
      from public.course_offerings o
      join public.course_versions v on v.id = o.course_version_id
      where o.cohort_id = p_cohort and (o.status <> 'draft' or is_admin or private.can_view_offering(o.id))), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'name', s.display_name, 'roles', s.roles) order by s.display_name)
      from (
        select p.id as user_id, p.display_name,
               jsonb_agg(jsonb_build_object('role', sa.role, 'offering_code', o.code) order by o.code) as roles
        from public.staff_assignments sa
        join public.course_offerings o on o.id = sa.offering_id
        join public.profiles p on p.id = sa.user_id
        where o.cohort_id = p_cohort and p.suspended_at is null
          and (o.status <> 'draft' or is_admin or private.can_view_offering(o.id))
        group by p.id, p.display_name
      ) s), '[]'::jsonb),
    'coordinators', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.display_name) order by p.display_name)
      from public.coordinator_scopes cs
      join public.platform_role_grants g on g.user_id = cs.user_id and g.role = 'coordinator' and g.revoked_at is null
      join public.profiles p on p.id = cs.user_id
      where cs.cohort_id = p_cohort and p.suspended_at is null), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.id, 'name', p.display_name) order by p.display_name)
      from public.cohort_participation cp
      join public.profiles p on p.id = cp.user_id
      where cp.cohort_id = p_cohort and cp.status = 'active' and p.suspended_at is null), '[]'::jsonb),
    'is_admin', is_admin
  );
end $$;

-- Communities the caller can see (optionally one), with counts and the caller's state.
-- Joining a community never changes course or cohort access.
create or replace function public.comms_communities(p_community uuid default null)
returns table (community_id uuid, cohort_id uuid, cohort_name text, name text, description text, join_policy text,
               member_count integer, topic_count integer, is_member boolean, can_manage boolean)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  return query
  select c.id, c.cohort_id, co.name, c.name, c.description, c.join_policy,
         (select count(*)::integer from public.community_members m join public.profiles p on p.id = m.user_id
           where m.community_id = c.id and p.suspended_at is null),
         (select count(*)::integer from public.discussion_topics dt where dt.community_id = c.id),
         exists (select 1 from public.community_members m where m.community_id = c.id and m.user_id = uid),
         case when c.cohort_id is null then private.is_platform_admin() else private.is_cohort_admin(c.cohort_id) end
  from public.communities c
  left join public.cohorts co on co.id = c.cohort_id
  where (p_community is null or c.id = p_community) and private.can_view_community(c.id)
  order by c.name;
end $$;

-- Member names of a community, for its members and administrators only.
create or replace function public.comms_community_members(p_community uuid)
returns table (user_id uuid, display_name text, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.is_community_member(p_community) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select m.user_id, p.display_name, m.joined_at
  from public.community_members m
  join public.profiles p on p.id = m.user_id
  where m.community_id = p_community and p.suspended_at is null
  order by p.display_name;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only
-- ---------------------------------------------------------------------------
revoke all on function public.comms_topic_list(uuid, uuid, uuid, integer, integer) from public, anon;
revoke all on function public.comms_topic_posts(uuid, integer, integer) from public, anon;
revoke all on function public.comms_recipients(uuid, uuid) from public, anon;
revoke all on function public.comms_cohort_overview(uuid) from public, anon;
revoke all on function public.comms_communities(uuid) from public, anon;
revoke all on function public.comms_community_members(uuid) from public, anon;
grant execute on function
  public.comms_topic_list(uuid, uuid, uuid, integer, integer),
  public.comms_topic_posts(uuid, integer, integer),
  public.comms_recipients(uuid, uuid),
  public.comms_cohort_overview(uuid),
  public.comms_communities(uuid),
  public.comms_community_members(uuid)
to authenticated;
revoke all on function private.comms_stamp_announcement(), private.comms_audit_announcement(), private.comms_on_topic_insert()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
