-- Administration: storage bucket size limits, shown next to the per-type upload limits
-- on the settings page (an upload limit cannot exceed its bucket's limit). Read-only;
-- platform administrators only. The page reads it with the administrator's own session.
create or replace function public.admin_storage_limits()
returns table (purpose text, bucket text, file_size_limit bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform private.require_user();
  if not private.is_platform_admin() then
    raise exception 'Platform administrators only' using errcode = '42501';
  end if;
  return query
  select p.purpose, p.bucket, b.file_size_limit
  from (values ('lesson', 'course-content'), ('submission', 'submissions'),
               ('message', 'message-attachments'), ('avatar', 'avatars')) as p(purpose, bucket)
  left join storage.buckets b on b.id = p.bucket;
end $$;

revoke execute on function public.admin_storage_limits() from public, anon;
grant execute on function public.admin_storage_limits() to authenticated;
