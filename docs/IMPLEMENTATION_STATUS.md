# Implementation status

The feature checklist for the launch scope (brief sections 06–13), with the state of each
item and the evidence behind it. Update this file in the same commit as the work it
describes, so a new session can resume from it. Acceptance tests AC01–AC17 and their
evidence are in [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md); where to pick up is in
[HANDOFF.md](HANDOFF.md).

**Last updated:** 2026-10-05, during the build, before the feature areas were merged.

Status words:

- **Done**: implemented on the branch; the evidence column names the automated test or check.
- **Partial**: works, with the gap stated.
- **In progress**: being built in the working tree; not yet committed to the branch.
- **Blocked**: needs something only the owner can provide (listed in [ASSUMPTIONS.md](ASSUMPTIONS.md)).
- **Deferred**: outside the launch scope by the brief; not shown in navigation.

## Delivery state

| Deliverable | Implemented locally | Tested locally | Pushed | Staging | Production |
|---|---|---|---|---|---|
| Database schema, row-level security, storage policies, seed | Yes | Yes (`npm run test:db`) | Yes | No | No |
| Sign-in, sign-out, password reset, app shell, Activity, Courses | Yes | Yes (`tests/e2e/foundation.spec.ts`) | Yes | No | No |
| Operator commands (admin bootstrap, backup, restore, orphan cleanup) | Yes | Yes (restore drill) | Yes | No | No |
| CI (lint, types, unit, audit, database, build, browser tests) | Yes | Yes (GitHub Actions) | Yes | n/a | n/a |
| Docker files for the Hostinger VPS route | Yes | Yes (local image run) | Yes | No | No |
| Course workspace, content, authoring, uploads, video | In progress | | | | |
| Quizzes and assignments | In progress | | | | |
| Grades and calendar | In progress | | | | |
| Messages, announcements, discussions, cohorts | In progress | | | | |
| Administration | In progress | | | | |
| Catalog, profile, tools, help, legal pages, invitation acceptance | In progress | | | | |
| Hostinger deployment | No | No | n/a | **Blocked** | **Blocked** |

Deployment is blocked on access the build environment does not have: a Hostinger account
or plan, a hosted Supabase project, a verified email sender and a domain (see
[ASSUMPTIONS.md](ASSUMPTIONS.md) and [HOSTINGER_DEPLOYMENT.md](HOSTINGER_DEPLOYMENT.md)).

## 06. Accounts, access and roles

| Feature | Status | Evidence |
|---|---|---|
| Invitation-based enrollment (send, accept, expired or used invitation) | In progress | Invitation table, rate limit and email trigger are in the schema |
| Email verification before access | Done | Supabase Auth with confirmations on; `private.my_verified_email()` |
| Sign in, sign out, generic error on wrong password | Done | `tests/e2e/foundation.spec.ts` |
| Password reset (request, link, new password rules) | Done | `/forgot-password`, `/reset-password`; rules enforced by Supabase Auth (`supabase/config.toml`) and `src/app/actions/auth.ts` |
| Protected deep links return after sign-in | Done | `tests/e2e/foundation.spec.ts` |
| Session expiry and refresh | Done | `@supabase/ssr` cookie sessions refreshed in `src/proxy.ts` |
| Access-denied and not-found views | Done | `src/app/(app)/not-found.tsx`, `src/app/not-found.tsx` |
| A Registered Online Account alone grants no course access | Done | `tests/db/access-isolation.test.ts` ("cannot read an offering they are not enrolled in") |
| Profile: name, avatar, locale, time zone | In progress | |
| No email or private fields in participant directories | Done | `tests/db/access-isolation.test.ts` ("profiles expose no email") |
| Roles scoped per offering and cohort; no global role switch | Done | `tests/db/access-isolation.test.ts` (mixed role, TA, coordinator) |
| Teaching assistant permissions explicit; cannot publish grades by default | Done | `tests/db/access-isolation.test.ts` ("TA can grade but not publish") |
| Coordinator scoped to assigned cohorts | Done | `tests/db/access-isolation.test.ts` ("coordinator of the spring cohort…") |
| Permission matrix | Done | [PERMISSIONS.md](PERMISSIONS.md) |
| Staff preview is read-only and labeled; no impersonation | In progress | |
| First administrator by server-side command against a verified user ID | Done | `npm run admin:bootstrap` (`scripts/bootstrap-admin.ts`) |
| No default production passwords or public demo accounts | Done | Seed refuses `APP_ENV=production`; sample password comes from `SEED_PASSWORD` |

