# Implementation status

The feature checklist for the launch scope (brief sections 06–13), with the state of each
item and the evidence behind it. Update this file in the same commit as the work it
describes, so a new session can resume from it. Acceptance tests AC01–AC17 and their
evidence are in [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md); where to pick up is in
[HANDOFF.md](HANDOFF.md).

**Last updated:** 2026-10-05, final build state. Every feature area is implemented and
committed on `feat/global-cohort-lms`; nothing is deployed.

Status words:

- **Done**: implemented on the branch; the evidence column names the automated test or check.
- **Partial**: works, with the gap stated.
- **Blocked**: needs something only the owner can provide (listed in [ASSUMPTIONS.md](ASSUMPTIONS.md)).
- **Deferred**: outside the launch scope by the brief; not shown in navigation.

Test titles below are quoted from the test files. Browser tests are in `tests/e2e/`,
database tests in `tests/db/`, unit tests in `tests/unit/`.

## Delivery state

| Deliverable | Implemented locally | Tested locally | Pushed | Staging | Production |
|---|---|---|---|---|---|
| Database schema, row-level security, storage policies, seed | Yes | Yes (`npm run test:db`; `tests/db/schema-invariants.test.ts`) | Yes | No | No |
| Sign-in, sign-out, password reset, app shell, Activity, Courses | Yes | Yes (`tests/e2e/foundation.spec.ts`, `tests/e2e/keyboard.spec.ts`) | Yes | No | No |
| Operator commands (admin bootstrap, backup, restore, orphan cleanup) | Yes | Yes (restore drill, [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md) AC17) | Yes | No | No |
| CI (lint, types, unit, audit, database, build, browser tests) | Yes | Yes (GitHub Actions, `.github/workflows/ci.yml`) | Yes | n/a | n/a |
| Docker files for the Hostinger VPS route | Yes | Yes (local image run, AC01) | Yes | No | No |
| Course workspace, content, authoring, uploads, video | Yes | Yes (`tests/e2e/learning.spec.ts`) | Yes | No | No |
| Quizzes and assignments | Yes | Yes (`tests/e2e/assessment.spec.ts`) | Yes | No | No |
| Grades and calendar | Yes | Yes (`tests/e2e/grades-calendar.spec.ts`) | Yes | No | No |
| Messages, announcements, discussions, cohorts, communities | Yes | Yes (`tests/e2e/comms.spec.ts`) | Yes | No | No |
| Administration, including Administration → Communities | Yes | Yes (`tests/e2e/admin.spec.ts`, `tests/e2e/communities-admin.spec.ts`) | Yes | No | No |
| Catalog, profile, tools, help, legal pages, invitation acceptance | Yes | Yes (`tests/e2e/account.spec.ts`) | Yes | No | No |
| End-to-end owner walkthrough across all areas | Yes | Yes (`tests/e2e/walkthrough.spec.ts`) | Yes | No | No |
| Hostinger deployment | No | No | n/a | **Blocked** | **Blocked** |

Deployment is blocked on access the build environment does not have: a Hostinger account
or plan, a hosted Supabase project, a verified email sender and a domain (see
[ASSUMPTIONS.md](ASSUMPTIONS.md) and [HOSTINGER_DEPLOYMENT.md](HOSTINGER_DEPLOYMENT.md)).

## 06. Accounts, access and roles

