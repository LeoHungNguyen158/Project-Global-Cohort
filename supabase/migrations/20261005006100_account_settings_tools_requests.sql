-- Account area: public site settings for signed-out pages, withdrawing an access
-- request, tool resource archiving/attribution/audit, and server-side validation of
-- the profile fields people edit themselves (time zone, display name, avatar).

-- ---------------------------------------------------------------------------
-- Public site settings
-- ---------------------------------------------------------------------------
-- Help, legal pages and the optional public catalog must work for signed-out
-- visitors, who cannot read platform_settings. This returns only the keys that are
-- meant to be public (support contact and the public-catalog switch), never the table.
create or replace function public.public_site_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'support_email', nullif(btrim(coalesce((select s.value from public.platform_settings s where s.key = 'support_email'), '')), ''),
    'support_url', nullif(btrim(coalesce((select s.value from public.platform_settings s where s.key = 'support_url'), '')), ''),
    'public_catalog', coalesce((select s.value from public.platform_settings s where s.key = 'public_catalog'), 'false') = 'true'
  );
$$;
comment on function public.public_site_settings() is
  'Public projection of platform settings (support contact, public catalog switch) for signed-out pages.';
revoke execute on function public.public_site_settings() from public;
grant execute on function public.public_site_settings() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Access requests: the requester may withdraw their own pending request
-- ---------------------------------------------------------------------------
create or replace function public.withdraw_access_request(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  r public.access_requests;
begin
  select * into r from public.access_requests where id = p_request for update;
  if not found or r.user_id <> uid then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been reviewed or withdrawn';
  end if;
  update public.access_requests set status = 'withdrawn' where id = r.id;
  perform private.audit('access_request.withdraw', 'access_requests', r.id::text, r.offering_id, null, '{}'::jsonb);
end $$;
revoke execute on function public.withdraw_access_request(uuid) from public, anon;
grant execute on function public.withdraw_access_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Tool resources: archive instead of delete, trustworthy attribution, audit trail
-- ---------------------------------------------------------------------------
-- Written to be safe to re-run (the shared development database applied it by hand).
alter table public.tool_resources
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.profiles (id),
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles (id);
-- An archived entry is never visible to participants (the select policy requires published).
alter table public.tool_resources
  drop constraint if exists tool_resources_archived_unpublished,
  drop constraint if exists tool_resources_description_len,
  drop constraint if exists tool_resources_url_len;
alter table public.tool_resources
  add constraint tool_resources_archived_unpublished check (archived_at is null or not published),
  add constraint tool_resources_description_len check (char_length(description) <= 1000),
  add constraint tool_resources_url_len check (url is null or char_length(url) <= 2000);

-- Authors cannot forge who created, changed or archived an entry.
create or replace function private.stamp_tool_resource() returns trigger
language plpgsql set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if uid is not null then
      new.created_by := uid;
    end if;
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(uid, new.updated_by);
  if new.archived_at is null then
    new.archived_by := null;
  elsif tg_op = 'INSERT' or old.archived_at is null then
    new.archived_at := now();
    new.archived_by := coalesce(uid, new.archived_by);
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;
  return new;
end $$;
create or replace trigger tool_resources_stamp before insert or update on public.tool_resources
  for each row execute function private.stamp_tool_resource();
create or replace trigger tool_resources_audit after insert or update or delete on public.tool_resources
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Profiles: validate the fields people edit themselves
-- ---------------------------------------------------------------------------
-- Column grants already limit what a user may change; this adds value checks so a
-- direct API call cannot store an unusable time zone, a blank name, or someone
-- else's file as an avatar. Seeds and maintenance (no JWT role) are unaffected.
create or replace function private.guard_profile_account_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'authenticated' then
    return new;
  end if;
  if new.display_name is distinct from old.display_name and char_length(btrim(new.display_name)) = 0 then
    raise exception 'Enter a display name';
  end if;
  if new.timezone is distinct from old.timezone
     and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception 'Choose a valid time zone';
  end if;
  if new.avatar_asset_id is distinct from old.avatar_asset_id and new.avatar_asset_id is not null
     and not exists (select 1 from public.content_assets a
                     where a.id = new.avatar_asset_id and a.owner_id = new.id
                       and a.purpose = 'avatar' and a.status = 'ready') then
    raise exception 'Choose a profile photo you uploaded';
  end if;
  return new;
end $$;
create or replace trigger profiles_account_guard before update on public.profiles
  for each row execute function private.guard_profile_account_fields();
