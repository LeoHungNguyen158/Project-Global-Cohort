-- Least privilege for functions in the private schema.
--
-- New functions are executable by PUBLIC unless revoked, and a per-schema default privilege
-- cannot remove that global default. The private schema is not exposed through the Data API,
-- so no client can call these functions directly, but signed-in users need usage on the
-- schema for row-level policies, and that should not extend to helpers such as
-- private.release_grade(grade, actor) or private.notify(user, ...).
--
-- Keep execute only where the signed-in role itself evaluates the function:
--   * helpers called by row-level policies (public tables and storage.objects), and
--   * private.purge_allowed(), called by SECURITY INVOKER guard triggers.
-- Trigger functions need no execute privilege to fire, and SECURITY DEFINER functions call
-- other private functions as their owner.

revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function
  private.can_author_course(uuid),
  private.can_moderate_topic(uuid),
  private.can_read_asset(uuid),
  private.can_read_lesson(uuid),
  private.can_read_object(text, text),
  private.can_upload_object(text, text),
  private.can_view_community(uuid),
  private.can_view_course_version(uuid),
  private.can_view_offering(uuid),
  private.can_view_topic(uuid),
  private.has_staff_perm(uuid, text),
  private.is_active_user(),
  private.is_cohort_admin(uuid),
  private.is_cohort_member(uuid),
  private.is_community_member(uuid),
  private.is_offering_admin(uuid),
  private.is_platform_admin(),
  private.is_thread_participant(uuid),
  private.offering_cohort(uuid),
  private.shares_scope(uuid),
  private.purge_allowed()
to authenticated;

-- Learners see a grade item only once the assignment or quiz behind it has been published and
-- is available (archived ones stay visible so released results remain); before that even its
-- title stays with staff.
drop policy grade_items_select on public.grade_items;
create policy grade_items_select on public.grade_items for select to authenticated using (
  private.has_staff_perm(offering_id, 'view')
  or (
    visible_to_learners
    and private.can_view_offering(offering_id)
    and (assignment_id is null or exists (
      select 1 from public.assignments a
      where a.id = assignment_id and a.status in ('published', 'archived') and (a.available_from is null or a.available_from <= now())))
    and (quiz_id is null or exists (
      select 1 from public.quizzes q
      where q.id = quiz_id and q.status in ('published', 'archived') and (q.available_from is null or q.available_from <= now())))
  )
);
