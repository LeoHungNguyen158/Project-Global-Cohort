# Architecture

Crew Scaler Global Cohort is a server-rendered Next.js application with Supabase as the
managed data layer. The web application is designed to run on Hostinger (managed Node.js
hosting, or a VPS with Docker); PostgreSQL, authentication and file storage live in a
Supabase project. **The data layer is an external managed service, not part of the
Hostinger account**, and it is billed separately (see [COST_NOTES.md](COST_NOTES.md)).

```
Browser ──HTTPS──► Next.js server on Hostinger ──HTTPS──► Supabase project
  │                 • proxy: session refresh, CSP,          • Postgres + RLS + RPCs
  │                   sign-in redirects, no-store           • Auth (email/password,
  │                 • Server Components (render as user)      invitations, recovery)
  │                 • Server Actions (mutations)            • Storage (4 private buckets)
  │                 • Route handlers (/api/*)
  └──direct upload (signed by the user's session)──────────► Storage (private)
```

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript (strict) | `src/proxy.ts` is the request proxy (formerly middleware). |
| Styling | Tailwind CSS v4 with design tokens in `src/app/globals.css` | Tokens follow the brief's proposed palette; editable in one file. |
| Data | Supabase Postgres 17 with row-level security on every table | Schema and policies are SQL migrations in `supabase/migrations/`. |
| Auth | Supabase Auth via `@supabase/ssr` (cookie sessions) | Invitation-only accounts; no public sign-up. |
| Files | Supabase Storage, private buckets only | Served through `/api/assets/<id>` after an access check. |
| Validation | `zod` and explicit FormData readers (`src/lib/forms.ts`) | Every server action re-validates input. |
| Tests | Vitest (unit, database), Playwright + axe (browser) | See [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md). |

## Request lifecycle and identity

1. `src/proxy.ts` runs on page requests. It refreshes the Supabase session cookie
   (`auth.getClaims()` verifies the JWT), adds a per-request CSP nonce, redirects
   signed-out visitors away from protected prefixes to `/login?next=…`, and marks every
   signed-in response `Cache-Control: private, no-store` so shared caches never store a
   personalized page.
2. Server Components call `requireUser()` / `getCurrentUser()` (`src/lib/auth.ts`), which
   verifies the user with the Auth server and reads **current** roles from the database
   (`my_context` RPC) on every request. Suspensions and revoked roles take effect on the
   next request without waiting for sign-out.
3. Course pages call `requireOffering(id)` (`src/lib/data/offering-access.ts`), which
   returns 404 unless the database lets the user see the offering, and computes UI
   flags (author, grade, publish grades, communicate). **These flags only shape the UI.**
4. Every query runs through the user-scoped client (`src/lib/supabase/server.ts`), so
   PostgreSQL RLS policies and `SECURITY DEFINER` RPCs make the real decision. The
   privileged client (`src/lib/supabase/admin.ts`) is used only after the caller has been
   authorized, for: sending auth invitations, verifying uploaded files, and maintenance.

## Data model

The full schema is in `supabase/migrations/20261005000100_core_schema.sql`.

- **Program structure**: `cohorts` (program groups) → `course_offerings` (a scheduled run
  of a course in one cohort, with its own dates, IANA timezone, staff, enrollments,
  deadlines and grades). `courses` hold the reusable identity; `course_versions` hold
  content. An offering points at exactly one version.
- **Versioning**: published versions are immutable (trigger `guard_course_version`).
  Editing creates a new draft version (`create_course_draft`, copying modules/lessons
  with the same `lineage_id`). Staff explicitly adopt a published version per offering
  (`adopt_course_version`). Progress and prerequisites key on `lineage_id`, so they survive
  version changes, and old offerings keep their historical version.
- **Roles**: `platform_role_grants` (platform_admin, coordinator), `coordinator_scopes`
  (coordinator ↔ cohort), `staff_assignments` (instructor or TA per offering, with
  explicit TA flags), `enrollments` (learner per offering), `cohort_participation`,
  `community_members` (optional communities never grant course access).
- **Learning**: `modules`, `lessons`, `content_assets`, `lesson_assets`,
  `prerequisite_rules` (lesson completion, minimum released quiz score, scheduled release),
  `prerequisite_overrides` (audited), `lesson_progress`, `completion_snapshots`.
- **Assessment**: `quizzes` → `quiz_versions` → `questions` (learner-safe content only);
  correct answers live in `private.answer_keys`, which no API role can read.
  `quiz_attempts` store the snapshot, question/choice order, server start and deadline;
  `attempt_answers` store saved answers; `private.attempt_results` hold scoring.
  `assignments`, `submissions`, `submission_versions` (every submit is kept).
- **Grades**: `grade_items` (one per assignment/quiz, plus manual and participation
  items), `grades` (the staff working copy) and `released_grades` (what learners can read,
  written only by publication). Unpublished grades are never in a table learners can read.