## 07. Learning structure and content authoring

| Feature | Status | Evidence |
|---|---|---|
| Course, immutable published version, offering per cohort | Done (schema) | Migrations `…000100`, `…000300`; UI in progress |
| Separate submissions, deadlines, messages and grades per offering | Done (schema) | Every record carries its offering; `tests/db/access-isolation.test.ts` |
| Draft version, publish, adopt per offering | In progress | |
| Create, duplicate, edit, archive and publish courses; modules; reorder lessons; preview | In progress | |
| Archiving keeps grades and attempts | Done (schema) | No cascading deletes from lessons or courses to grades or attempts |
| Assessment definitions versioned; each attempt keeps its version | Done (schema) | `quiz_versions`; `tests/db/quiz-integrity.test.ts` |
| Course Overview, Content outline, lesson viewer | In progress | |
| Content types: rich text, PDF, documents, images, text and code files, links, video, approved embeds | In progress | Upload type and signature checks in `src/lib/uploads/` (`tests/unit/lib/uploads.test.ts`) |
| Uploads: authorized start, limits, progress, cancel, retry, opaque paths, private storage, record committed after upload | Partial | Shared uploader and storage policies done; `tests/db/learning-grades-comms.test.ts` (uploads); authoring screens in progress |
| HTML, SVG, executables and archives rejected | Done | `src/lib/uploads/`; `tests/unit/lib/uploads.test.ts`; `tests/db/learning-grades-comms.test.ts` (uploads) |
| Quarantine while a scan is pending | Partial | `UPLOAD_SCAN_MODE=quarantine` holds uploads for review; no scanner service is configured |
| Orphan cleanup | Done | `npm run maintenance:orphans` |
| Attachments inherit the parent record's permissions, enforced in storage | Done | `private.can_read_object`; `tests/db/learning-grades-comms.test.ts` ("submission file is private") |
| Video play, seek, speed, resume, captions | In progress | |
| Prerequisites: completion, minimum released quiz score, scheduled release; server and file-link enforcement; cycles rejected; audited override | Done (database) | `tests/db/learning-grades-comms.test.ts` (prerequisites); screens in progress |
| Progress: lesson and module completion, last position, required-item course progress | Done (database) | `tests/db/learning-grades-comms.test.ts`; Continue learning on Activity |

## 08. Courses, cohorts, Activity and calendar

| Feature | Status | Evidence |
|---|---|---|
| Courses list and grid with saved preference, search, filters, favorites, count, pagination, grouping, More info | Done | `src/app/(app)/courses/page.tsx`; `tests/e2e/foundation.spec.ts` |
| Course Catalog with enrolled, request access and not-open states; reviewable requests | In progress | `public.catalog_list()` projection done and tested |
| Cohorts and communities (directory, staff, offerings, roster, announcements, discussions) | In progress | Community membership never unlocks a course: `tests/db/learning-grades-comms.test.ts` |
| Activity: greeting, course cards, deadlines, Continue learning, filtered stream, read state | Done | `src/app/(app)/activity/page.tsx`; `tests/e2e/foundation.spec.ts` |
| Unpublished grades never notify learners | Done | `tests/db/learning-grades-comms.test.ts` (grades and publication) |
| Notification preferences | In progress | |
| Calendar month, week and list; filters; staff events; meeting links; per-event .ics | In progress | |
| UTC storage, IANA time zones, New York and Ho Chi Minh display including DST | Partial | `src/lib/time.ts`; `tests/unit/lib/time.test.ts` covers both zones and the 2026-11-01 change; calendar screens in progress |

## 09. Quizzes and assessment integrity

| Feature | Status | Evidence |
|---|---|---|
| Authoring, draft, publish, versioning, preview, ordering | In progress | |
| Single choice, multiple select, true/false, short answer | Done (database) | `tests/db/quiz-integrity.test.ts` |
| Attempt state persisted; no duplicate attempts from double clicks or two tabs; idempotent submit | Done (database) | `tests/db/quiz-integrity.test.ts` (attempt creation) |
| Server deadline, closing-time truncation, accommodations, lazy finalization | Done (database) | `tests/db/quiz-integrity.test.ts` (server-side timing) |
| Answer keys in a schema no client can read; payload carries no answers | Done | `private.answer_keys`; `tests/db/quiz-integrity.test.ts` (answer confidentiality) |
| Multiple select all-or-nothing, never negative; idempotent regrading | Done | `tests/db/quiz-integrity.test.ts` |
| Taking a quiz with autosave status and resume; grading queue for short answers | In progress | |

