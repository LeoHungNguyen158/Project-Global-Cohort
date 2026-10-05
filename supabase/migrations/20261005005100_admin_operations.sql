-- Administration area: scoped administrator RPCs (users, invitations, CSV import
-- checks, people listings for cohort coordinators, access requests, audit viewer),
-- course creation/duplication, offering completion, upload review and audited
-- platform settings / upload limits.
--
-- Fixes to existing objects (create or replace / alter):
--   * private.guard_profile_update checked auth.role(), which is still 'authenticated'
--     inside SECURITY DEFINER functions, so public.admin_set_suspended always failed
--     through the API ("Not allowed to change protected profile fields"). It now checks
--     the executing role (current_user): direct API updates are still refused, trusted
--     definer functions (running as their owner) may suspend/reactivate.
--   * public.admin_set_role refuses to remove the last active platform administrator
--     and refuses granting roles to suspended accounts.
--   * "Who did it" pointers on administration metadata (platform_settings.updated_by,
--     platform_role_grants.granted_by/revoked_by, coordinator_scopes.granted_by) become
--     ON DELETE SET NULL, so removing an account (e.g. the sample-data purge) never
--     fails on them; the audit log keeps the history.
--   * Cohorts, courses and offerings created by sample accounts, and offerings of sample
--     cohorts/courses, are marked is_sample so the sample purge can remove them.

create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Accent- and case-insensitive folding for administrator search ("tran" finds "Trần").
create or replace function private.fold(p text) returns text
language sql stable set search_path = '' as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, '')));
$$;

-- Escape LIKE wildcards in user-entered search text (used with ESCAPE '\').
create or replace function private.like_escape(p text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

-- Platform administrator, or a coordinator with at least one cohort scope.
create or replace function private.is_any_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin() or (
    private.is_active_user() and exists (
      select 1 from public.platform_role_grants g
      join public.coordinator_scopes s on s.user_id = g.user_id
      where g.user_id = (select auth.uid()) and g.role = 'coordinator' and g.revoked_at is null));
$$;

create or replace function private.invitation_cohort(p_inv public.invitations) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(p_inv.cohort_id, private.offering_cohort(p_inv.offering_id));
$$;

-- Confirmed account for an email address (null when none).
create or replace function private.confirmed_account(p_email extensions.citext) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u
  where lower(u.email) = lower(p_email::text) and u.email_confirmed_at is not null and u.deleted_at is null
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Fix: allow trusted definer functions to change protected profile fields
-- ---------------------------------------------------------------------------
create or replace function private.guard_profile_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Direct API updates run as the authenticated (or anon) role; SECURITY DEFINER
  -- functions such as the administrator suspension RPC run as their owner.
  if current_user in ('authenticated', 'anon') and (
       new.suspended_at is distinct from old.suspended_at or new.is_sample is distinct from old.is_sample or new.id <> old.id) then
    raise exception 'Not allowed to change protected profile fields';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Sample-data hygiene
-- ---------------------------------------------------------------------------
-- The development/staging seed marks its records is_sample and purges them by that
-- flag. Program structure created later by a sample account (for example while
-- testing the administration pages) is sample data too; so is an offering of a
-- sample course or cohort, which could not outlive the purge of its parent.
create or replace function private.actor_is_sample() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
    where p.id = (select auth.uid())
      and (p.is_sample or u.email::text like '%@sample.crewscaler.test'));
$$;

create or replace function private.inherit_sample_flag() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_sample then
    return new;
  end if;
  if private.actor_is_sample() then
    new.is_sample := true;
  elsif tg_table_name = 'course_offerings' and (
      exists (select 1 from public.cohorts c where c.id = new.cohort_id and c.is_sample)
      or exists (select 1 from public.courses c where c.id = new.course_id and c.is_sample)) then
    new.is_sample := true;
  end if;
  return new;
end $$;

drop trigger if exists cohorts_inherit_sample on public.cohorts;
create trigger cohorts_inherit_sample before insert on public.cohorts
  for each row execute function private.inherit_sample_flag();
drop trigger if exists courses_inherit_sample on public.courses;
create trigger courses_inherit_sample before insert on public.courses
  for each row execute function private.inherit_sample_flag();
drop trigger if exists course_offerings_inherit_sample on public.course_offerings;
create trigger course_offerings_inherit_sample before insert on public.course_offerings
  for each row execute function private.inherit_sample_flag();

alter table public.platform_settings drop constraint if exists platform_settings_updated_by_fkey,
  add constraint platform_settings_updated_by_fkey foreign key (updated_by) references public.profiles (id) on delete set null;
alter table public.platform_role_grants drop constraint if exists platform_role_grants_granted_by_fkey,
  add constraint platform_role_grants_granted_by_fkey foreign key (granted_by) references public.profiles (id) on delete set null;
alter table public.platform_role_grants drop constraint if exists platform_role_grants_revoked_by_fkey,
  add constraint platform_role_grants_revoked_by_fkey foreign key (revoked_by) references public.profiles (id) on delete set null;
alter table public.coordinator_scopes drop constraint if exists coordinator_scopes_granted_by_fkey,
  add constraint coordinator_scopes_granted_by_fkey foreign key (granted_by) references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------------
create or replace function public.admin_platform_counts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_user();
  if not private.is_platform_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'suspended', (select count(*) from public.profiles where suspended_at is not null),
    'unconfirmed', (select count(*) from public.profiles p join auth.users u on u.id = p.id where u.email_confirmed_at is null),
    'platform_admins', (select count(distinct g.user_id) from public.platform_role_grants g join public.profiles p on p.id = g.user_id
                        where g.role = 'platform_admin' and g.revoked_at is null and p.suspended_at is null),
    'coordinators', (select count(distinct user_id) from public.platform_role_grants where role = 'coordinator' and revoked_at is null),
    'quarantined_uploads', (select count(*) from public.content_assets where status = 'quarantined'),
    'stale_pending_uploads', (select count(*) from public.content_assets where status = 'pending' and created_at < now() - interval '24 hours')
  );