| Feature | Status | Evidence |
|---|---|---|
| Invitation-based enrollment (send, accept, expired or used invitation) | Done | `admin.spec.ts` "an invitation email arrives once with a link to this app, and revoking it switches the link off"; `account.spec.ts` "participant12 sees truthful expired, revoked, wrong-account and accepted states"; `walkthrough.spec.ts` step 1 |
| Email verification before access | Done | Supabase Auth with confirmations on; `private.my_verified_email()` |
| Sign in, sign out, generic error on wrong password | Done | `foundation.spec.ts` "wrong password shows a generic error and no session"; sign-out in `walkthrough.spec.ts` step 7 |
| Password reset (request, link, new password rules) | Done | `/forgot-password`, `/reset-password`; rules in `supabase/config.toml` and `src/app/actions/auth.ts`; `tests/unit/lib/password.test.ts` "accepts 10 to 200 characters with a letter and a digit" |
| Protected deep links return after sign-in | Done | `foundation.spec.ts` "a signed-out deep link goes to sign-in and returns afterwards"; `tests/unit/lib/safe-redirect.test.ts` |
| Session expiry and refresh | Done | `@supabase/ssr` cookie sessions refreshed in `src/proxy.ts` |
| Access-denied and not-found views | Done | `learning.spec.ts` "people outside the offering, and learners on staff pages, get Page not available"; `admin.spec.ts` "people without an administration role get Page not available, and the admin APIs answer 404" |
| A Registered Online Account alone grants no course access | Done | `tests/db/access-isolation.test.ts` "a learner cannot read an offering they are not enrolled in" |
| Profile: name, avatar, locale, time zone | Done | `account.spec.ts` "participant11 saves a Vietnamese display name and time zone, sees both after reload, then restores them"; `tests/unit/account/profile.test.ts`. Locale is saved, but the interface is English only (see Known gaps) |
| No email or private fields in participant directories | Done | `tests/db/access-isolation.test.ts` "profiles expose no email and only to people who share a scope"; `comms.spec.ts` "a participant sees their cohort and a names-only roster; communities are joined and left apart from enrollment" |
| Roles scoped per offering and cohort; no global role switch | Done | `tests/db/access-isolation.test.ts` "sees MASS working grades and roster but no AAF working grades", "altered offeringId in an RPC does not escalate" |
| Teaching assistant permissions explicit; cannot publish grades by default | Done | `tests/db/access-isolation.test.ts` "TA can grade but not publish grades"; `grades-calendar.spec.ts` "a teaching assistant can enter grades but cannot publish (interface and database)" |
| Coordinator scoped to assigned cohorts | Done | `tests/db/access-isolation.test.ts` "coordinator of the spring cohort cannot administer the fall cohort"; `admin.spec.ts` "a cohort coordinator manages only their own cohort" |
| Permission matrix | Done | [PERMISSIONS.md](PERMISSIONS.md) |
| Staff preview is read-only and labeled; no impersonation | Done | `learning.spec.ts` "an instructor builds a module with a reading, a PDF and a captioned video, reorders, previews, publishes and releases it" (checks the read-only preview note) |
| First administrator by server-side command against a verified user ID | Done | `npm run admin:bootstrap` (`scripts/bootstrap-admin.ts`) |
| No default production passwords or public demo accounts | Done | Seed refuses `APP_ENV=production`; sample password comes from `SEED_PASSWORD` |

## 07. Learning structure and content authoring

