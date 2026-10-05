-- Crew Scaler Global Cohort LMS: core schema.
-- All timestamps are timestamptz (stored UTC). IANA timezones are stored alongside
-- cohorts, offerings and events so displays can reference course time.
-- Data that learners must never read (answer keys, working grades, audit internals)
-- lives in the non-exposed `private` schema or behind RLS with no learner policy.

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
-- RLS policy expressions call private helper functions as the invoking role.
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 120),
  avatar_asset_id uuid,
  locale text not null default 'en' check (locale in ('en', 'vi')),
  timezone text not null default 'America/New_York' check (char_length(timezone) between 1 and 64),
  courses_view text not null default 'list' check (courses_view in ('list', 'grid')),
  bio text not null default '' check (char_length(bio) <= 2000),
  suspended_at timestamptz,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Public-facing profile. Email stays in auth.users and is never exposed in directories.';

create table public.platform_role_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('platform_admin', 'coordinator')),
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id)
);
create unique index platform_role_grants_active_uq on public.platform_role_grants (user_id, role) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Program structure
-- ---------------------------------------------------------------------------
create table public.cohorts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Za-z0-9_.-]{2,64}$'),
  name text not null check (char_length(name) between 1 and 200),
  description text not null default '',
  timezone text not null default 'America/New_York',
  starts_on date,
  ends_on date,
  status text not null default 'active' check (status in ('upcoming', 'active', 'archived')),
  is_sample boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table public.coordinator_scopes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  cohort_id uuid not null references public.cohorts (id) on delete cascade,
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, cohort_id)
);