## 10. Assignments, grading and feedback

| Feature | Status | Evidence |
|---|---|---|
| Assignment authoring, submission (text, files, link), drafts, receipts, versions, return for revision | In progress | |
| Learners see only their own released grades | Done | `tests/db/access-isolation.test.ts`; `tests/db/learning-grades-comms.test.ts` |
| Gradebook: grading queue, filters, bulk publication with summary, export, audit | In progress | |
| Documented points-based calculation; missing, exempt, zero, ungraded and unreleased distinguished; "No released grades" | In progress | `src/lib/domain/grades.ts` |
| CSV exports neutralize formulas | In progress | |

## 11. Messages, discussions, announcements and tools

| Feature | Status | Evidence |
|---|---|---|
| Messages grouped by course and cohort, scoped recipients, threads, unread counts, large-send confirmation | Partial | Database rules: `tests/db/learning-grades-comms.test.ts` (communication scope); screens in progress |
| Announcements: draft, schedule, pin, edit history, scope | Partial | Scheduled visibility by server time: `tests/db/learning-grades-comms.test.ts`; screens in progress |
| Discussions: topics, replies, edit history, moderation, sanitization | In progress | Rich text sanitizer `src/lib/sanitize.ts` (unit tested) |
| In-app notifications | Done (database) | `public.notifications`; grade publication test above |
| Transactional email for authentication in production | **Blocked** | Needs a verified sender; local email goes to Mailpit only |
| Tools resource directory and Help | In progress | |
| Missing support address shown as a setup item | In progress | |

## 12. Administration, data model and operations

| Feature | Status | Evidence |
|---|---|---|
| Users, roles, invitations, cohorts, offerings, enrollments, access requests, audit review, completion reports | In progress | |
| CSV enrollment import with template, dry run, row errors, separate invitation confirmation | In progress | |
| Suspension and withdrawal take effect on the next request | Done | `tests/db/access-isolation.test.ts` (revocation) |
| Foreign keys, unique and check constraints, indexes, migrations in source control | Done | `supabase/migrations/` |
| Row-level security on every table; definer functions pin search_path; private schema not exposed | Done | `tests/db/schema-invariants.test.ts` |
| Rate limits for sign-in, password reset, invitations, messages and quiz starts | Partial | Sign-in and reset: Supabase Auth limits (`[auth.rate_limit]` in `supabase/config.toml`); others use `private.rate_limits`, being wired in |
| Security headers, no shared caching of private pages | Done | Nonce-based CSP and `Cache-Control: private, no-store` in `src/proxy.ts`; other headers in `next.config.ts` |
| Audit events for sensitive actions; audit access restricted to administrators | Partial | `public.audit_events`; prerequisite override and admin bootstrap audited; other areas in progress |
| Backups of database and files, with a tested restore | Done | [OPERATIONS.md](OPERATIONS.md) "Backups and restore"; drill recorded in [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md) AC17 |

## 13. Sample data and launch boundary

| Feature | Status | Evidence |
|---|---|---|
| Isolated, repeatable synthetic seed (1 admin, 2 instructors, 1 TA, 12 participants, 2 cohorts, 3 sample courses) | Done | `npm run seed`; refuses production |
| Ongoing, upcoming and archived examples; reused course in two offerings; mixed-role person | Done | `scripts/seed.ts` |
| Draft and released material, prerequisite sequence, PDF and text assets, playable video, quiz, assignment, published and unpublished grades, discussion, announcement and messages | Done | `scripts/seed.ts` |
| Deferred features absent from navigation | Done | Navigation in `src/components/layout/sidebar.tsx` |
| Completion records | Done (database) | `completion_snapshots` |
| Certificates | Deferred | Optional later feature |

## Known gaps

- Hostinger deployment, production email and a hosted Supabase project are blocked on
  owner access (see above).
- The interface is English only; the dictionary structure is ready for a Vietnamese one.
- No malware scanner is configured; quarantine mode is available.