- **Communication**: `threads`, `thread_participants`, `messages`, `announcements` (+
  revisions), `discussion_topics`, `discussion_posts` (+ revisions), `notifications`,
  `notification_preferences`, `notification_outbox` (reserved for optional email; unused).
- **Operations**: `audit_events`, `platform_settings`, `upload_limits`,
  `private.rate_limits` (database-backed rate limiting; no in-process state).

## Security design

- **RLS everywhere**: all `public` tables have RLS enabled; `anon` has no table access;
  `authenticated` gets `select` plus narrowly granted columns for writes. Policies call
  `private.*` `SECURITY DEFINER` helpers with an empty `search_path` that only answer
  questions about `auth.uid()` (for example `has_staff_perm(offering, 'grade')`).
- **RPCs for sensitive workflows**: quiz attempts, scoring, grading, grade publication,
  invitations, uploads and messaging run in `SECURITY DEFINER` functions that check
  permission, validate input, lock rows where needed, and write audit events.
- **Assessment integrity**: answer keys are in the `private` schema; scoring is
  server-side; the effective deadline is `min(start + time limit (+ accommodation),
  effective close)`; expired attempts are finalized lazily on access
  (`finalize_expired`), so no background worker is required for correctness.
- **Files**: uploads are registered first (`register_upload` checks purpose, type, size
  and permission and creates an opaque path), uploaded directly to private storage with the
  user's session (resumable TUS above 6 MB), then verified on the server (stored size and
  leading-byte signature) before the asset becomes `ready`. Storage policies allow reading
  an object only when `can_read_asset` allows its database record, which follows the parent
  record: released and unlocked lesson, submission owner or grader, thread participant.
  Downloads go through `/api/assets/<id>`, which re-checks access and redirects to a signed
  URL valid for 5 minutes. A signed URL is a bearer link until it expires; this is access
  control, not DRM.
- **Rich text**: authors write Markdown; the server converts it to HTML and sanitizes it
  with an allowlist (`src/lib/sanitize.ts`) before storage and again when rendering. Only
  https and mailto links survive; no images, iframes, scripts or inline styles. Embedded
  video is stored as provider + id for an allowlist (YouTube no-cookie, Vimeo), never as
  raw iframe HTML.
- **Headers**: CSP with a per-request nonce and `strict-dynamic`, `frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, `nosniff`, HSTS, COOP, a restrictive Permissions-Policy, and no
  `X-Powered-By`.
- **Redirects**: post-login and notification redirects accept same-origin relative paths
  only (`src/lib/safe-redirect.ts`).
- **CSRF**: Server Actions use Next.js origin checks; route handlers that change state are
  not exposed as GET.
- **Rate limits** (database-backed, per user per hour): upload registrations 120, new
  message threads 30, messages 120, discussion posts 60, quiz attempt starts 30, catalog
  access requests 10. Supabase Auth applies its own sign-in, recovery and email limits.

## Notifications

Database triggers and RPCs create in-app notifications with a per-user `dedupe_key`
(unique), honoring per-kind preferences. Time-based items (scheduled announcements) are
materialized when the user next loads Activity (`materialize_my_notifications`), using
server time, so they appear on time without a background worker. Unpublished grades never
produce learner notifications; publication does. Course notification email is not
implemented; the outbox table is reserved for it.

## Time

All timestamps are stored as UTC (`timestamptz`). Offerings and events keep an IANA
timezone. Pages render in the viewer's profile timezone with an explicit zone label, plus
the course-time reference where the zones differ (`src/lib/time.ts`). Date inputs carry the
zone they were entered in (`DateTimeField` + `dateTime()`), so a learner who changes
timezone never moves a deadline. `due_at`, `available_from` and `closes_at` are separate
columns, and the server compares them with database time.

## Internationalization

Interface strings live in per-area dictionaries under `src/i18n/messages/` and are read
with `t(key, vars)`. English is the default and only complete locale; a Vietnamese
dictionary can be added with the same keys. Course content and user data are never
machine-translated. Search and sorting use locale-aware comparison, so Vietnamese names
work as entered.

## Repository layout

```
src/app/(auth)/          sign-in, password reset (public)
src/app/(app)/           authenticated application (and public help/legal/catalog pages)
src/app/api/             route handlers: health, asset downloads, exports, polling, .ics
src/app/actions/         server actions, one file per area
src/components/          UI primitives (ui/), layout, and per-area components
src/lib/                 auth, Supabase clients, data access, domain logic, time, i18n
supabase/migrations/     schema, RLS, functions (applied in order)
scripts/                 seed (sample data), admin bootstrap, maintenance
tests/db|unit|e2e        database/RLS tests, unit tests, browser tests
docs/                    engineering documentation (this folder)
```