-- Academic cohort membership. Separate from optional community participation.
create table public.cohort_participation (
  cohort_id uuid not null references public.cohorts (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended', 'withdrawn')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (cohort_id, user_id)
);

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid references public.cohorts (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 200),
  description text not null default '',
  join_policy text not null default 'open' check (join_policy in ('open', 'invite')),
  is_sample boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.community_members (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Za-z0-9_.-]{2,64}$'),
  title text not null check (char_length(title) between 1 and 300),
  is_sample boolean not null default false,
  archived_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Reusable, versioned course content. Published versions are immutable.
create table public.course_versions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete restrict,
  version_no integer not null check (version_no > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  title text not null check (char_length(title) between 1 and 300),
  summary text not null default '',
  objectives text[] not null default '{}',
  audience text not null default '',
  expected_effort text not null default '',
  prerequisites_text text not null default '',
  syllabus_html text not null default '',
  grading_policy text not null default '',
  based_on_version_id uuid references public.course_versions (id),
  published_at timestamptz,
  published_by uuid references public.profiles (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, version_no)
);
create unique index course_versions_one_draft on public.course_versions (course_id) where status = 'draft';

create table public.course_offerings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete restrict,
  course_version_id uuid not null references public.course_versions (id) on delete restrict,
  cohort_id uuid not null references public.cohorts (id) on delete restrict,
  code text not null unique check (code ~ '^[A-Za-z0-9_.-]{2,64}$'),
  term_label text not null default '',
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'America/New_York',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  accent_color text not null default '#1D4ED8' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  catalog_visible boolean not null default false,
  catalog_state text not null default 'not_open' check (catalog_state in ('open_for_requests', 'not_open')),
  grade_scheme text not null default 'points' check (grade_scheme in ('points')),
  is_sample boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index course_offerings_cohort_idx on public.course_offerings (cohort_id);
create index course_offerings_course_idx on public.course_offerings (course_id);

create table public.staff_assignments (
  offering_id uuid not null references public.course_offerings (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('instructor', 'ta')),
  can_author boolean not null default false,
  can_grade boolean not null default true,
  can_publish_grades boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (offering_id, user_id)
);
create index staff_assignments_user_idx on public.staff_assignments (user_id);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.course_offerings (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'suspended', 'withdrawn', 'completed')),
  source text not null default 'admin' check (source in ('admin', 'invitation', 'access_request', 'import', 'seed')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (offering_id, user_id)
);
create index enrollments_user_idx on public.enrollments (user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null check (char_length(email::text) between 3 and 320),
  role text not null check (role in ('participant', 'instructor', 'ta')),
  cohort_id uuid references public.cohorts (id) on delete restrict,
  offering_id uuid references public.course_offerings (id) on delete restrict,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id),
  revoked_at timestamptz,
  email_status text not null default 'not_sent' check (email_status in ('not_sent', 'accepted_by_provider', 'failed', 'existing_account_notified')),
  email_error text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (cohort_id is not null or offering_id is not null),
  check (role = 'participant' or offering_id is not null)
);
create index invitations_email_idx on public.invitations (email);

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.course_offerings (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text not null default '' check (char_length(message) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text not null default '',
  created_at timestamptz not null default now()
);
create unique index access_requests_one_pending on public.access_requests (offering_id, user_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Content
-- ---------------------------------------------------------------------------
create table public.modules (
  id uuid primary key default gen_random_uuid(),
  course_version_id uuid not null references public.course_versions (id) on delete cascade,
  lineage_id uuid not null default gen_random_uuid(),
  position integer not null check (position >= 0),
  title text not null check (char_length(title) between 1 and 300),
  description text not null default '',
  created_at timestamptz not null default now(),
  unique (course_version_id, lineage_id)
);
create index modules_version_idx on public.modules (course_version_id, position);

create table public.content_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id),
  purpose text not null check (purpose in ('lesson', 'submission', 'message', 'avatar', 'resource')),
  bucket text not null check (bucket in ('course-content', 'submissions', 'message-attachments', 'avatars')),
  object_path text not null unique,
  filename text not null check (char_length(filename) between 1 and 255),
  declared_mime text not null,
  detected_mime text,
  size_bytes bigint not null check (size_bytes > 0),
  status text not null default 'pending' check (status in ('pending', 'ready', 'quarantined', 'rejected', 'deleted')),
  rejection_reason text,
  title text not null default '',
  description text not null default '',
  alt_text text not null default '',
  -- Parent bindings (exactly one, depending on purpose). Permissions inherit from the parent.
  offering_id uuid references public.course_offerings (id),
  course_version_id uuid references public.course_versions (id),
  replaces_asset_id uuid references public.content_assets (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index content_assets_owner_idx on public.content_assets (owner_id);
alter table public.profiles add constraint profiles_avatar_fk foreign key (avatar_asset_id) references public.content_assets (id) on delete set null;

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules (id) on delete cascade,
  course_version_id uuid not null references public.course_versions (id) on delete cascade,
  lineage_id uuid not null default gen_random_uuid(),
  position integer not null check (position >= 0),
  title text not null check (char_length(title) between 1 and 300),
  content_type text not null check (content_type in ('text', 'pdf', 'video', 'file', 'link', 'embed')),
  body_html text not null default '',
  required boolean not null default true,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 0 and 10000),
  completion_rule text not null default 'acknowledge' check (completion_rule in ('acknowledge', 'video_watched')),
  external_url text check (external_url is null or external_url ~ '^https://'),
  embed_provider text check (embed_provider is null or embed_provider in ('youtube', 'vimeo')),
  embed_id text check (embed_id is null or embed_id ~ '^[A-Za-z0-9_-]{4,64}$'),
  transcript text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_version_id, lineage_id)
);
create index lessons_module_idx on public.lessons (module_id, position);