| Feature | Status | Evidence |
|---|---|---|
| Course, immutable published version, offering per cohort | Done | Migrations `…000100`, `…000300`; `admin.spec.ts` "an administrator creates a cohort and an offering, then releases the offering"; `tests/db/sample-flag.test.ts` "cohorts, courses and offerings created outside a sample account are real records" |
| Separate submissions, deadlines, messages and grades per offering | Done | Every record carries its offering; `tests/db/access-isolation.test.ts` "B cannot read A" |
| Draft version, publish, adopt per offering | Done | `learning.spec.ts` "an instructor builds a module … publishes and releases it"; `walkthrough.spec.ts` step 2 "publish the draft and release the offering"; adopt control on the administration offering page (`adoptOfferingVersion`) |
| Create, duplicate, edit, archive and publish courses; modules; reorder lessons; preview | Done | `admin.spec.ts` "courses are created with a draft, renamed, duplicated and archived (never deleted)"; `learning.spec.ts` (reorders, previews); `tests/unit/learning/helpers.test.ts` "moves one step and reports which positions changed" |
| Archiving keeps grades and attempts | Done | No cascading deletes from lessons or courses to grades or attempts (`on delete restrict`) |
| Assessment definitions versioned; each attempt keeps its version | Done | `quiz_versions`; `tests/db/quiz-integrity.test.ts` |
| Course Overview, Content outline, lesson viewer | Done | `learning.spec.ts` "learners see released lessons; a locked lesson and its files are refused until the prerequisite is complete"; `tests/unit/learning/outline.test.ts` |
| Content types: rich text, PDF, documents, images, text and code files, links, video, approved embeds | Done | `learning.spec.ts` (reading, PDF, captioned video); `tests/unit/learning/embed.test.ts` "rejects other providers, plain http, raw iframe markup and links without an id"; `tests/unit/lib/uploads.test.ts` |
| Uploads: authorized start, limits, progress, cancel, retry, opaque paths, private storage, record committed after upload | Done | `tests/db/learning-grades-comms.test.ts` "rejects disallowed types and oversize files before upload"; shared uploader `src/components/uploads/file-uploader.tsx` |
| HTML, SVG, executables and archives rejected | Done | `tests/unit/lib/uploads.test.ts` "rejects types that are never accepted", "rejects a file whose bytes do not match its declared type" |
| Quarantine while a scan is pending | Partial | `admin.spec.ts` "quarantined uploads are downloaded for review, then released or rejected". Gap: no malware scanner is connected; review is manual |
| Orphan cleanup | Done | `npm run maintenance:orphans` (`scripts/cleanup-orphans.ts`) |
| Attachments inherit the parent record's permissions, enforced in storage | Done | `tests/db/learning-grades-comms.test.ts` "a learner's submission file is private even within the same course" |
| Video play, seek, speed, resume, captions | Done | `learning.spec.ts` (captioned video); `tests/unit/learning/completion.test.ts` "resumes from the saved position unless it is at the very end", "formats clock times and validates speeds" |
| Prerequisites: completion, minimum released quiz score, scheduled release; server and file-link enforcement; cycles rejected; audited override | Done | `tests/db/learning-grades-comms.test.ts` "a locked lesson, its API and its file link stay closed until the rule is met", "rejects cyclic prerequisite rules", "staff override unlocks with an audit entry; learners cannot self-override"; `learning.spec.ts` "staff follow progress on People; an override opens a lesson until it is revoked; new conditions never remove progress" |
| Progress: lesson and module completion, last position, required-item course progress | Done | `tests/db/learning-grades-comms.test.ts` "optional items do not block completion and progress persists", "video lessons with a playback rule need 90% of the duration" |

## 08. Courses, cohorts, Activity and calendar

| Feature | Status | Evidence |
|---|---|---|
| Courses list and grid with saved preference, search, filters, favorites, count, pagination, grouping, More info | Done | `foundation.spec.ts` "learner lands on Activity and can open Courses"; `keyboard.spec.ts` "sign in, open and close the menu, expand More info, with a visible focus ring"; `walkthrough.spec.ts` step 7 "course search and filter", "favorite toggle persists after reload" |
| Course Catalog with enrolled, request access and not-open states; reviewable requests | Done | `account.spec.ts` "participant11 requests access, sees it pending, cannot request twice, and withdraws"; `admin.spec.ts` "access requests are approved (enrolling the person) or declined with a note"; `tests/unit/account/catalog.test.ts` |
| Cohorts and communities (directory, staff, offerings, roster, announcements, discussions) | Done | `comms.spec.ts` "a participant sees their cohort and a names-only roster; communities are joined and left apart from enrollment"; `tests/db/communities-admin.test.ts` "a member of a program-wide or cohort community gains no cohort, offering or enrollment" |
| Community management (Administration → Communities) | Done | `communities-admin.spec.ts` "a platform administrator creates an invitation-only community and adds and removes a member", "a cohort coordinator manages only their cohort"; `tests/db/communities-admin.test.ts` "creates and edits a community in their own cohort only", "cannot add other people, or themselves to an invitation-only community" |
| Activity: greeting, course cards, deadlines, Continue learning, filtered stream, read state | Done | `foundation.spec.ts` "learner lands on Activity and can open Courses"; `grades-calendar.spec.ts` "publishing releases exactly that grade; the learner opens it from Activity; others see nothing" |
| Unpublished grades never notify learners | Done | `tests/db/learning-grades-comms.test.ts` "a learner sees no draft grade; publication reveals exactly that result and notifies" |
| Notification preferences | Partial | In-app preferences per kind on the profile page (`src/app/actions/profile.ts`). Gap: no email notifications for course activity (in-app only); no browser test covers the preference form |
| Calendar month, week and list; filters; staff events; meeting links; per-event .ics | Partial | `grades-calendar.spec.ts` "staff add a course event; month, week and list show it; the .ics has the right UTC times", "editing, cancelling and restoring update the event and its .ics; delete removes it"; `tests/unit/calendar/ics.test.ts`. Gap: an event that spans several days is shown on its start day only (`groupByDay` in `src/lib/calendar/items.ts`) |
| UTC storage, IANA time zones, New York and Ho Chi Minh display including DST | Done | `tests/unit/calendar/calendar.test.ts` "shifts only the Ho Chi Minh display after New York's DST change (Nov 1, 2026)"; `tests/unit/lib/time.test.ts`; `grades-calendar.spec.ts` "a learner sees the event in their own time zone; outsiders cannot download it" |

