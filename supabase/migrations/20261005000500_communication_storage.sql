-- Messages, announcements, discussions, notifications, private storage and uploads.

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------
create or replace function private.user_is_scope_admin(p_user uuid, p_cohort uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_role_grants g where g.user_id = p_user and g.role = 'platform_admin' and g.revoked_at is null)
      or exists (select 1 from public.platform_role_grants g join public.coordinator_scopes s on s.user_id = g.user_id
                 where g.user_id = p_user and g.role = 'coordinator' and g.revoked_at is null and s.cohort_id = p_cohort);
$$;

-- Who may send or receive messages in a scope: offering staff, active learners in a
-- published offering, cohort participants, and administrators of that cohort.
create or replace function private.can_message_in_scope(p_offering uuid, p_cohort uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_user and p.suspended_at is null) and (
    (p_offering is not null and (
      exists (select 1 from public.staff_assignments sa where sa.offering_id = p_offering and sa.user_id = p_user)
      or exists (select 1 from public.enrollments e join public.course_offerings o on o.id = e.offering_id
                 where e.offering_id = p_offering and e.user_id = p_user and e.status = 'active' and o.status = 'published')
      or private.user_is_scope_admin(p_user, (select o.cohort_id from public.course_offerings o where o.id = p_offering))))
    or (p_cohort is not null and (
      exists (select 1 from public.cohort_participation cp where cp.cohort_id = p_cohort and cp.user_id = p_user and cp.status = 'active')
      or exists (select 1 from public.staff_assignments sa join public.course_offerings o on o.id = sa.offering_id
                 where o.cohort_id = p_cohort and sa.user_id = p_user)
      or private.user_is_scope_admin(p_user, p_cohort))));
$$;

create or replace function private.validate_message_assets(p_assets uuid[], p_user uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from unnest(coalesce(p_assets, '{}')) x
             where not exists (select 1 from public.content_assets a where a.id = x and a.owner_id = p_user
                               and a.purpose = 'message' and a.status = 'ready')) then
    raise exception 'One or more attachments are not ready';
  end if;
end $$;

create or replace function public.my_message_scopes() returns table (
  scope_type text, scope_id uuid, code text, title text, accent_color text, unread integer, thread_count integer)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  return query
  with scopes as (
    select 'offering'::text as st, o.id as sid, o.code as c, v.title as t, o.accent_color as ac
    from public.course_offerings o join public.course_versions v on v.id = o.course_version_id
    where private.can_message_in_scope(o.id, null, uid)
    union all
    select 'cohort', co.id, co.code, co.name, '#475569'
    from public.cohorts co where private.can_message_in_scope(null, co.id, uid)
  )
  select s.st, s.sid, s.c, s.t, s.ac,
    (select count(*)::integer from public.threads th
       join public.thread_participants tp on tp.thread_id = th.id and tp.user_id = uid
       join public.messages m on m.thread_id = th.id and m.sender_id <> uid and (tp.last_read_at is null or m.created_at > tp.last_read_at)
       where (s.st = 'offering' and th.offering_id = s.sid) or (s.st = 'cohort' and th.cohort_id = s.sid)),
    (select count(*)::integer from public.threads th
       join public.thread_participants tp on tp.thread_id = th.id and tp.user_id = uid
       where (s.st = 'offering' and th.offering_id = s.sid) or (s.st = 'cohort' and th.cohort_id = s.sid))
  from scopes s
  order by s.t;
end $$;

create or replace function public.my_threads(p_offering uuid, p_cohort uuid) returns table (
  thread_id uuid, subject text, last_message_at timestamptz, unread integer, participant_names text[], last_sender text, preview text)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  return query
  select th.id, th.subject, th.last_message_at,
    (select count(*)::integer from public.messages m where m.thread_id = th.id and m.sender_id <> uid
       and (tp.last_read_at is null or m.created_at > tp.last_read_at)),
    array(select p.display_name from public.thread_participants tp2 join public.profiles p on p.id = tp2.user_id
          where tp2.thread_id = th.id and tp2.user_id <> uid order by p.display_name limit 6),
    (select p.display_name from public.messages m join public.profiles p on p.id = m.sender_id where m.thread_id = th.id order by m.created_at desc limit 1),
    (select left(m.body, 140) from public.messages m where m.thread_id = th.id order by m.created_at desc limit 1)
  from public.threads th
  join public.thread_participants tp on tp.thread_id = th.id and tp.user_id = uid
  where (p_offering is null or th.offering_id = p_offering) and (p_cohort is null or th.cohort_id = p_cohort)
  order by th.last_message_at desc
  limit 200;