create table public.lesson_assets (
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  asset_id uuid not null references public.content_assets (id) on delete restrict,
  role text not null default 'attachment' check (role in ('primary', 'attachment', 'captions')),
  position integer not null default 0,
  caption_language text check (caption_language is null or caption_language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  primary key (lesson_id, asset_id)
);

-- Per-offering release and unlock rules, keyed by stable lineage ids so a newly
-- adopted course version keeps learner history and rules.
create table public.prerequisite_rules (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.course_offerings (id) on delete cascade,
  target_lesson_lineage uuid not null,
  kind text not null check (kind in ('lesson_complete', 'quiz_min_score', 'release_at')),
  required_lesson_lineage uuid,
  quiz_id uuid,
  min_score_pct numeric(5,2) check (min_score_pct is null or (min_score_pct >= 0 and min_score_pct <= 100)),
  release_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (
    (kind = 'lesson_complete' and required_lesson_lineage is not null and required_lesson_lineage <> target_lesson_lineage)
    or (kind = 'quiz_min_score' and quiz_id is not null and min_score_pct is not null)
    or (kind = 'release_at' and release_at is not null)
  )
);
create index prerequisite_rules_target_idx on public.prerequisite_rules (offering_id, target_lesson_lineage);

create table public.prerequisite_overrides (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.course_offerings (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  target_lesson_lineage uuid not null,
  reason text not null check (char_length(reason) between 3 and 1000),
  granted_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index prerequisite_overrides_idx on public.prerequisite_overrides (offering_id, user_id, target_lesson_lineage);

create table public.lesson_progress (
  offering_id uuid not null references public.course_offerings (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  lesson_lineage uuid not null,
  last_lesson_id uuid references public.lessons (id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  last_position_seconds integer not null default 0 check (last_position_seconds >= 0),
  max_position_seconds integer not null default 0 check (max_position_seconds >= 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  updated_at timestamptz not null default now(),
  primary key (offering_id, user_id, lesson_lineage)
);

create table public.completion_snapshots (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.course_offerings (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  course_version_id uuid not null references public.course_versions (id),
  required_total integer not null,
  required_completed integer not null,
  completed_at timestamptz not null default now(),
  unique (offering_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Assessments
-- ---------------------------------------------------------------------------
create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.course_offerings (id) on delete restrict,
  module_lineage uuid,
  title text not null check (char_length(title) between 1 and 300),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  current_version_id uuid,
  available_from timestamptz,
  closes_at timestamptz,
  time_limit_minutes integer check (time_limit_minutes is null or time_limit_minutes between 1 and 1440),
  attempt_limit integer not null default 1 check (attempt_limit between 1 and 100),
  pass_pct numeric(5,2) not null default 70 check (pass_pct between 0 and 100),
  shuffle_questions boolean not null default false,
  shuffle_choices boolean not null default false,
  review_policy text not null default 'after_close' check (review_policy in ('never', 'after_submit', 'after_close', 'manual')),
  answers_released_at timestamptz,
  score_release text not null default 'manual' check (score_release in ('immediate', 'manual')),
  scoring_rule text not null default 'highest' check (scoring_rule in ('highest', 'latest')),
  truncate_at_close boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at is null or available_from is null or closes_at > available_from)
);
alter table public.prerequisite_rules add constraint prerequisite_rules_quiz_fk foreign key (quiz_id) references public.quizzes (id) on delete restrict;

create table public.quiz_versions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete restrict,
  version_no integer not null check (version_no > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  instructions text not null default '',
  published_at timestamptz,
  published_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (quiz_id, version_no)
);
create unique index quiz_versions_one_draft on public.quiz_versions (quiz_id) where status = 'draft';
alter table public.quizzes add constraint quizzes_current_version_fk foreign key (current_version_id) references public.quiz_versions (id);

-- Learner-safe question content. Learners never select this table directly; they
-- receive questions only through attempt functions after starting an attempt.
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  quiz_version_id uuid not null references public.quiz_versions (id) on delete cascade,
  lineage_id uuid not null default gen_random_uuid(),
  position integer not null check (position >= 0),
  type text not null check (type in ('single_choice', 'multiple_select', 'true_false', 'short_answer')),
  prompt text not null check (char_length(prompt) between 1 and 10000),
  points numeric(8,2) not null default 1 check (points > 0),
  choices jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (quiz_version_id, lineage_id)
);
create index questions_version_idx on public.questions (quiz_version_id, position);

create table public.quiz_accommodations (
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  extra_minutes integer not null default 0 check (extra_minutes between 0 and 10000),
  extended_closes_at timestamptz,
  extra_attempts integer not null default 0 check (extra_attempts between 0 and 100),
  note text not null default '',
  granted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (quiz_id, user_id)
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete restrict,
  quiz_version_id uuid not null references public.quiz_versions (id) on delete restrict,
  offering_id uuid not null references public.course_offerings (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  attempt_no integer not null check (attempt_no > 0),
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'graded', 'voided')),
  started_at timestamptz not null default now(),
  deadline_at timestamptz,
  submitted_at timestamptz,
  finalized_reason text check (finalized_reason in ('submitted', 'expired')),
  question_order uuid[] not null,
  choice_order jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (quiz_id, user_id, attempt_no)
);
create unique index quiz_attempts_one_in_progress on public.quiz_attempts (quiz_id, user_id) where status = 'in_progress';
create index quiz_attempts_user_idx on public.quiz_attempts (user_id);

create table public.attempt_answers (
  attempt_id uuid not null references public.quiz_attempts (id) on delete restrict,
  question_id uuid not null references public.questions (id) on delete restrict,
  response jsonb not null default 'null'::jsonb,
  saved_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.course_offerings (id) on delete restrict,
  module_lineage uuid,
  title text not null check (char_length(title) between 1 and 300),
  instructions_html text not null default '',
  submission_types text[] not null default array['text']::text[] check (submission_types <@ array['text', 'file', 'url']::text[] and cardinality(submission_types) > 0),
  points numeric(8,2) not null default 100 check (points > 0),
  rubric jsonb not null default '[]'::jsonb,
  available_from timestamptz,
  due_at timestamptz,
  closes_at timestamptz,
  late_policy text not null default 'accept_flag' check (late_policy in ('accept_flag', 'reject')),
  max_submissions integer not null default 3 check (max_submissions between 1 and 50),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at is null or due_at is null or closes_at >= due_at)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete restrict,
  offering_id uuid not null references public.course_offerings (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'graded')),
  draft_text text not null default '' check (char_length(draft_text) <= 100000),
  draft_url text check (draft_url is null or draft_url ~ '^https://'),
  draft_asset_ids uuid[] not null default '{}',
  draft_saved_at timestamptz,
  submitted_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, user_id)
);

create table public.submission_versions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete restrict,
  version_no integer not null check (version_no > 0),
  body_text text not null default '',
  url text,
  asset_ids uuid[] not null default '{}',
  submitted_at timestamptz not null default now(),
  is_late boolean not null default false,
  receipt_code text not null unique,
  unique (submission_id, version_no)
);

create table public.grade_items (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.course_offerings (id) on delete restrict,
  kind text not null check (kind in ('assignment', 'quiz', 'participation', 'manual')),
  assignment_id uuid unique references public.assignments (id) on delete restrict,
  quiz_id uuid unique references public.quizzes (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 300),
  max_points numeric(8,2) not null check (max_points > 0),
  counts_toward_total boolean not null default true,
  position integer not null default 0,
  visible_to_learners boolean not null default true,
  created_at timestamptz not null default now(),
  check ((kind = 'assignment') = (assignment_id is not null)),
  check ((kind = 'quiz') = (quiz_id is not null))
);
create index grade_items_offering_idx on public.grade_items (offering_id);

-- Staff working grades. Learners have no policy on this table.
create table public.grades (
  id uuid primary key default gen_random_uuid(),
  grade_item_id uuid not null references public.grade_items (id) on delete restrict,
  offering_id uuid not null references public.course_offerings (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'graded' check (status in ('graded', 'missing', 'exempt', 'pending')),
  points numeric(10,2) check (points is null or points >= 0),
  feedback text not null default '' check (char_length(feedback) <= 20000),
  rubric_scores jsonb not null default '{}'::jsonb,
  source_attempt_id uuid references public.quiz_attempts (id),
  graded_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  dirty boolean not null default true,
  unique (grade_item_id, user_id),
  check (status <> 'graded' or points is not null)
);
create index grades_offering_idx on public.grades (offering_id);

-- Learner-visible released grades, written only by the publication function.
create table public.released_grades (
  grade_id uuid primary key references public.grades (id) on delete restrict,
  grade_item_id uuid not null references public.grade_items (id) on delete restrict,
  offering_id uuid not null references public.course_offerings (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  status text not null check (status in ('graded', 'missing', 'exempt')),
  points numeric(10,2),
  max_points numeric(8,2) not null,
  feedback text not null default '',
  rubric_scores jsonb not null default '{}'::jsonb,
  released_at timestamptz not null default now(),
  released_by uuid references public.profiles (id)
);
create index released_grades_user_idx on public.released_grades (user_id, offering_id);

-- ---------------------------------------------------------------------------
-- Communication
-- ---------------------------------------------------------------------------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid references public.course_offerings (id) on delete restrict,
  cohort_id uuid references public.cohorts (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 300),
  body_html text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  publish_at timestamptz,
  pinned boolean not null default false,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((offering_id is null) <> (cohort_id is null))
);

create table public.announcement_revisions (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  title text not null,
  body_html text not null,
  edited_by uuid references public.profiles (id),
  edited_at timestamptz not null default now()
);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid references public.course_offerings (id) on delete restrict,
  cohort_id uuid references public.cohorts (id) on delete restrict,
  kind text not null default 'event' check (kind in ('live_session', 'office_hours', 'event')),
  title text not null check (char_length(title) between 1 and 300),
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/New_York',
  location text not null default '',
  meeting_url text check (meeting_url is null or meeting_url ~ '^https://'),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((offering_id is null) <> (cohort_id is null))
);

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid references public.course_offerings (id) on delete restrict,
  cohort_id uuid references public.cohorts (id) on delete restrict,
  subject text not null check (char_length(subject) between 1 and 300),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  check ((offering_id is null) <> (cohort_id is null))
);

