-- Community management for administrators (Administration → Communities).
--
-- Already in place (20261005000200): communities_write lets platform administrators manage
-- program-wide communities (no cohort) and cohort administrators (platform administrators and
-- that cohort's coordinators) manage the communities of their cohort; community_members_leave
-- lets those same administrators remove members; community_members_join lets a person add only
-- themselves, and only to an open community they can see.
--
-- Missing, added here:
--   * a way for those administrators to add another person to a community (invitation-only ones
--     included), with the person's eligibility checked: an active account and, for a cohort's
--     community, someone who belongs to that cohort (so they can actually see the community);
--   * a member list with eligible people to add, for administrators of the community;
--   * audit entries for community changes and for members added or removed by administrators;
--   * a guard so a community cannot move to a cohort some of its members do not belong to.
--
-- Community membership stays separate from cohort and course access: nothing here writes
-- cohort_participation, enrollments or staff_assignments, and no access helper reads
-- community_members except for the community's own pages and topics.

-- ---------------------------------------------------------------------------
-- Helpers (called only inside SECURITY DEFINER functions; not executable by API roles)
-- ---------------------------------------------------------------------------

-- Everyone who belongs to a cohort the way private.is_cohort_member() counts it for the
-- signed-in user: active participants, staff of its offerings, learners enrolled in its
-- released offerings, and its coordinators with an active coordinator role.
create or replace function private.cohort_people(p_cohort uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select cp.user_id from public.cohort_participation cp
  where cp.cohort_id = p_cohort and cp.status = 'active'
  union
  select sa.user_id from public.staff_assignments sa
  join public.course_offerings o on o.id = sa.offering_id
  where o.cohort_id = p_cohort
  union
  select e.user_id from public.enrollments e
  join public.course_offerings o on o.id = e.offering_id
  where o.cohort_id = p_cohort and e.status in ('active', 'completed') and o.status in ('published', 'archived')
  union
  select s.user_id from public.coordinator_scopes s
  join public.platform_role_grants g on g.user_id = s.user_id and g.role = 'coordinator' and g.revoked_at is null
  where s.cohort_id = p_cohort;
$$;

-- Whether a person (not necessarily the caller) can see a community of this cohort:
-- one of the cohort's people, or an active platform administrator.
create or replace function private.person_in_cohort(p_user uuid, p_cohort uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.cohort_people(p_cohort) cp(user_id) where cp.user_id = p_user)
      or exists (select 1 from public.platform_role_grants g
                 where g.user_id = p_user and g.role = 'platform_admin' and g.revoked_at is null);
$$;

-- The same rule as the communities_write policy, for the caller.
create or replace function private.can_manage_community(p_community uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.communities c
    where c.id = p_community
      and case when c.cohort_id is null then private.is_platform_admin() else private.is_cohort_admin(c.cohort_id) end
  );
$$;

-- ---------------------------------------------------------------------------
-- Integrity: a community moves to a cohort only when all its members belong to it.
-- ---------------------------------------------------------------------------
create or replace function private.guard_community_cohort() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.cohort_id is not null and new.cohort_id is distinct from old.cohort_id and exists (
    select 1 from public.community_members m
    where m.community_id = new.id and not private.person_in_cohort(m.user_id, new.cohort_id)
  ) then
    raise exception 'Some members of this community are not in that cohort. Remove them first or keep the current cohort.'
      using errcode = 'P0001', hint = 'community_members_outside_cohort';
  end if;
  return new;
end $$;

drop trigger if exists communities_cohort_guard on public.communities;
create trigger communities_cohort_guard before update of cohort_id on public.communities
  for each row execute function private.guard_community_cohort();

-- Community create, edit and delete are recorded like cohorts and courses.
drop trigger if exists communities_audit on public.communities;
create trigger communities_audit after insert or update or delete on public.communities
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Members and eligible people, for administrators of the community. Email addresses are
-- returned to platform administrators only (docs/PERMISSIONS.md); coordinators get null.
-- kind: 'member' (with joined_at) or 'candidate' (cohort communities only: people of the
-- cohort with an active account who are not members yet).
-- ---------------------------------------------------------------------------
create or replace function public.admin_community_people(p_community uuid)
returns table (kind text, user_id uuid, display_name text, email text, suspended boolean, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  c public.communities;
  show_email boolean;
begin
  perform private.require_user();
  select * into c from public.communities where id = p_community;
  if not found or not private.can_manage_community(p_community) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  show_email := private.is_platform_admin();
  return query
  select 'member'::text, m.user_id, p.display_name, case when show_email then u.email::text end,
         p.suspended_at is not null, m.joined_at
  from public.community_members m
  join public.profiles p on p.id = m.user_id
  join auth.users u on u.id = m.user_id
  where m.community_id = p_community
  union all
  select 'candidate'::text, p.id, p.display_name, case when show_email then u.email::text end, false, null::timestamptz
  from private.cohort_people(c.cohort_id) cp(user_id)
  join public.profiles p on p.id = cp.user_id
  join auth.users u on u.id = cp.user_id
  where c.cohort_id is not null and p.suspended_at is null and u.deleted_at is null
    and not exists (select 1 from public.community_members m where m.community_id = p_community and m.user_id = cp.user_id);
end $$;

-- Adds a person to a community (open or invitation only). Returns
-- 'added' | 'already_member' | 'not_found' | 'suspended' | 'not_in_cohort'; the app words them.
create or replace function public.admin_add_community_member(p_community uuid, p_user uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  c public.communities;
  v_suspended timestamptz;
  n integer;
begin
  perform private.require_user();
  select * into c from public.communities where id = p_community;
  if not found or not private.can_manage_community(p_community) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select p.suspended_at into v_suspended
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = p_user and u.deleted_at is null;
  if not found then
    return 'not_found';
  end if;
  if v_suspended is not null then
    return 'suspended';
  end if;
  if c.cohort_id is not null and not private.person_in_cohort(p_user, c.cohort_id) then
    return 'not_in_cohort';
  end if;
  insert into public.community_members (community_id, user_id) values (p_community, p_user) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    return 'already_member';
  end if;
  perform private.audit('community.add_member', 'community_members', p_community::text || ':' || p_user::text, null, c.cohort_id,
    jsonb_build_object('community_id', p_community, 'user_id', p_user, 'community', c.name));
  return 'added';
end $$;

-- Removes a person from a community. Returns false when they were not a member.
create or replace function public.admin_remove_community_member(p_community uuid, p_user uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  c public.communities;
  n integer;
begin
  perform private.require_user();
  select * into c from public.communities where id = p_community;
  if not found or not private.can_manage_community(p_community) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  delete from public.community_members m where m.community_id = p_community and m.user_id = p_user;
  get diagnostics n = row_count;
  if n = 0 then
    return false;
  end if;
  perform private.audit('community.remove_member', 'community_members', p_community::text || ':' || p_user::text, null, c.cohort_id,
    jsonb_build_object('community_id', p_community, 'user_id', p_user, 'community', c.name));
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function private.cohort_people(uuid), private.person_in_cohort(uuid, uuid),
  private.can_manage_community(uuid), private.guard_community_cohort()
  from public, anon, authenticated;

revoke all on function public.admin_community_people(uuid), public.admin_add_community_member(uuid, uuid),
  public.admin_remove_community_member(uuid, uuid)
  from public, anon;
grant execute on function public.admin_community_people(uuid), public.admin_add_community_member(uuid, uuid),
  public.admin_remove_community_member(uuid, uuid)
  to authenticated;