## 09. Quizzes and assessment integrity

| Feature | Status | Evidence |
|---|---|---|
| Authoring, draft, publish, versioning, preview, ordering | Done | `assessment.spec.ts` "an instructor builds, previews and publishes a quiz with every question type" |
| Single choice, multiple select, true/false, short answer | Done | `assessment.spec.ts` (every question type); `tests/unit/assessment/quiz.test.ts` "scores single choice and true/false by exact match" |
| Attempt state persisted; no duplicate attempts from double clicks or two tabs; idempotent submit | Done | `tests/db/quiz-integrity.test.ts` "double click and parallel tabs never create extra attempts", "attempt limit is enforced after submission and duplicate submits are idempotent" |
| Server deadline, closing-time truncation, accommodations, lazy finalization | Done | `tests/db/quiz-integrity.test.ts` "answers after the server deadline are rejected and the attempt is finalized with saved answers", "an unsubmitted attempt is finalized lazily when the learner returns after closing the tab", "deadline is the earlier of time limit and closing time; accommodations extend only granted limits" |
| Answer keys in a schema no client can read; payload carries no answers | Done | `tests/db/quiz-integrity.test.ts` "learner cannot read questions, keys or explanations directly", "the attempt payload carries no correct answers or explanations" |
| Multiple select all-or-nothing, never negative; idempotent regrading | Done | `tests/db/quiz-integrity.test.ts` "multiple select is all-or-nothing and never negative", "re-grading is idempotent" |
| Taking a quiz with autosave status and resume; grading queue for short answers | Done | `assessment.spec.ts` "a learner takes the quiz: autosave, restore on reload, no answer keys in the browser, one attempt at a time", "staff grade the short answer; the TA can grade but not author; learners cannot open others" |

## 10. Assignments, grading and feedback

| Feature | Status | Evidence |
|---|---|---|
| Assignment authoring, submission (text, files, link), drafts, receipts, versions, return for revision | Done | `assessment.spec.ts` "an instructor creates an assignment with a rubric", "a learner submits and resubmits with timestamped receipts; a lost response never creates a second version", "staff work the grading queue, return work for revision, grade with the rubric and publish; others see nothing" |
| Learners see only their own released grades | Done | `tests/db/access-isolation.test.ts` "learners never read staff working grades"; `walkthrough.spec.ts` step 6 "learner B cannot see learner A" |
| Gradebook: grading queue, filters, bulk publication with summary, export, audit | Done | `grades-calendar.spec.ts` "publishing releases exactly that grade; the learner opens it from Activity; others see nothing" (checks the publication summary); `tests/unit/grades/grades.test.ts` "filters cells by status" |
| Documented points-based calculation; missing, exempt, zero, ungraded and unreleased distinguished; "No released grades" | Done | `tests/unit/grades/grades.test.ts` "includes graded (even zero) and missing items; excludes exempt, ungraded, pending, uncounted and hidden", "returns no percentage (never a fabricated 0%) when nothing is in the denominator" |
| Grade items hidden instead of deleted | Done | `grades-calendar.spec.ts` "hiding an item takes it out of learners' grades; graded items keep their max points". Grades and grade items with grades are never deleted (`on delete restrict`, no delete policy on `grades`) |
| CSV exports neutralize formulas | Done | `grades-calendar.spec.ts` "the gradebook CSV export has names and grades only, with formulas neutralized"; `tests/unit/admin/reports-settings.test.ts` "neutralizes names that a spreadsheet would run as formulas" |