create table public.thread_participants (
  thread_id uuid not null references public.threads (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);
create index thread_participants_user_idx on public.thread_participants (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text not null check (char_length(body) between 1 and 20000),
  asset_ids uuid[] not null default '{}',
  client_key text,
  created_at timestamptz not null default now(),
  unique (sender_id, client_key)
);
create index messages_thread_idx on public.messages (thread_id, created_at);

create table public.discussion_topics (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid references public.course_offerings (id) on delete restrict,
  cohort_id uuid references public.cohorts (id) on delete restrict,
  community_id uuid references public.communities (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 300),
  body_html text not null default '',
  pinned boolean not null default false,
  locked boolean not null default false,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (num_nonnulls(offering_id, cohort_id, community_id) = 1)
);

create table public.discussion_posts (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.discussion_topics (id) on delete restrict,
  parent_id uuid references public.discussion_posts (id) on delete restrict,
  author_id uuid not null references public.profiles (id),
  body_html text not null check (char_length(body_html) between 1 and 50000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id),
  hidden_reason text
);
create index discussion_posts_topic_idx on public.discussion_posts (topic_id, created_at);

create table public.discussion_post_revisions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.discussion_posts (id) on delete cascade,
  body_html text not null,
  edited_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('announcement', 'grade', 'message', 'content', 'access_request', 'invitation', 'submission', 'system')),
  offering_id uuid references public.course_offerings (id) on delete cascade,
  cohort_id uuid references public.cohorts (id) on delete cascade,
  title text not null,
  body text not null default '',
  target_url text not null check (target_url ~ '^/'),
  dedupe_key text not null,
  occurred_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, occurred_at desc);

