import type { Client } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

export const SAMPLE_DOMAIN = "sample.crewscaler.test";

/**
 * Removes ONLY sample data: rows tied to is_sample offerings/cohorts/courses/communities
 * and accounts on the reserved sample domain, plus their stored objects.
 * Real (non-sample) records are never selected by these statements.
 */
export async function purgeSampleData(db: Client, admin: SupabaseClient) {
  const { rows: users } = await db.query("select id from auth.users where email like $1", [`%@${SAMPLE_DOMAIN}`]);
  const userIds = users.map((u) => u.id as string);

  const { rows: objects } = await db.query(
    `select bucket, object_path from public.content_assets
     where owner_id = any($1::uuid[])
        or course_version_id in (select v.id from public.course_versions v join public.courses c on c.id = v.course_id where c.is_sample)
        or offering_id in (select id from public.course_offerings where is_sample)`,
    [userIds],
  );
  const byBucket = new Map<string, string[]>();
  for (const o of objects) byBucket.set(o.bucket, [...(byBucket.get(o.bucket) ?? []), o.object_path]);
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 100) await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
  }

  await db.query("begin");
  try {
    await db.query("select set_config('app.allow_purge', 'on', true)");
    await db.query(`create temp table so on commit drop as select id from public.course_offerings where is_sample`);
    await db.query(`create temp table sc on commit drop as select id from public.cohorts where is_sample`);
    await db.query(`create temp table scr on commit drop as select id from public.courses where is_sample`);
    await db.query(`create temp table scm on commit drop as select id from public.communities where is_sample or cohort_id in (select id from sc)`);
    await db.query(`create temp table su on commit drop as select unnest($1::uuid[]) as id`, [userIds]);
    const stmts = [
      "delete from public.notifications where user_id in (select id from su) or offering_id in (select id from so) or cohort_id in (select id from sc)",
      "delete from public.released_grades where offering_id in (select id from so)",
      "delete from public.grades where offering_id in (select id from so)",
      "delete from private.attempt_results where attempt_id in (select id from public.quiz_attempts where offering_id in (select id from so))",
      "delete from public.attempt_answers where attempt_id in (select id from public.quiz_attempts where offering_id in (select id from so))",
      "delete from public.quiz_attempts where offering_id in (select id from so)",
      "delete from public.prerequisite_rules where offering_id in (select id from so)",
      "delete from public.prerequisite_overrides where offering_id in (select id from so)",
      "delete from public.grade_items where offering_id in (select id from so)",
      "update public.quizzes set current_version_id = null where offering_id in (select id from so)",
      "delete from public.questions where quiz_version_id in (select qv.id from public.quiz_versions qv join public.quizzes q on q.id = qv.quiz_id where q.offering_id in (select id from so))",
      "delete from public.quiz_versions where quiz_id in (select id from public.quizzes where offering_id in (select id from so))",
      "delete from public.quizzes where offering_id in (select id from so)",
      "delete from public.submission_versions where submission_id in (select id from public.submissions where offering_id in (select id from so))",
      "delete from public.submissions where offering_id in (select id from so)",
      "delete from public.assignments where offering_id in (select id from so)",
      "delete from public.threads where offering_id in (select id from so) or cohort_id in (select id from sc)",
      "update public.discussion_posts set parent_id = null where topic_id in (select id from public.discussion_topics where offering_id in (select id from so) or cohort_id in (select id from sc) or community_id in (select id from scm))",
      "delete from public.discussion_posts where topic_id in (select id from public.discussion_topics where offering_id in (select id from so) or cohort_id in (select id from sc) or community_id in (select id from scm))",
      "delete from public.discussion_topics where offering_id in (select id from so) or cohort_id in (select id from sc) or community_id in (select id from scm)",
      "delete from public.announcements where offering_id in (select id from so) or cohort_id in (select id from sc)",
      "delete from public.calendar_events where offering_id in (select id from so) or cohort_id in (select id from sc)",
      "delete from public.tool_resources where offering_id in (select id from so) or cohort_id in (select id from sc) or created_by in (select id from su)",
      "delete from public.lesson_progress where offering_id in (select id from so)",
      "delete from public.completion_snapshots where offering_id in (select id from so)",
      "delete from public.access_requests where offering_id in (select id from so) or user_id in (select id from su)",
      "delete from public.favorites where offering_id in (select id from so)",
      "delete from public.invitations where offering_id in (select id from so) or cohort_id in (select id from sc) or email::text like '%@sample.crewscaler.test'",
      "delete from public.enrollments where offering_id in (select id from so)",
      "delete from public.staff_assignments where offering_id in (select id from so)",
      "delete from public.course_offerings where id in (select id from so)",
      "update public.profiles set avatar_asset_id = null where id in (select id from su)",
      "delete from public.lesson_assets where lesson_id in (select l.id from public.lessons l join public.course_versions v on v.id = l.course_version_id where v.course_id in (select id from scr))",
      "delete from public.lessons where course_version_id in (select id from public.course_versions where course_id in (select id from scr))",
      "delete from public.modules where course_version_id in (select id from public.course_versions where course_id in (select id from scr))",
      "delete from public.content_assets where owner_id in (select id from su) or course_version_id in (select id from public.course_versions where course_id in (select id from scr))",
      "update public.course_versions set based_on_version_id = null where course_id in (select id from scr)",
      "delete from public.course_versions where course_id in (select id from scr)",
      "delete from public.courses where id in (select id from scr)",
      "delete from public.communities where id in (select id from scm)",
      "delete from public.cohort_participation where cohort_id in (select id from sc) or user_id in (select id from su)",
      "delete from public.coordinator_scopes where cohort_id in (select id from sc)",
      "delete from public.cohorts where id in (select id from sc)",
      "delete from public.audit_events where actor_id in (select id from su) or offering_id in (select id from so) or cohort_id in (select id from sc)",
    ];
    for (const s of stmts) await db.query(s);
    await db.query("commit");
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
  for (const id of userIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`deleteUser ${id}: ${error.message}`);
  }
  // Audit rows written while deleting sample users' grants.
  await db.query("delete from public.audit_events where actor_id is null and target_table = 'platform_role_grants' and metadata->'row'->>'user_id' = any($1::text[])", [userIds]);
}