## 11. Messages, discussions, announcements and tools

| Feature | Status | Evidence |
|---|---|---|
| Messages grouped by course and cohort, scoped recipients, threads, unread counts, large-send confirmation | Partial | `comms.spec.ts` "a learner messages an instructor in a course, the instructor reads and replies, outsiders see nothing", "messages to more than ten people need an explicit confirmation", "the polling endpoint answers only for the signed-in user"; `tests/db/learning-grades-comms.test.ts` "recipient picker and thread creation are limited to the scope". Gap: a thread page shows the latest 200 messages (`MESSAGE_LIMIT` in `src/app/(app)/messages/[threadId]/page.tsx`) |
| Announcements: draft, schedule, pin, edit history, scope | Done | `comms.spec.ts` "staff schedule, publish, pin, edit and archive; learners see an announcement only once it is released", "a cohort administrator publishes to the cohort; participants read it at its anchor but cannot manage it"; `tests/db/learning-grades-comms.test.ts` "scheduled announcements stay hidden until server time passes" |
| Discussions: topics, replies, edit history, moderation, sanitization | Partial | `comms.spec.ts` "course discussion: inert markup, replies, edit history, hiding with a reason, pin and lock"; `tests/unit/lib/sanitize.test.ts`. Gap: discussion posts have no idempotency key, so a resent form can create a duplicate post (messages and submissions have one) |
| In-app notifications | Done | `public.notifications`; `tests/db/learning-grades-comms.test.ts` "a learner sees no draft grade; publication reveals exactly that result and notifies" |
| Transactional email for authentication in production | **Blocked** | Needs a verified sender; local email goes to Mailpit only |
| Tools resource directory and Help | Done | `account.spec.ts` "staff manage a course resource; learners see it only while published and cannot create one", "a signed-out visitor sees the public catalog, Help and the policy drafts"; `tests/unit/account/tools.test.ts` |
| Missing support address shown as a setup item | Done | Help shows "Support contact details have not been configured yet" until set in Administration → Settings; `admin.spec.ts` "settings are validated, saved and shown; upload types can be allowed and removed"; `tests/unit/account/text.test.ts` "accepts plausible emails only" |
| Policy pages (privacy, terms, accessibility) | Partial | `account.spec.ts` "a signed-out visitor sees the public catalog, Help and the policy drafts". Gap: the pages are labeled drafts; no legal review |

## 12. Administration, data model and operations

