# Permission matrix

Authorization is enforced by the database for every read and write: row-level security
(RLS) policies on every table, `SECURITY DEFINER` RPCs that check permission before acting,
and storage policies that follow the owning database record. The application layer never
widens access; hiding a button is only a convenience. All policies are in
`supabase/migrations/20261005000200_access_helpers_and_rls.sql`; RPC checks are in the
later migrations. Database tests in `tests/db/` exercise these boundaries through the real
API as real users.

## Roles

Roles are scoped. A person can be an instructor in one offering and a learner in another;
there is no global role switch.

| Role | Scope | Granted by |
|---|---|---|
| Platform administrator | Whole platform | `platform_role_grants` (role `platform_admin`). The first one is granted with the bootstrap command (below). |
| Cohort coordinator | Assigned cohorts only (`coordinator_scopes`) | A platform administrator. |
| Instructor | One course offering (`staff_assignments.role = instructor`) | A cohort coordinator or platform administrator. |
| Teaching assistant (TA) | One course offering (`staff_assignments.role = ta`) | Same. View and communicate by default; author, grade and publish grades only through explicit flags. |
| Learner (participant) | One course offering (`enrollments`, status `active` or `completed`) | Invitation acceptance, approved access request, or an administrator. |
| Registered Online Account | None | An account with no enrollment. It grants no private cohort or course access. |
| Signed-out visitor | Public pages | — |

Platform administrators and coordinators are "offering administrators" for offerings in
the cohorts they administer (`is_offering_admin`). Staff permission checks go through
`private.has_staff_perm(offering, perm)` where perm is `view`, `author`, `grade`,
`publish_grades`, `communicate` or `manage`:

| perm | Offering admin | Instructor | TA (default) | TA with flag |
|---|---|---|---|---|
| view | ✓ | ✓ | ✓ | ✓ |
| communicate | ✓ | ✓ | ✓ | ✓ |
| author | ✓ | ✓ | — | `can_author` |
| grade | ✓ | ✓ | — | `can_grade` |
| publish_grades | ✓ | ✓ | — | `can_publish_grades` |
| manage (accommodations) | ✓ | ✓ | — | — |

A suspended account (`profiles.suspended_at`) fails `is_active_user()`, which every
helper requires, so suspension removes access on the next request.

## Capabilities

✓ = allowed; "own" = only the person's own records; "assigned" = offerings where the
person holds that role; "cohort" = offerings in cohorts the coordinator administers.

### Accounts and directory

| Capability | Visitor | Registered account | Learner | TA | Instructor | Coordinator | Platform admin | Enforced by |
|---|---|---|---|---|---|---|---|---|
| Sign in, reset password, Help, legal pages | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Supabase Auth |
| Create an account by signing up | — | — | — | — | — | — | — | Public sign-up is disabled; accounts come from invitations |
| Edit own name, bio, avatar, locale, timezone | — | own | own | own | own | own | own | column grants + `profiles_update_self` + `guard_profile_update` |
| See another person's display name | — | people sharing an offering, cohort or thread | same | same | same | same | ✓ | `profiles_select` (`shares_scope`) |
| See another person's email | — | — | — | — | — | no, except the invited address on invitations in their cohorts (Invitations page, and the audit record of those invitations) | ✓ (Users, rosters, access requests, community members) | emails live in `auth.users`; `admin_users_page`, `admin_user_detail` and `admin_find_user` are for platform administrators only (`admin_find_user` returns no email), and `admin_offering_people`, `admin_cohort_people`, `admin_list_access_requests` and `admin_community_people` return the email only to platform administrators (null for coordinators); invitation addresses follow `invitations_select` (`is_cohort_admin`) |

### Catalog and enrollment

| Capability | Visitor | Registered account | Learner | TA | Instructor | Coordinator | Platform admin | Enforced by |
|---|---|---|---|---|---|---|---|---|
| Browse approved catalog metadata | if `public_catalog` is on | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | `catalog_list` (limited projection) |
| Request access to an offering | — | ✓ (creates a reviewable request; never enrolls) | ✓ | ✓ | ✓ | ✓ | ✓ | `request_access` |
| Review access requests | — | — | — | — | — | cohort | ✓ | `review_access_request` (`is_offering_admin`) |
| Create, resend, revoke invitations; CSV import | — | — | — | — | — | cohort | ✓ | `invitations_*` policies (`is_cohort_admin`) |
| Accept an invitation | — | invitations addressed to their verified email | ✓ | ✓ | ✓ | ✓ | ✓ | `accept_invitation` |
| Add, change or revoke enrollments and staff | — | — | — | — | — | cohort | ✓ | `enrollments_write`, `staff_write` (`is_offering_admin`) |