end $$;

-- ---------------------------------------------------------------------------
-- Users (platform administrators)
-- ---------------------------------------------------------------------------
create or replace function public.admin_users_page(p_search text, p_filter text, p_sort text, p_limit integer, p_offset integer)
returns table (user_id uuid, display_name text, email text, email_confirmed boolean, suspended boolean, roles text[],
               created_at timestamptz, last_sign_in_at timestamptz, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  q text := private.like_escape(private.fold(btrim(coalesce(p_search, ''))));
  lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  off integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform private.require_user();
  if not private.is_platform_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;
  return query
  with base as (
    select p.id as uid_, p.display_name as name_, u.email::text as email_, u.email_confirmed_at is not null as conf_,
           p.suspended_at is not null as susp_,
           coalesce(array(select g.role from public.platform_role_grants g
                          where g.user_id = p.id and g.revoked_at is null order by g.role), '{}'::text[]) as roles_,
           p.created_at as created_, u.last_sign_in_at as seen_
    from public.profiles p join auth.users u on u.id = p.id
    where q = '' or private.fold(p.display_name) like '%' || q || '%' escape '\'
       or lower(u.email::text) like '%' || q || '%' escape '\'
  ), filtered as (
    select * from base b where case coalesce(p_filter, 'all')
      when 'active' then not b.susp_ and b.conf_
      when 'suspended' then b.susp_
      when 'unconfirmed' then not b.conf_
      when 'admins' then 'platform_admin' = any (b.roles_)
      when 'coordinators' then 'coordinator' = any (b.roles_)
      else true end
  )
  select f.uid_, f.name_, f.email_, f.conf_, f.susp_, f.roles_, f.created_, f.seen_, count(*) over ()
  from filtered f
  order by case when p_sort = 'newest' then f.created_ end desc nulls last, private.fold(f.name_), f.email_
  limit lim offset off;
end $$;

create or replace function public.admin_user_detail(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform private.require_user();
  if not private.is_platform_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', p.id, 'display_name', p.display_name, 'email', u.email, 'email_confirmed_at', u.email_confirmed_at,
    'invited_at', u.invited_at, 'last_sign_in_at', u.last_sign_in_at, 'created_at', p.created_at,
    'timezone', p.timezone, 'locale', p.locale, 'suspended_at', p.suspended_at, 'is_sample', p.is_sample,
    'last_status_change', (
      select jsonb_build_object('action', a.action, 'reason', a.metadata ->> 'reason', 'at', a.created_at,
                                'by', (select pr.display_name from public.profiles pr where pr.id = a.actor_id))
      from public.audit_events a
      where a.target_table = 'profiles' and a.target_id = p.id::text and a.action in ('account.suspend', 'account.reinstate')
      order by a.created_at desc, a.id desc limit 1))
  into r
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = p_user;
  return r;
end $$;

-- Suspend or reactivate with a recorded reason. Takes effect on the person's next
-- request: every helper and RLS policy requires an active (not suspended) profile.
create or replace function public.admin_set_account_suspension(p_user uuid, p_suspend boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  v_reason text := btrim(coalesce(p_reason, ''));
  cur timestamptz;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;
  if p_user = uid then
    raise exception 'You cannot suspend or reactivate your own account';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'Give a reason (3 to 500 characters)';
  end if;
  select suspended_at into cur from public.profiles where id = p_user for update;
  if not found then
    raise exception 'Account not found';
  end if;
  if p_suspend then
    if cur is not null then
      raise exception 'This account is already suspended';
    end if;
    if exists (select 1 from public.platform_role_grants g where g.user_id = p_user and g.role = 'platform_admin' and g.revoked_at is null)
       and not exists (select 1 from public.platform_role_grants g join public.profiles p on p.id = g.user_id
                       where g.role = 'platform_admin' and g.revoked_at is null and p.suspended_at is null and g.user_id <> p_user) then
      raise exception 'You cannot suspend the last active platform administrator';
    end if;
    update public.profiles set suspended_at = now() where id = p_user;
  else
    if cur is null then
      raise exception 'This account is not suspended';
    end if;
    update public.profiles set suspended_at = null where id = p_user;
  end if;
  perform private.audit(case when p_suspend then 'account.suspend' else 'account.reinstate' end,
                        'profiles', p_user::text, null, null, jsonb_build_object('reason', v_reason));
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role text, p_grant boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not private.is_platform_admin() then raise exception 'Platform administrators only' using errcode = '42501'; end if;
  if p_role not in ('platform_admin', 'coordinator') then raise exception 'Unknown role'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Account not found'; end if;
  if p_grant then
    if exists (select 1 from public.profiles where id = p_user and suspended_at is not null) then
      raise exception 'Reactivate this account before granting a role';
    end if;
    insert into public.platform_role_grants (user_id, role, granted_by) values (p_user, p_role, uid) on conflict do nothing;
  else
    if p_user = uid and p_role = 'platform_admin' then raise exception 'You cannot remove your own administrator role'; end if;
    if p_role = 'platform_admin' and not exists (
      select 1 from public.platform_role_grants g join public.profiles p on p.id = g.user_id
      where g.role = 'platform_admin' and g.revoked_at is null and p.suspended_at is null and g.user_id <> p_user) then
      raise exception 'You cannot remove the last active platform administrator';
    end if;
    update public.platform_role_grants set revoked_at = now(), revoked_by = uid
    where user_id = p_user and role = p_role and revoked_at is null;
  end if;
end $$;

-- Exact-address lookup so cohort coordinators can add an existing account to their
-- own cohort or offering without being able to browse every account.
create or replace function public.admin_find_user(p_email text, p_cohort uuid)
returns table (user_id uuid, display_name text, email_confirmed boolean, suspended boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare uid uuid := private.require_user();
begin
  if not (private.is_platform_admin() or (p_cohort is not null and private.is_cohort_admin(p_cohort))) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform private.hit_rate_limit('user_lookup:' || uid, 600, 3600);
  return query
  select p.id, p.display_name, u.email_confirmed_at is not null, p.suspended_at is not null
  from auth.users u join public.profiles p on p.id = u.id
  where lower(u.email) = lower(btrim(coalesce(p_email, ''))) and u.deleted_at is null
  limit 1;
end $$;

-- ---------------------------------------------------------------------------
-- People in an administered offering or cohort. Email addresses are returned to
-- platform administrators only (docs/PERMISSIONS.md); coordinators get null.
-- ---------------------------------------------------------------------------
create or replace function public.admin_offering_people(p_offering uuid)
returns table (kind text, user_id uuid, display_name text, email text, role text, status text, can_author boolean,
               can_grade boolean, can_publish_grades boolean, source text, account_suspended boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  show_email boolean;
begin
  perform private.require_user();
  if not private.is_offering_admin(p_offering) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  show_email := private.is_platform_admin();
  return query
  select 'staff'::text, sa.user_id, p.display_name, case when show_email then u.email::text end, sa.role, null::text, sa.can_author, sa.can_grade,
         sa.can_publish_grades, null::text, p.suspended_at is not null, sa.created_at
  from public.staff_assignments sa join public.profiles p on p.id = sa.user_id join auth.users u on u.id = sa.user_id
  where sa.offering_id = p_offering
  union all
  select 'learner'::text, e.user_id, p.display_name, case when show_email then u.email::text end, 'learner'::text, e.status, false, false, false,
         e.source, p.suspended_at is not null, e.created_at
  from public.enrollments e join public.profiles p on p.id = e.user_id join auth.users u on u.id = e.user_id
  where e.offering_id = p_offering;
end $$;

create or replace function public.admin_cohort_people(p_cohort uuid)
returns table (kind text, user_id uuid, display_name text, email text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  show_email boolean;
begin
  perform private.require_user();
  if not private.is_cohort_admin(p_cohort) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  show_email := private.is_platform_admin();
  return query
  select 'participant'::text, cp.user_id, p.display_name, case when show_email then u.email::text end, cp.status, cp.created_at
  from public.cohort_participation cp join public.profiles p on p.id = cp.user_id join auth.users u on u.id = cp.user_id
  where cp.cohort_id = p_cohort
  union all
  select 'coordinator'::text, s.user_id, p.display_name, case when show_email then u.email::text end,
         case when exists (select 1 from public.platform_role_grants g where g.user_id = s.user_id and g.role = 'coordinator' and g.revoked_at is null)
              then 'active' else 'inactive' end,
         s.granted_at
  from public.coordinator_scopes s join public.profiles p on p.id = s.user_id join auth.users u on u.id = s.user_id
  where s.cohort_id = p_cohort;
end $$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
-- Reasons an invitation would be redundant or unusable (codes; the app words them).
create or replace function private.invitation_conflicts(p_email extensions.citext, p_role text, p_cohort uuid, p_offering uuid)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  acct uuid;
  susp boolean;
  errs text[] := '{}';
begin
  select u.id, p.suspended_at is not null into acct, susp
  from auth.users u join public.profiles p on p.id = u.id
  where lower(u.email) = lower(p_email::text) and u.email_confirmed_at is not null and u.deleted_at is null
  limit 1;
  if acct is not null then
    if susp then
      errs := array_append(errs, 'account_suspended');
    end if;
    if p_role = 'participant' then
      if p_offering is not null then
        if exists (select 1 from public.enrollments e where e.offering_id = p_offering and e.user_id = acct and e.status in ('active', 'completed')) then
          errs := array_append(errs, 'already_enrolled');
        end if;
      elsif exists (select 1 from public.cohort_participation cp where cp.cohort_id = p_cohort and cp.user_id = acct and cp.status = 'active') then
        errs := array_append(errs, 'already_participant');
      end if;
    elsif exists (select 1 from public.staff_assignments sa where sa.offering_id = p_offering and sa.user_id = acct) then
      errs := array_append(errs, 'already_staff');
    end if;
  end if;
  if exists (select 1 from public.invitations i
             where i.email operator(extensions.=) p_email and i.role = p_role
               and coalesce(i.cohort_id, private.offering_cohort(i.offering_id)) = p_cohort
               and i.offering_id is not distinct from p_offering
               and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()) then
    errs := array_append(errs, 'already_invited');
  end if;
  return errs;
end $$;

create or replace function private.invitation_conflict_message(p_code text) returns text
language sql immutable set search_path = '' as $$
  select case p_code
    when 'account_suspended' then 'This account is suspended. Reactivate it before inviting it.'
    when 'already_enrolled' then 'This person is already enrolled in the offering.'
    when 'already_participant' then 'This person is already a participant in the cohort.'
    when 'already_staff' then 'This person is already assigned as staff in the offering.'
    when 'already_invited' then 'A pending invitation for this address and scope already exists. Resend it instead.'
    else 'This invitation cannot be created.' end;
$$;

-- Decides how an invitation reaches the person and applies the send rate limits.
-- Existing confirmed accounts get an in-app notification (no email); for anyone else
-- the caller sends an authentication invitation email and records the provider result.
create or replace function private.invitation_delivery(p_inv uuid, p_resend boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  inv public.invitations;
  acct uuid;
  key text;
begin
  select * into inv from public.invitations where id = p_inv;
  perform private.hit_rate_limit('invite_send:' || uid, 120, 3600);
  perform private.hit_rate_limit('invite_to:' || lower(inv.email::text), 5, 3600);
  acct := private.confirmed_account(inv.email);
  if acct is null then
    return jsonb_build_object('id', inv.id, 'email', inv.email::text, 'action', 'send');
  end if;
  key := 'invitation:' || inv.id;
  if p_resend then
    key := key || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    perform private.notify(acct, 'invitation', inv.offering_id, inv.cohort_id, 'You have a new invitation', '', '/invite/accept', key);
  end if;
  if exists (select 1 from public.notifications n where n.user_id = acct and n.dedupe_key = key) then
    update public.invitations set email_status = 'existing_account_notified', email_error = null where id = inv.id;
    return jsonb_build_object('id', inv.id, 'email', inv.email::text, 'action', 'notified');
  end if;
  update public.invitations
     set email_status = 'not_sent',
         email_error = 'This account has turned off in-app invitation notifications, and existing accounts are not emailed. Ask them to open /invite/accept.'
   where id = inv.id;
  return jsonb_build_object('id', inv.id, 'email', inv.email::text, 'action', 'not_notified');
end $$;

create or replace function public.admin_create_invitation(p_email text, p_role text, p_cohort uuid, p_offering uuid, p_expires_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  v_email extensions.citext := lower(btrim(coalesce(p_email, '')));
  v_cohort uuid := p_cohort;
  o public.course_offerings;
  c public.cohorts;
  errs text[];
  inv_id uuid;
begin
  if p_offering is not null then
    select * into o from public.course_offerings where id = p_offering;
    if not found then
      raise exception 'Offering not found';
    end if;
    if p_cohort is not null and p_cohort <> o.cohort_id then
      raise exception 'The offering belongs to a different cohort';
    end if;
    v_cohort := o.cohort_id;
  end if;
  if v_cohort is null then
    raise exception 'Choose a cohort or an offering';
  end if;
  if not private.is_cohort_admin(v_cohort) then
    raise exception 'Not authorized to invite people to this cohort' using errcode = '42501';
  end if;
  select * into c from public.cohorts where id = v_cohort;
  if c.status = 'archived' or o.status = 'archived' then
    raise exception 'Archived cohorts and offerings do not accept invitations';
  end if;
  if char_length(v_email::text) > 320 or v_email::text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;
  if p_role not in ('participant', 'instructor', 'ta') then
    raise exception 'Choose participant, instructor or teaching assistant';
  end if;
  if p_role <> 'participant' and p_offering is null then
    raise exception 'Instructor and teaching assistant invitations need an offering';
  end if;
  if p_expires_at is null or p_expires_at < now() + interval '1 hour' or p_expires_at > now() + interval '90 days' then
    raise exception 'Choose an expiry between 1 hour and 90 days from now';
  end if;
  errs := private.invitation_conflicts(v_email, p_role, v_cohort, p_offering);
  if cardinality(errs) > 0 then
    raise exception '%', private.invitation_conflict_message(errs[1]);
  end if;
  perform private.hit_rate_limit('invite_create:' || uid, 300, 3600);
  insert into public.invitations (email, role, cohort_id, offering_id, expires_at, created_by)
  values (v_email, p_role, v_cohort, p_offering, p_expires_at, uid)
  returning id into inv_id;
  return private.invitation_delivery(inv_id, false);
end $$;

-- Resend (optionally renewing an expired invitation for 14 days).
create or replace function public.admin_prepare_invitation_send(p_invitation uuid, p_renew boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  inv public.invitations;
begin
  select * into inv from public.invitations where id = p_invitation for update;
  if not found or not private.is_cohort_admin(private.invitation_cohort(inv)) then
    raise exception 'Invitation not found' using errcode = '42501';
  end if;
  if inv.revoked_at is not null then raise exception 'This invitation was revoked'; end if;
  if inv.accepted_at is not null then raise exception 'This invitation was already accepted'; end if;
  if inv.expires_at <= now() then
    if not coalesce(p_renew, false) then
      raise exception 'This invitation has expired';
    end if;
    update public.invitations set expires_at = now() + interval '14 days' where id = inv.id;
  end if;
  return private.invitation_delivery(inv.id, true);
end $$;

-- Records what the email provider answered. Only the server calls this, right after
-- the authentication service accepted or rejected the invitation email.
create or replace function public.admin_record_invitation_email(p_invitation uuid, p_ok boolean, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  inv public.invitations;
begin
  select * into inv from public.invitations where id = p_invitation for update;
  if not found or not private.is_cohort_admin(private.invitation_cohort(inv)) then
    raise exception 'Invitation not found' using errcode = '42501';
  end if;
  if inv.revoked_at is not null or inv.accepted_at is not null then
    return;
  end if;
  update public.invitations
     set email_status = case when p_ok then 'accepted_by_provider' else 'failed' end,
         email_error = case when p_ok then null
                            else left(coalesce(nullif(btrim(p_error), ''), 'The email provider did not accept the message.'), 500) end
   where id = p_invitation;
end $$;

create or replace function public.admin_revoke_invitation(p_invitation uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  inv public.invitations;
  acct_state text;
  others integer;
begin
  select * into inv from public.invitations where id = p_invitation for update;
  if not found or not private.is_cohort_admin(private.invitation_cohort(inv)) then
    raise exception 'Invitation not found' using errcode = '42501';
  end if;
  if inv.accepted_at is not null then
    raise exception 'This invitation was already accepted. Change the enrollment or staff assignment instead.';
  end if;
  if inv.revoked_at is not null then
    raise exception 'This invitation was already revoked';
  end if;
  update public.invitations set revoked_at = now() where id = p_invitation;
  perform private.audit('invitation.revoke', 'invitations', p_invitation::text, inv.offering_id, private.invitation_cohort(inv),
                        jsonb_build_object('reason', left(btrim(coalesce(p_reason, '')), 500)));
  select case when u.email_confirmed_at is not null then 'confirmed' else 'unconfirmed' end into acct_state
  from auth.users u where lower(u.email) = lower(inv.email::text) and u.deleted_at is null limit 1;
  select count(*) into others from public.invitations i
  where i.email operator(extensions.=) inv.email and i.id <> p_invitation and i.accepted_at is null and i.revoked_at is null and i.expires_at > now();
  return jsonb_build_object('email', inv.email::text, 'account_state', coalesce(acct_state, 'none'), 'other_pending', others > 0);
end $$;

-- CSV import dry run: database checks for already-normalized rows
-- [{row, email, role, cohort_code, offering_code}]. Changes no data, but counts every
-- row against an hourly limit (volatile for that reason). Whether an address already
-- has an account is reported only for rows whose scope the caller administers and that
-- passed every check, so the dry run cannot be used to probe arbitrary addresses.
create or replace function public.admin_check_import(p_rows jsonb)
returns table (row_no integer, cohort_id uuid, offering_id uuid, existing_account boolean, errors text[])
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  r jsonb;
  o public.course_offerings;
  c public.cohorts;
  errs text[];
  v_email extensions.citext;
  v_role text;
  v_cohort uuid;
  v_ocode text;
  v_ccode text;
  uid uuid;
begin
  uid := private.require_user();
  if not private.is_any_admin() then
    raise exception 'Administrators only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Invalid import rows';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Import at most 500 rows at a time';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    -- 3,000 checked rows per hour: about fifteen full 200-row files, checked and confirmed.
    perform private.hit_rate_limit('import_check:' || uid, 3000, 3600);
    errs := '{}';
    o := null;
    c := null;
    v_email := lower(btrim(coalesce(r ->> 'email', '')));
    v_role := r ->> 'role';
    v_ocode := btrim(coalesce(r ->> 'offering_code', ''));
    v_ccode := btrim(coalesce(r ->> 'cohort_code', ''));
    if v_ocode <> '' then
      select * into o from public.course_offerings x where lower(x.code) = lower(v_ocode);
      if o.id is null or not private.is_offering_admin(o.id) then
        errs := array_append(errs, 'unknown_offering');
        o := null;
      elsif o.status = 'archived' then
        errs := array_append(errs, 'offering_archived');
      end if;
    end if;
    if v_ccode <> '' then
      select * into c from public.cohorts x where lower(x.code) = lower(v_ccode);
      if c.id is null or not private.is_cohort_admin(c.id) then
        errs := array_append(errs, 'unknown_cohort');
        c := null;
      elsif c.status = 'archived' then
        errs := array_append(errs, 'cohort_archived');
      end if;
    end if;
    if o.id is not null and c.id is not null and o.cohort_id <> c.id then
      errs := array_append(errs, 'offering_not_in_cohort');
    end if;
    if v_ocode = '' and v_ccode = '' then
      errs := array_append(errs, 'missing_scope');
    end if;
    if v_role in ('instructor', 'ta') and v_ocode = '' then
      errs := array_append(errs, 'staff_needs_offering');
    end if;
    v_cohort := coalesce(o.cohort_id, c.id);
    if cardinality(errs) = 0 and v_cohort is not null and v_email::text <> '' and v_role in ('participant', 'instructor', 'ta') then
      errs := errs || private.invitation_conflicts(v_email, v_role, v_cohort, o.id);
    end if;
    row_no := (r ->> 'row')::integer;
    cohort_id := v_cohort;
    offering_id := o.id;
    existing_account := case
      when cardinality(errs) = 0 and v_cohort is not null and v_email::text <> ''
           and (private.is_platform_admin() or private.is_cohort_admin(v_cohort))
        then private.confirmed_account(v_email) is not null
    end;
    errors := errs;
    return next;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Access requests (offering administrators)
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_access_requests(p_status text, p_limit integer, p_offset integer)
returns table (id uuid, offering_id uuid, offering_code text, offering_title text, cohort_name text, user_id uuid,
               display_name text, email text, message text, status text, created_at timestamptz, reviewed_at timestamptz,
               reviewer_name text, review_note text, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  st text := coalesce(nullif(p_status, ''), 'pending');
  show_email boolean;
begin
  perform private.require_user();
  if not private.is_any_admin() then
    raise exception 'Administrators only' using errcode = '42501';
  end if;
  -- Requesters' email addresses: platform administrators only (coordinators get null).
  show_email := private.is_platform_admin();
  return query
  select ar.id, ar.offering_id, o.code, v.title, co.name, ar.user_id, p.display_name,
         case when show_email then u.email::text end, ar.message, ar.status,
         ar.created_at, ar.reviewed_at, rp.display_name, ar.review_note, count(*) over ()
  from public.access_requests ar
  join public.course_offerings o on o.id = ar.offering_id
  join public.course_versions v on v.id = o.course_version_id
  join public.cohorts co on co.id = o.cohort_id
  join public.profiles p on p.id = ar.user_id
  join auth.users u on u.id = ar.user_id
  left join public.profiles rp on rp.id = ar.reviewed_by
  where private.is_offering_admin(ar.offering_id) and (st = 'all' or ar.status = st)
  order by case when ar.status = 'pending' then ar.created_at end asc nulls last, ar.reviewed_at desc nulls last, ar.created_at desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ---------------------------------------------------------------------------
-- Audit log (platform administrators: everything; coordinators: their scopes)
-- ---------------------------------------------------------------------------
create or replace function private.can_view_audit_event(a public.audit_events) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin()
      or (a.cohort_id is not null and private.is_cohort_admin(a.cohort_id))
      or (a.offering_id is not null and private.is_offering_admin(a.offering_id))
      or (a.target_table = 'cohorts' and a.target_id ~ '^[0-9a-f-]{36}$' and private.is_cohort_admin(a.target_id::uuid));
$$;

create or replace function public.admin_audit_events(p_actor text, p_system_only boolean, p_action text, p_target_table text,
                                                     p_from timestamptz, p_to timestamptz, p_limit integer, p_offset integer)
returns table (id bigint, created_at timestamptz, actor_id uuid, actor_name text, action text, target_table text, target_id text,
               offering_id uuid, offering_code text, cohort_id uuid, cohort_code text, metadata jsonb, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  q text := private.like_escape(private.fold(btrim(coalesce(p_actor, ''))));
  everything boolean := private.is_platform_admin();
begin
  perform private.require_user();
  if not private.is_any_admin() then
    raise exception 'Administrators only' using errcode = '42501';
  end if;
  return query
  select a.id, a.created_at, a.actor_id, ap.display_name, a.action, a.target_table, a.target_id, a.offering_id, o.code,
         a.cohort_id, c.code, a.metadata, count(*) over ()
  from public.audit_events a
  left join public.profiles ap on ap.id = a.actor_id
  left join auth.users au on au.id = a.actor_id
  left join public.course_offerings o on o.id = a.offering_id
  left join public.cohorts c on c.id = a.cohort_id
  where (everything or private.can_view_audit_event(a))
    and (not coalesce(p_system_only, false) or a.actor_id is null)
    and (q = '' or private.fold(ap.display_name) like '%' || q || '%' escape '\'
         or (everything and lower(au.email::text) like '%' || q || '%' escape '\'))
    and (coalesce(p_action, '') = '' or a.action = p_action)
    and (coalesce(p_target_table, '') = '' or a.target_table = p_target_table)
    and (p_from is null or a.created_at >= p_from)
    and (p_to is null or a.created_at < p_to)
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create or replace function public.admin_audit_facets() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare everything boolean := private.is_platform_admin();
begin
  perform private.require_user();
  if not private.is_any_admin() then
    raise exception 'Administrators only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'actions', coalesce((select jsonb_agg(x order by x) from (
       select distinct a.action as x from public.audit_events a where everything or private.can_view_audit_event(a)) s), '[]'::jsonb),
    'target_tables', coalesce((select jsonb_agg(x order by x) from (
       select distinct a.target_table as x from public.audit_events a where everything or private.can_view_audit_event(a)) s), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Courses and offerings
-- ---------------------------------------------------------------------------
-- Course versions an administrator may base a new offering on (catalog-level metadata).
create or replace function public.admin_course_version_options()
returns table (course_id uuid, course_code text, course_title text, version_id uuid, version_no integer, version_status text, version_title text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform private.require_user();
  if not private.is_any_admin() then
    raise exception 'Administrators only' using errcode = '42501';
  end if;
  return query
  select c.id, c.code, c.title, v.id, v.version_no, v.status, v.title
  from public.courses c join public.course_versions v on v.course_id = c.id
  where c.archived_at is null and v.status in ('draft', 'published')
  order by c.code, v.version_no desc;
end $$;

create or replace function private.check_course_fields(p_code text, p_title text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if coalesce(p_code, '') !~ '^[A-Za-z0-9_.-]{2,64}$' then
    raise exception 'Course code: 2 to 64 letters, digits, dots, dashes or underscores';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 300 then
    raise exception 'Enter a course title (up to 300 characters)';
  end if;
  if exists (select 1 from public.courses where lower(code) = lower(p_code)) then
    raise exception 'A course with this code already exists';
  end if;
end $$;

-- New course with its initial draft version (version 1).
create or replace function public.admin_create_course(p_code text, p_title text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  cid uuid;
  vid uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;
  perform private.check_course_fields(p_code, p_title);
  insert into public.courses (code, title, created_by) values (p_code, btrim(p_title), uid) returning id into cid;
  vid := public.create_course_draft(cid);
  return jsonb_build_object('course_id', cid, 'version_id', vid);
end $$;

-- Copies a course's latest published version (or its draft when nothing is published)
-- into a new course as draft version 1. Offerings, enrollments, grades and other
-- per-offering records are never copied; attached files are shared, not duplicated.
create or replace function public.admin_duplicate_course(p_course uuid, p_code text, p_title text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  src_course public.courses;
  src public.course_versions;
  new_course uuid;
  new_version uuid;
  m record;
  new_module uuid;
  l record;
  new_lesson uuid;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;
  select * into src_course from public.courses where id = p_course;
  if not found then
    raise exception 'Course not found';
  end if;
  perform private.check_course_fields(p_code, p_title);
  select * into src from public.course_versions
  where course_id = p_course and status in ('published', 'draft')
  order by (status = 'published') desc, version_no desc limit 1;
  insert into public.courses (code, title, is_sample, created_by)
  values (p_code, btrim(p_title), src_course.is_sample, uid) returning id into new_course;
  if src.id is null then
    insert into public.course_versions (course_id, version_no, title, created_by)
    values (new_course, 1, btrim(p_title), uid) returning id into new_version;
  else
    insert into public.course_versions (course_id, version_no, status, title, summary, objectives, audience, expected_effort,
      prerequisites_text, syllabus_html, grading_policy, created_by)
    values (new_course, 1, 'draft', btrim(p_title), src.summary, src.objectives, src.audience, src.expected_effort,
      src.prerequisites_text, src.syllabus_html, src.grading_policy, uid)
    returning id into new_version;
    for m in select * from public.modules where course_version_id = src.id order by position loop
      insert into public.modules (course_version_id, position, title, description)
      values (new_version, m.position, m.title, m.description) returning id into new_module;
      for l in select * from public.lessons where module_id = m.id order by position loop
        insert into public.lessons (module_id, course_version_id, position, title, content_type, body_html, required,
          duration_minutes, completion_rule, external_url, embed_provider, embed_id, transcript)
        values (new_module, new_version, l.position, l.title, l.content_type, l.body_html, l.required,
          l.duration_minutes, l.completion_rule, l.external_url, l.embed_provider, l.embed_id, l.transcript)
        returning id into new_lesson;
        insert into public.lesson_assets (lesson_id, asset_id, role, position, caption_language)
        select new_lesson, la.asset_id, la.role, la.position, la.caption_language from public.lesson_assets la where la.lesson_id = l.id;
      end loop;
    end loop;
  end if;
  perform private.audit('course.duplicate', 'courses', new_course::text, null, null,
                        jsonb_build_object('source_course', p_course, 'source_version', src.id, 'code', p_code));
  return new_course;
end $$;

-- Ends a running offering: active enrollments become completed (learners keep
-- read-only access) and the offering is archived. Nothing is deleted.
create or replace function public.admin_complete_offering(p_offering uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  o public.course_offerings;
  n integer;
begin
  select * into o from public.course_offerings where id = p_offering for update;
  if not found or not private.is_offering_admin(p_offering) then
    raise exception 'Offering not found' using errcode = '42501';
  end if;
  if o.status <> 'published' then
    raise exception 'Only a published offering can be completed';
  end if;
  update public.enrollments set status = 'completed' where offering_id = p_offering and status = 'active';
  get diagnostics n = row_count;
  update public.course_offerings set status = 'archived' where id = p_offering;
  perform private.audit('offering.complete', 'course_offerings', p_offering::text, p_offering, o.cohort_id,
                        jsonb_build_object('completed_enrollments', n, 'by', uid));
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Upload review (no malware scanner is integrated; quarantine is manual review)
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_quarantined_assets()
returns table (id uuid, filename text, declared_mime text, size_bytes bigint, purpose text, owner_name text,
               offering_code text, course_code text, version_no integer, created_at timestamptz, completed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform private.require_user();
  if not private.is_platform_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;
  return query
  select a.id, a.filename, a.declared_mime, a.size_bytes, a.purpose, p.display_name, o.code, c.code, v.version_no,
         a.created_at, a.completed_at
  from public.content_assets a
  join public.profiles p on p.id = a.owner_id
  left join public.course_offerings o on o.id = a.offering_id
  left join public.course_versions v on v.id = a.course_version_id
  left join public.courses c on c.id = v.course_id
  where a.status = 'quarantined'
  order by a.completed_at nulls last, a.created_at
  limit 500;
end $$;

create or replace function public.admin_review_asset(p_asset uuid, p_release boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  a public.content_assets;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;
  select * into a from public.content_assets where id = p_asset for update;
  if not found then
    raise exception 'Upload not found';
  end if;
  if a.status <> 'quarantined' then
    raise exception 'This upload is no longer waiting for review';
  end if;
  if p_release then
    update public.content_assets set status = 'ready', rejection_reason = null where id = p_asset;
  else
    if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
      raise exception 'Give a reason for rejecting the file (3 to 500 characters)';
    end if;
    update public.content_assets set status = 'rejected', rejection_reason = v_reason where id = p_asset;
  end if;
  perform private.audit(case when p_release then 'upload.release' else 'upload.reject' end, 'content_assets', p_asset::text,
                        a.offering_id, null,
                        jsonb_build_object('filename', a.filename, 'purpose', a.purpose, 'reason', nullif(v_reason, '')));
  return jsonb_build_object('bucket', a.bucket, 'object_path', a.object_path,
                            'status', case when p_release then 'ready' else 'rejected' end);
end $$;

-- ---------------------------------------------------------------------------
-- Platform settings and upload limits (validated and audited)
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_settings(p_program_name text, p_support_email text, p_support_url text,
                                                        p_public_catalog boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  v_name text := btrim(coalesce(p_program_name, ''));
  v_email text := btrim(coalesce(p_support_email, ''));
  v_url text := btrim(coalesce(p_support_url, ''));
  vals jsonb;
  k text;
  v text;
  prev text;
  changes jsonb := '{}'::jsonb;
  n integer := 0;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'Program name: up to 120 characters';
  end if;
  if v_email <> '' and (char_length(v_email) > 320 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Enter a valid support email address, or leave it empty';
  end if;
  if v_url <> '' and (char_length(v_url) > 500 or v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^\s]*)?$') then
    raise exception 'The support link must be a complete https:// address, or empty';
  end if;
  vals := jsonb_build_object('program_name', v_name, 'support_email', v_email, 'support_url', v_url,
                             'public_catalog', case when coalesce(p_public_catalog, false) then 'true' else 'false' end);
  for k, v in select e.key, e.value from jsonb_each_text(vals) e loop
    select s.value into prev from public.platform_settings s where s.key = k;
    if coalesce(prev, case when k = 'public_catalog' then 'false' else '' end) is distinct from v then
      insert into public.platform_settings (key, value, updated_by, updated_at) values (k, v, uid, now())
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
      changes := changes || jsonb_build_object(k, jsonb_build_object('from', prev, 'to', v));
      n := n + 1;
    end if;
  end loop;
  if n > 0 then
    perform private.audit('settings.update', 'platform_settings', null, null, null, jsonb_build_object('changed', changes));
  end if;
  return n;
end $$;

-- File types the server can verify by signature (see src/lib/uploads/signature.ts).
create or replace function private.verifiable_mime(p_mime text) returns boolean
language sql immutable set search_path = '' as $$
  select p_mime in ('application/pdf',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
                    'text/plain', 'text/markdown', 'text/csv', 'text/vtt', 'video/mp4', 'video/webm');
$$;

create or replace function public.admin_set_upload_limit(p_purpose text, p_mime text, p_max_bytes bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  bucket_limit bigint;
  prev bigint;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;
  if p_purpose not in ('lesson', 'submission', 'message', 'avatar') then
    raise exception 'Unknown upload purpose';
  end if;
  if not private.verifiable_mime(p_mime) then
    raise exception 'The server cannot verify this file type, so it cannot be allowed';
  end if;
  if p_purpose = 'avatar' and p_mime not in ('image/png', 'image/jpeg', 'image/webp') then
    raise exception 'Profile photos accept PNG, JPEG or WebP images only';
  end if;
  select b.file_size_limit into bucket_limit from storage.buckets b
  where b.id = case p_purpose when 'lesson' then 'course-content' when 'submission' then 'submissions'
                              when 'message' then 'message-attachments' else 'avatars' end;
  if p_max_bytes is null or p_max_bytes < 1024 then
    raise exception 'The limit must be at least 1 KB';
  end if;
  if bucket_limit is not null and p_max_bytes > bucket_limit then
    raise exception 'The limit cannot exceed the storage bucket limit of % MB', round(bucket_limit / 1048576.0);
  end if;
  select max_bytes into prev from public.upload_limits where purpose = p_purpose and mime = p_mime;
  insert into public.upload_limits (purpose, mime, max_bytes) values (p_purpose, p_mime, p_max_bytes)
  on conflict (purpose, mime) do update set max_bytes = excluded.max_bytes;
  perform private.audit('upload_limit.set', 'upload_limits', p_purpose || ':' || p_mime, null, null,
                        jsonb_build_object('purpose', p_purpose, 'mime', p_mime, 'from', prev, 'to', p_max_bytes));
end $$;

create or replace function public.admin_delete_upload_limit(p_purpose text, p_mime text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  prev bigint;
begin
  if not private.is_platform_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;
  delete from public.upload_limits where purpose = p_purpose and mime = p_mime returning max_bytes into prev;
  if prev is null then
    raise exception 'This file type is not allowed for that purpose';
  end if;
  perform private.audit('upload_limit.remove', 'upload_limits', p_purpose || ':' || p_mime, null, null,
                        jsonb_build_object('purpose', p_purpose, 'mime', p_mime, 'from', prev));
end $$;

-- ---------------------------------------------------------------------------
-- Grants (explicit; new functions are not executable by default)
-- ---------------------------------------------------------------------------
revoke execute on function
  private.fold(text), private.like_escape(text), private.is_any_admin(), private.invitation_cohort(public.invitations),
  private.confirmed_account(extensions.citext), private.actor_is_sample(), private.invitation_conflicts(extensions.citext, text, uuid, uuid),
  private.invitation_conflict_message(text), private.invitation_delivery(uuid, boolean), private.can_view_audit_event(public.audit_events),
  private.check_course_fields(text, text), private.verifiable_mime(text)
from public, anon, authenticated;

revoke execute on function
  public.admin_platform_counts(), public.admin_users_page(text, text, text, integer, integer), public.admin_user_detail(uuid),
  public.admin_set_account_suspension(uuid, boolean, text), public.admin_find_user(text, uuid),
  public.admin_offering_people(uuid), public.admin_cohort_people(uuid),
  public.admin_create_invitation(text, text, uuid, uuid, timestamptz), public.admin_prepare_invitation_send(uuid, boolean),
  public.admin_record_invitation_email(uuid, boolean, text), public.admin_revoke_invitation(uuid, text),
  public.admin_check_import(jsonb), public.admin_list_access_requests(text, integer, integer),
  public.admin_audit_events(text, boolean, text, text, timestamptz, timestamptz, integer, integer), public.admin_audit_facets(),
  public.admin_course_version_options(), public.admin_create_course(text, text), public.admin_duplicate_course(uuid, text, text),
  public.admin_complete_offering(uuid), public.admin_list_quarantined_assets(), public.admin_review_asset(uuid, boolean, text),
  public.admin_update_settings(text, text, text, boolean), public.admin_set_upload_limit(text, text, bigint),
  public.admin_delete_upload_limit(text, text)
from public, anon;

grant execute on function
  public.admin_platform_counts(), public.admin_users_page(text, text, text, integer, integer), public.admin_user_detail(uuid),
  public.admin_set_account_suspension(uuid, boolean, text), public.admin_find_user(text, uuid),
  public.admin_offering_people(uuid), public.admin_cohort_people(uuid),
  public.admin_create_invitation(text, text, uuid, uuid, timestamptz), public.admin_prepare_invitation_send(uuid, boolean),
  public.admin_record_invitation_email(uuid, boolean, text), public.admin_revoke_invitation(uuid, text),
  public.admin_check_import(jsonb), public.admin_list_access_requests(text, integer, integer),
  public.admin_audit_events(text, boolean, text, text, timestamptz, timestamptz, integer, integer), public.admin_audit_facets(),
  public.admin_course_version_options(), public.admin_create_course(text, text), public.admin_duplicate_course(uuid, text, text),
  public.admin_complete_offering(uuid), public.admin_list_quarantined_assets(), public.admin_review_asset(uuid, boolean, text),
  public.admin_update_settings(text, text, text, boolean), public.admin_set_upload_limit(text, text, bigint),
  public.admin_delete_upload_limit(text, text)
to authenticated;