end $$;

create or replace function public.create_thread(p_offering uuid, p_cohort uuid, p_recipients uuid[], p_subject text, p_body text,
                                                p_assets uuid[], p_confirm_large boolean, p_client_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  recips uuid[];
  tid uuid;
  mid uuid;
  r uuid;
begin
  if (p_offering is null) = (p_cohort is null) then raise exception 'Choose one course or cohort'; end if;
  if not private.can_message_in_scope(p_offering, p_cohort, uid) then
    raise exception 'You cannot send messages in this course or cohort' using errcode = '42501';
  end if;
  if p_client_key is not null then
    select m.thread_id into tid from public.messages m where m.sender_id = uid and m.client_key = p_client_key;
    if tid is not null then return tid; end if;
  end if;
  select coalesce(array_agg(distinct x), '{}') into recips from unnest(p_recipients) x where x is not null and x <> uid;
  if cardinality(recips) = 0 then raise exception 'Choose at least one recipient'; end if;
  if cardinality(recips) > 500 then raise exception 'Too many recipients'; end if;
  if cardinality(recips) > 10 and not coalesce(p_confirm_large, false) then
    raise exception 'Confirm sending to % recipients', cardinality(recips) using errcode = 'P0428';
  end if;
  -- Every recipient must belong to the same scope; this also prevents cross-cohort enumeration.
  if exists (select 1 from unnest(recips) x where not private.can_message_in_scope(p_offering, p_cohort, x)) then
    raise exception 'One or more recipients are not members of this course or cohort';
  end if;
  if char_length(coalesce(trim(p_subject), '')) = 0 or char_length(coalesce(trim(p_body), '')) = 0 then
    raise exception 'Subject and message are required';
  end if;
  perform private.validate_message_assets(p_assets, uid);
  perform private.hit_rate_limit('thread:' || uid, 30, 3600);
  insert into public.threads (offering_id, cohort_id, subject, created_by) values (p_offering, p_cohort, left(trim(p_subject), 300), uid)
  returning id into tid;
  insert into public.thread_participants (thread_id, user_id, last_read_at) values (tid, uid, now());
  insert into public.thread_participants (thread_id, user_id) select tid, x from unnest(recips) x;
  insert into public.messages (thread_id, sender_id, body, asset_ids, client_key)
  values (tid, uid, left(p_body, 20000), coalesce(p_assets, '{}'), p_client_key) returning id into mid;
  foreach r in array recips loop
    perform private.notify(r, 'message', p_offering, p_cohort, 'New message: ' || left(trim(p_subject), 200), '',
      '/messages/' || tid, 'message:' || mid);
  end loop;
  return tid;
end $$;

create or replace function public.send_message(p_thread uuid, p_body text, p_assets uuid[], p_client_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  th public.threads;
  mid uuid;
  r record;
begin
  select * into th from public.threads where id = p_thread;
  if not found or not private.is_thread_participant(p_thread) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  if not private.can_message_in_scope(th.offering_id, th.cohort_id, uid) then
    raise exception 'You can no longer send messages in this course or cohort' using errcode = '42501';
  end if;
  if char_length(coalesce(trim(p_body), '')) = 0 then raise exception 'Message is empty'; end if;
  if p_client_key is not null then
    select id into mid from public.messages where sender_id = uid and client_key = p_client_key;
    if mid is not null then return mid; end if;
  end if;
  perform private.validate_message_assets(p_assets, uid);
  perform private.hit_rate_limit('message:' || uid, 120, 3600);
  insert into public.messages (thread_id, sender_id, body, asset_ids, client_key)
  values (p_thread, uid, left(p_body, 20000), coalesce(p_assets, '{}'), p_client_key) returning id into mid;
  update public.threads set last_message_at = now() where id = p_thread;
  update public.thread_participants set last_read_at = now() where thread_id = p_thread and user_id = uid;
  for r in select user_id from public.thread_participants where thread_id = p_thread and user_id <> uid loop
    perform private.notify(r.user_id, 'message', th.offering_id, th.cohort_id, 'New reply: ' || th.subject, '',
      '/messages/' || p_thread, 'message:' || mid);
  end loop;
  return mid;
end $$;

create or replace function public.mark_thread_read(p_thread uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  update public.thread_participants set last_read_at = now() where thread_id = p_thread and user_id = uid;
  update public.notifications set read_at = now()
  where user_id = uid and kind = 'message' and read_at is null and target_url = '/messages/' || p_thread;
end $$;

create or replace function public.unread_message_count() returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.thread_participants tp
  join public.messages m on m.thread_id = tp.thread_id and m.sender_id <> tp.user_id
  where tp.user_id = (select auth.uid()) and (tp.last_read_at is null or m.created_at > tp.last_read_at);
$$;

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------
create or replace function private.announcement_audience(p_offering uuid, p_cohort uuid) returns table (user_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.user_id from public.enrollments e where p_offering is not null and e.offering_id = p_offering and e.status = 'active'
  union
  select sa.user_id from public.staff_assignments sa where p_offering is not null and sa.offering_id = p_offering
  union
  select cp.user_id from public.cohort_participation cp where p_cohort is not null and cp.cohort_id = p_cohort and cp.status = 'active'
  union
  select sa.user_id from public.staff_assignments sa join public.course_offerings o on o.id = sa.offering_id
  where p_cohort is not null and o.cohort_id = p_cohort;
$$;

create or replace function private.on_announcement_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if tg_op = 'UPDATE' and old.status = 'published' and (new.title <> old.title or new.body_html <> old.body_html) then
    insert into public.announcement_revisions (announcement_id, title, body_html, edited_by)
    values (old.id, old.title, old.body_html, (select auth.uid()));
  end if;
  if new.status = 'published' and coalesce(new.publish_at, now()) <= now() then
    for r in select a.user_id from private.announcement_audience(new.offering_id, new.cohort_id) a where a.user_id <> coalesce(new.created_by, '00000000-0000-0000-0000-000000000000'::uuid) loop
      perform private.notify(r.user_id, 'announcement', new.offering_id, new.cohort_id, new.title, '',
        case when new.offering_id is not null then '/courses/' || new.offering_id || '/announcements#a-' || new.id
             else '/cohorts/' || new.cohort_id || '#a-' || new.id end,
        'announcement:' || new.id, coalesce(new.publish_at, now()));
    end loop;
  end if;
  return new;
end $$;
create trigger announcements_change after insert or update on public.announcements
  for each row execute function private.on_announcement_change();

-- Scheduled announcements become visible by server time (RLS); their notifications are
-- materialized lazily when a member loads Activity, so no background worker is required.
create or replace function public.materialize_my_notifications() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  r record;
  n integer := 0;
begin
  for r in
    select a.* from public.announcements a
    where a.status = 'published' and a.publish_at is not null and a.publish_at <= now() and a.publish_at > now() - interval '30 days'
      and ((a.offering_id is not null and private.can_view_offering(a.offering_id))
           or (a.cohort_id is not null and private.is_cohort_member(a.cohort_id)))
      and not exists (select 1 from public.notifications nt where nt.user_id = uid and nt.dedupe_key = 'announcement:' || a.id)
  loop
    perform private.notify(uid, 'announcement', r.offering_id, r.cohort_id, r.title, '',
      case when r.offering_id is not null then '/courses/' || r.offering_id || '/announcements#a-' || r.id
           else '/cohorts/' || r.cohort_id || '#a-' || r.id end,
      'announcement:' || r.id, r.publish_at);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Discussions: edit history and moderation
-- ---------------------------------------------------------------------------
create or replace function private.on_post_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.body_html is distinct from old.body_html then
    insert into public.discussion_post_revisions (post_id, body_html) values (old.id, old.body_html);
    new.edited_at := now();
  end if;
  return new;
end $$;
create trigger discussion_posts_edit before update on public.discussion_posts for each row execute function private.on_post_edit();

create or replace function private.on_post_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.hit_rate_limit('post:' || new.author_id, 60, 3600);
  return new;
end $$;
create trigger discussion_posts_insert before insert on public.discussion_posts for each row execute function private.on_post_insert();

create or replace function public.hide_discussion_post(p_post uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  p public.discussion_posts;
begin
  select * into p from public.discussion_posts where id = p_post for update;
  if not found or not private.can_moderate_topic(p.topic_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.discussion_posts set body_html = '<p>[Removed by a moderator]</p>', hidden_at = now(), hidden_by = uid,
    hidden_reason = left(coalesce(p_reason, ''), 500)
  where id = p_post;
  perform private.audit('discussion.hide_post', 'discussion_posts', p_post::text, null, null, jsonb_build_object('reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- Invitations for existing accounts get an in-app notification
-- ---------------------------------------------------------------------------
create or replace function private.on_invitation_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  select u.id into uid from auth.users u where u.email::extensions.citext = new.email and u.email_confirmed_at is not null;
  if uid is not null then
    perform private.notify(uid, 'invitation', new.offering_id, new.cohort_id, 'You have a new invitation', '',
      '/invite/accept', 'invitation:' || new.id);
  end if;
  return new;
end $$;
create trigger invitations_notify after insert on public.invitations for each row execute function private.on_invitation_insert();

-- ---------------------------------------------------------------------------
-- Uploads: metadata first (pending), object upload to private storage, then the
-- server verifies size/signature and marks the asset ready with the service role.
-- ---------------------------------------------------------------------------
create table public.upload_limits (
  purpose text not null check (purpose in ('lesson', 'submission', 'message', 'avatar')),
  mime text not null,
  max_bytes bigint not null check (max_bytes > 0),
  primary key (purpose, mime)
);
alter table public.upload_limits enable row level security;
grant select on public.upload_limits to authenticated;
grant insert, update, delete on public.upload_limits to authenticated;
create policy upload_limits_select on public.upload_limits for select to authenticated using (true);
create policy upload_limits_write on public.upload_limits for all to authenticated
  using (private.is_platform_admin()) with check (private.is_platform_admin());

insert into public.upload_limits (purpose, mime, max_bytes)
select p.purpose, m.mime, m.max_bytes
from (values ('lesson'), ('submission'), ('message')) p(purpose)
cross join (values
  ('application/pdf', 52428800),
  ('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 52428800),
  ('application/vnd.openxmlformats-officedocument.presentationml.presentation', 104857600),
  ('image/png', 10485760), ('image/jpeg', 10485760), ('image/webp', 10485760), ('image/gif', 10485760),
  ('text/plain', 5242880), ('text/markdown', 5242880), ('text/csv', 5242880)
) m(mime, max_bytes);
insert into public.upload_limits (purpose, mime, max_bytes) values
  ('lesson', 'video/mp4', 1073741824),
  ('lesson', 'video/webm', 1073741824),
  ('lesson', 'text/vtt', 1048576),
  ('avatar', 'image/png', 5242880), ('avatar', 'image/jpeg', 5242880), ('avatar', 'image/webp', 5242880);

create or replace function public.register_upload(p_purpose text, p_filename text, p_mime text, p_size bigint,
                                                  p_offering uuid, p_course_version uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  lim bigint;
  v_bucket text;
  aid uuid := gen_random_uuid();
  path text;
begin
  perform private.hit_rate_limit('upload:' || uid, 120, 3600);
  select max_bytes into lim from public.upload_limits where purpose = p_purpose and mime = p_mime;
  if lim is null then raise exception 'This file type is not accepted here' using errcode = 'P0415'; end if;
  if p_size is null or p_size <= 0 or p_size > lim then
    raise exception 'File is too large (limit % MB)', round(lim / 1048576.0) using errcode = 'P0413';
  end if;
  if p_filename ~ '[/\\]' or char_length(p_filename) > 255 or char_length(p_filename) = 0 then
    raise exception 'Invalid file name';
  end if;
  if p_purpose = 'lesson' then
    if not exists (select 1 from public.course_versions v where v.id = p_course_version and v.status = 'draft' and private.can_author_course(v.course_id)) then
      raise exception 'Not authorized to upload to this course version' using errcode = '42501';
    end if;
    v_bucket := 'course-content';
  elsif p_purpose = 'submission' then
    if not private.is_active_learner(p_offering) then
      raise exception 'Not authorized to upload a submission here' using errcode = '42501';
    end if;
    v_bucket := 'submissions';
  elsif p_purpose = 'message' then
    v_bucket := 'message-attachments';
  elsif p_purpose = 'avatar' then
    v_bucket := 'avatars';
  else
    raise exception 'Unknown upload purpose';
  end if;
  path := p_purpose || '/' || aid || '/' || gen_random_uuid();
  insert into public.content_assets (id, owner_id, purpose, bucket, object_path, filename, declared_mime, size_bytes, offering_id, course_version_id)
  values (aid, uid, p_purpose, v_bucket, path, p_filename, p_mime, p_size,
          case when p_purpose = 'submission' then p_offering end,
          case when p_purpose = 'lesson' then p_course_version end);
  return jsonb_build_object('asset_id', aid, 'bucket', v_bucket, 'object_path', path, 'max_bytes', lim);
end $$;

create or replace function public.update_asset_metadata(p_asset uuid, p_title text, p_description text, p_alt text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.content_assets;
begin
  perform private.require_user();
  select * into a from public.content_assets where id = p_asset;
  if not found or not (a.owner_id = (select auth.uid()) or (a.purpose = 'lesson' and exists (
    select 1 from public.course_versions v where v.id = a.course_version_id and private.can_author_course(v.course_id)))) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.content_assets set title = left(coalesce(p_title, ''), 300), description = left(coalesce(p_description, ''), 2000),
    alt_text = left(coalesce(p_alt, ''), 1000) where id = p_asset;
end $$;

create or replace function private.can_upload_object(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_user() and exists (
    select 1 from public.content_assets a
    where a.object_path = p_name and a.bucket = p_bucket and a.owner_id = (select auth.uid()) and a.status = 'pending');
$$;

create or replace function private.can_read_object(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.content_assets a where a.object_path = p_name and a.bucket = p_bucket)
     and private.can_read_asset(private.asset_id_from_object(p_name));
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('course-content', 'course-content', false, 1073741824, null),
  ('submissions', 'submissions', false, 104857600, null),
  ('message-attachments', 'message-attachments', false, 104857600, null),
  ('avatars', 'avatars', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false;

create policy lms_objects_select on storage.objects for select to authenticated
  using (bucket_id in ('course-content', 'submissions', 'message-attachments', 'avatars') and private.can_read_object(bucket_id, name));
create policy lms_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('course-content', 'submissions', 'message-attachments', 'avatars') and private.can_upload_object(bucket_id, name));
create policy lms_objects_update on storage.objects for update to authenticated
  using (bucket_id in ('course-content', 'submissions', 'message-attachments', 'avatars') and private.can_upload_object(bucket_id, name))
  with check (bucket_id in ('course-content', 'submissions', 'message-attachments', 'avatars') and private.can_upload_object(bucket_id, name));

-- ---------------------------------------------------------------------------
-- Function grants (explicit). Mutating private helpers are not callable by API roles.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from authenticated;
grant execute on function
  private.is_active_user(), private.is_platform_admin(), private.is_cohort_admin(uuid), private.offering_cohort(uuid),
  private.is_offering_admin(uuid), private.has_staff_perm(uuid, text), private.offering_learner_visible(uuid),
  private.is_enrolled(uuid), private.is_active_learner(uuid), private.can_view_offering(uuid), private.is_cohort_member(uuid),
  private.is_community_member(uuid), private.can_view_community(uuid), private.can_author_course(uuid),
  private.can_view_course_version(uuid), private.shares_scope(uuid), private.can_read_lesson(uuid), private.can_read_asset(uuid),
  private.asset_id_from_object(text), private.is_thread_participant(uuid), private.can_view_topic(uuid),
  private.can_moderate_topic(uuid), private.can_upload_object(text, text), private.can_read_object(text, text),
  private.lesson_lock_reasons(uuid, uuid, uuid), private.released_quiz_pct(uuid, uuid), private.purge_allowed()
to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function public.catalog_list() to anon;