| Feature | Status | Evidence |
|---|---|---|
| Users, roles, invitations, cohorts, offerings, enrollments, access requests, audit review, completion reports | Done | `admin.spec.ts` "platform administrator role is granted and removed from Users, and the audit log records it", "staff and enrollments: withdrawing an enrollment ends course access at once", "completion report and CSV export, and the audit log filters"; `tests/unit/admin/reports-settings.test.ts` |
| Offering archive rules | Done | Archiving an offering that still uses a draft course version is blocked by design; the offering page explains that a draft offering is already hidden from learners (`admin.offering.archiveUnavailable`) |
| CSV enrollment import with template, dry run, row errors, separate invitation confirmation | Done | `admin.spec.ts` "a CSV dry run lists row problems and creates nothing until confirmed"; `tests/unit/admin/csv.test.ts`, `tests/unit/admin/import.test.ts` |
| Suspension and withdrawal take effect on the next request | Done | `tests/db/access-isolation.test.ts` "withdrawn enrollment loses access without signing out", "suspended accounts lose access immediately"; `admin.spec.ts` "suspending participant10 ends access on the next request; reactivating restores it" |
| Foreign keys, unique and check constraints, indexes, migrations in source control | Done | `supabase/migrations/` |
| Row-level security on every table; definer functions pin search_path; private schema not exposed | Done | `tests/db/schema-invariants.test.ts` "every table in the public schema has row-level security enabled", "every SECURITY DEFINER function pins its search_path", "the private schema is not reachable through the Data API" |
| Rate limits for sign-in, password reset, invitations, messages and quiz starts | Done | Sign-in and reset: Supabase Auth limits (`[auth.rate_limit]` in `supabase/config.toml`); invitations, threads, messages, discussion posts, uploads, quiz starts and access requests: `private.hit_rate_limit` in the migrations; `tests/unit/lib/errors.test.ts` "maps constraint and rate-limit errors to plain language". The limits themselves are not exercised by an automated test |
| Security headers, no shared caching of private pages | Done | Nonce-based CSP and `Cache-Control: private, no-store` in `src/proxy.ts`; other headers in `next.config.ts` |
| Audit events for sensitive actions; audit access restricted to administrators | Done | `public.audit_events`; `admin.spec.ts` "completion report and CSV export, and the audit log filters"; `tests/db/learning-grades-comms.test.ts` "staff override unlocks with an audit entry; learners cannot self-override" |
| Backups of database and files, with a tested restore | Done | [OPERATIONS.md](OPERATIONS.md) "Backups and restore"; drill recorded in [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md) AC17 |
| Accessibility: automated checks, keyboard, responsive layouts | Partial | axe checks in `@responsive` specs (for example `admin.spec.ts` "administration pages fit 390, 768 and 1440 px and pass axe"); `keyboard.spec.ts`. Gap: manual screen-reader and contrast audit not done (AC14) |

## 13. Sample data and launch boundary

| Feature | Status | Evidence |
|---|---|---|
| Isolated, repeatable synthetic seed (1 admin, 2 instructors, 1 TA, 12 participants, 2 cohorts, 3 sample courses) | Done | `npm run seed`; refuses production |
| Ongoing, upcoming and archived examples; reused course in two offerings; mixed-role person | Done | `scripts/seed.ts`; `tests/db/access-isolation.test.ts` "mixed role (AC04)" tests |
| Draft and released material, prerequisite sequence, PDF and text assets, playable video, quiz, assignment, published and unpublished grades, discussion, announcement and messages | Done | `scripts/seed.ts` |
| Deferred features absent from navigation | Done | Navigation in `src/components/layout/sidebar.tsx` |
| Completion records | Done | `completion_snapshots`; `admin.spec.ts` "completion report and CSV export, and the audit log filters" |
| Interface language | Partial | `tests/unit/lib/i18n.test.ts`; `account.spec.ts` "participant11 saves a Vietnamese display name and time zone, sees both after reload, then restores them". Gap: the interface is English only; Vietnamese text is supported and the language preference is saved |
| Certificates | Deferred | Optional later feature |

## Known gaps

Each item was checked against the code on 2026-10-05.

- Hostinger deployment, production email and a hosted Supabase project are blocked on
  owner access (see above).
- The interface is English only. Vietnamese names and text are stored, searched and shown
  as entered, and a person's language preference is saved on their profile; no Vietnamese
  dictionary exists yet.
- No email notifications for course activity: notifications are in-app only (Activity).
  Only authentication emails (invitations, verification, password reset) are sent.
- No malware scanner is configured. `UPLOAD_SCAN_MODE=quarantine` holds new uploads for
  manual review in Administration → Uploads.
- The privacy, terms and accessibility pages are drafts for the owner's review; no legal
  review was done.
- The support contact is unset until an administrator configures it in Administration →
  Settings; until then Help says so.
- Calendar events that span several days are shown on their start day only.
- A message thread shows its latest 200 messages.
- Discussion posts have no idempotency key, so a resent form can create a duplicate post.
- Grades and graded items are never deleted; staff hide an item from learners instead.
- Archiving an offering that still uses a draft course version is blocked by design, with
  an explanation on the offering page.
- A manual screen-reader and contrast audit has not been done (AC14 in
  [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md)).