create table public.notification_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('announcement', 'grade', 'message', 'content', 'access_request', 'invitation', 'submission', 'system')),
  in_app boolean not null default true,
  email boolean not null default false,
  primary key (user_id, kind)
);

create table public.favorites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  offering_id uuid not null references public.course_offerings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, offering_id)
);

create table public.tool_resources (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid references public.course_offerings (id) on delete restrict,
  cohort_id uuid references public.cohorts (id) on delete restrict,
  category text not null check (category in ('setup', 'policy', 'support', 'resource')),
  title text not null check (char_length(title) between 1 and 300),
  description text not null default '',
  body_html text not null default '',
  url text check (url is null or url ~ '^https://'),
  published boolean not null default true,
  position integer not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (offering_id is null or cohort_id is null)
);

create table public.platform_settings (
  key text primary key check (key in ('support_email', 'support_url', 'public_catalog', 'program_name')),
  value text not null default '',
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id),
  action text not null,
  target_table text not null,
  target_id text,
  offering_id uuid,
  cohort_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_created_idx on public.audit_events (created_at desc);
create index audit_events_offering_idx on public.audit_events (offering_id);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications (id) on delete cascade,
  channel text not null check (channel in ('email')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (notification_id, channel)
);

-- Private: never granted to API roles.
create table private.answer_keys (
  question_id uuid primary key references public.questions (id) on delete cascade,
  correct_choice_ids text[] not null default '{}',
  explanation text not null default ''
);

create table private.attempt_results (
  attempt_id uuid not null references public.quiz_attempts (id) on delete restrict,
  question_id uuid not null references public.questions (id) on delete restrict,
  auto_points numeric(8,2),
  manual_points numeric(8,2),
  max_points numeric(8,2) not null,
  needs_manual boolean not null default false,
  feedback text not null default '',
  graded_by uuid references public.profiles (id),
  graded_at timestamptz,
  primary key (attempt_id, question_id)
);

create table private.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

-- updated_at maintenance
create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','cohorts','courses','course_versions','course_offerings','enrollments','lessons','quizzes','assignments','submissions','announcements','grades']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function private.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;