### Courses and content

| Capability | Learner | TA | Instructor | Coordinator | Platform admin | Enforced by |
|---|---|---|---|---|---|---|
| See an offering | own enrollments, once the offering and its version are published | assigned | assigned | cohort | ✓ | `can_view_offering` |
| Read a lesson and its files | released and unlocked lessons only | assigned (read-only preview) | assigned | cohort | ✓ | `can_read_lesson`, `can_read_asset`, storage policy `lms_objects_select` |
| Record lesson progress | own, active enrollment in a published offering | — | — | — | — | `mark_lesson_progress` (`is_active_learner`); staff preview never writes progress |
| Create courses | — | — | — | — | ✓ | `courses_write` |
| Create or edit a draft course version, modules, lessons, attachments | — | with `can_author` | assigned course | cohort | ✓ | `can_author_course`; drafts only (`modules_write`, `lessons_write`, `lesson_assets_write`) |
| Publish a draft version (immutable afterwards) | — | with `can_author` | ✓ | ✓ | ✓ | `publish_course_version`, `guard_course_version` |
| Adopt a published version for an offering | — | with `can_author` | assigned | cohort | ✓ | `adopt_course_version` (`has_staff_perm(..., 'author')` on that offering) |
| Create or edit offerings and cohorts | — | — | — | cohort (cohorts: edit only) | ✓ | `offerings_*`, `cohorts_*` policies |
| Prerequisite rules | — | with `can_author` | ✓ | ✓ | ✓ | `prereq_rules_write`; cycles rejected by `guard_prerequisite_cycle` |
| Prerequisite overrides (reason required, audited) | — | with `can_author` | ✓ | ✓ | ✓ | `prereq_overrides_*` |
| View rosters and progress | names of people in the offering | assigned | assigned | cohort | ✓ | `list_scope_members`, `completion_report` (`view`) |

An instructor of offering A can publish a new version of A's course but cannot change what
offering B shows: B keeps its adopted version until B's own staff adopt another one.

### Assessment

| Capability | Learner | TA | Instructor | Coordinator | Platform admin | Enforced by |
|---|---|---|---|---|---|---|
| See published quizzes and assignments | own offerings (assignments after `available_from`) | ✓ | ✓ | ✓ | ✓ | `quizzes_select`, `assignments_select` |
| Start, save and submit quiz attempts | own, active enrollment, inside the window, within attempt limits | — | — | — | — | `start_quiz_attempt`, `save_attempt_answer`, `submit_quiz_attempt` |
| Read answer keys | never | with `can_author` (authoring screen) | ✓ | ✓ | ✓ | keys are in `private.answer_keys` (no API access); `get_quiz_authoring` |
| Review own attempt answers and explanations | when the review policy allows | — | — | — | — | `get_attempt_review` |
| Author, publish, release answers | — | with `can_author` | ✓ | ✓ | ✓ | `create_quiz_draft`, `upsert_question`, `publish_quiz_version`, `release_quiz_answers` |
| Grade short answers, void attempts | — | with `can_grade` | ✓ | ✓ | ✓ | `grade_attempt_question`, `void_attempt` |
| Accommodations | own (read) | — | ✓ | ✓ | ✓ | `accommodations_*` (`manage`) |
| Save drafts and submit assignments | own, active enrollment | — | — | — | — | `save_submission_draft`, `submit_assignment` |
| Read submissions and their files | own | with `can_grade` (submitted work only) | ✓ | ✓ | ✓ | `submissions_select`, `can_read_asset` |
| Grade or return submissions | — | with `can_grade` | ✓ | ✓ | ✓ | `grade_submission` |

### Grades

| Capability | Learner | TA | Instructor | Coordinator | Platform admin | Enforced by |
|---|---|---|---|---|---|---|
| See own released grades and feedback | own | — | — | — | — | `released_grades_select` |
| See working (unpublished) grades | never | ✓ (view) | ✓ | ✓ | ✓ | `grades_select` |
| Enter or change grades | — | with `can_grade` | ✓ | ✓ | ✓ | `set_grade`, `grade_submission` (audited) |
| Create manual and participation grade items | — | with `can_author` | ✓ | ✓ | ✓ | `grade_items_write` |
| Publish or unpublish grades | — | with `can_publish_grades` | ✓ | ✓ | ✓ | `publish_grades`, `unpublish_grade` (audited) |
| Export the gradebook (CSV, no emails) | — | staff with view | ✓ | ✓ | ✓ | export route re-checks as the signed-in user |

### Communication

| Capability | Learner | TA | Instructor | Coordinator | Platform admin | Enforced by |
|---|---|---|---|---|---|---|
| Start a message thread | with people in the same offering or cohort scope | ✓ | ✓ | ✓ | ✓ | `create_thread` (`can_message_in_scope`), rate limited |
| Read a thread and its attachments | participants only | participants | participants | participants | participants | `is_thread_participant`, `can_read_asset` |
| Read announcements | released ones (published and due by server time) | ✓ | ✓ | cohort | ✓ | `announcements_select` |
| Create, schedule, pin, edit, archive announcements | — | ✓ (communicate) | ✓ | cohort announcements | ✓ | `announcements_write` |
| Post and reply in discussions | visible, unlocked topics | ✓ | ✓ | ✓ | ✓ | `posts_insert` |
| Edit own posts (history kept) | own, not hidden | own | own | own | own | `posts_update_own`, `on_post_edit` |
| Moderate discussions (hide, pin, lock) | — | ✓ (communicate) | ✓ | ✓ | ✓ | `can_moderate_topic`, `hide_discussion_post` |
| Calendar events | read in scope | create/edit (communicate) | ✓ | cohort events | ✓ | `calendar_*` |
| Tools and resources | read published entries in scope | manage offering entries | ✓ | entries of their cohorts and those cohorts' offerings | every scope, including platform-wide | `tools_*` |
| Join or leave open communities | ✓ (never grants course access) | ✓ | ✓ | ✓ | ✓ | `community_members_*` |
| Create and edit communities; add and remove members (invitation-only included) | — | — | — | their cohorts' communities | all, including program-wide | `communities_write`, `admin_add_community_member`, `admin_remove_community_member` (audited). Only eligible people can be added: an active account and, for a cohort's community, someone who belongs to that cohort. A community cannot move to a cohort some of its members are not in. |

### Administration

| Capability | Coordinator | Platform admin | Enforced by |
|---|---|---|---|
| User list with emails, suspend/reactivate, grant/revoke roles | — | ✓ (cannot suspend or reactivate self, or remove own administrator role) | `admin_users_page`, `admin_user_detail`, `admin_set_account_suspension`, `admin_set_role` |
| Coordinator scopes | — | ✓ | `coordinator_scopes_write` |
| Audit log | events in their cohorts | ✓ | `audit_select` |
| Platform settings and upload limits | — | ✓ | `settings_write`, `upload_limits_write` |

## Files

Every stored object has a database record (`content_assets`) with an owner and a purpose,
and an opaque path `purpose/<asset id>/<random id>` in a private bucket. Reading an object
requires `can_read_asset` for its record:

- **Lesson files**: authors of the course; otherwise only through a released, unlocked
  lesson the file is attached to (locked lessons issue no links).
- **Submission files**: the owner, and graders of that offering once submitted. Another
  learner in the same course cannot read them.
- **Message attachments**: participants of the thread the message belongs to.
- **Avatars**: any signed-in active user.
- Files that are not `ready` (pending, quarantined, rejected) are visible only to their owner.

Uploads must be registered first (`register_upload`: purpose, type, size and permission),
and the storage insert policy only accepts the exact pending object the caller registered.

## Preview, impersonation and bootstrap

- Staff and administrators view learner pages as themselves. The lesson viewer shows a
  "Staff preview: read-only" label and never records progress. There is no impersonation
  feature, so audit trails always name the real actor.
- The first platform administrator is granted with a server-side command against an
  explicit, verified user id: `npm run admin:bootstrap -- --user-id <uuid> --yes`
  (see [ADMIN_GUIDE.md](ADMIN_GUIDE.md)). Nothing in the application makes the first
  account, or an account with a particular name, an administrator.
- There are no default production passwords or public demo accounts. Sample accounts exist
  only where `npm run seed` was run (refused when `APP_ENV=production`).

## Audit

Sensitive changes write `audit_events` with actor, scope (cohort/offering), action, target
and change metadata. A row trigger records every insert, update and delete on
`platform_role_grants`, `coordinator_scopes`, `cohort_participation`, `staff_assignments`,
`enrollments`, `invitations`, `cohorts`, `courses`, `course_offerings`,
`prerequisite_rules`, `prerequisite_overrides`, `grades`, `quiz_accommodations`,
`calendar_events`, `tool_resources` and `communities`.
RPCs add explicit events for course duplication, course version drafts, publication and
adoption, offering publication and completion, quiz publication and answer release,
short-answer grading, attempt voids and time extensions, submission grading and returns,
grade publication and unpublication, announcement publication and status changes, suspensions and
reinstatements, access-request decisions and withdrawals, invitation revocation, upload
release and rejection, settings and upload-limit changes, community members added or
removed by administrators, and hidden discussion posts. Audit rows are readable only by
platform administrators and, for their cohorts, coordinators.
