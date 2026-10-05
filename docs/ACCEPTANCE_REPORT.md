# Acceptance report

Evidence for the acceptance tests AC01–AC17 of the implementation brief. Every line names
the command, test or check behind it. "Local" means the build environment described
below; nothing here was run against a hosted deployment, because none exists yet (AC16).

This report does not claim the application is production ready, secure or fully tested.
It records what was checked, how, and what was not.

## Environment and runs

| Item | Value |
|---|---|
| Date | 2026-10-05 (UTC) |
| Commit | `7b28d67` (application code and tests; this report and the screenshots were committed after the run) on `feat/global-cohort-lms` |
| Runtime | Node.js 22, Next.js 16.3.8 (production build, `npm run start`), React 19.2 |
| Database | Local Supabase stack (Postgres 17, Auth, Storage, Mailpit) via the Supabase CLI and Docker; all migrations applied by `supabase db reset`, then `npm run seed` |
| Browser | Chromium (Playwright) at 1440×900; tests tagged `@responsive` also at 768×1024 and 390×844 |
| CI | GitHub Actions workflow `.github/workflows/ci.yml` on every push to `feat/**` and on pull requests |

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | clean |
| Types | `npm run typecheck` | clean |
| Unit tests | `npm run test:unit` | 305 passed (36 files) |
| Database tests (RLS, functions, storage) | `npm run test:db` | 55 passed (6 files) |
| Production build | `npm run build` | exit 0 |
| Browser tests | `npx playwright test` | 85 passed, 0 failed (10 files; every test at 1440 px, `@responsive` tests also at 768 and 390 px; 18.0 min, 2026-10-05 07:53–08:11 UTC) |
| Dependency audit | `npm audit --omit=dev --audit-level=high` (CI and local) | 0 vulnerabilities in production dependencies |
| CI | GitHub Actions | run 37280113234 (pull request) and 37280082694 (push) on `7b28d67`: both jobs green |

Automated accessibility checks use axe-core inside the browser tests (`axe()` in the specs).
Manual checks are listed separately under AC14.

## Results

Status words: **Pass** (checked as described), **Partial** (checked with a stated gap),
**Blocked** (needs owner access).

### AC01. Fresh setup — Pass (local)

A clean checkout installs with the lockfile (`npm ci`), `supabase start` applies every
migration to an empty database, `npm run seed` loads isolated synthetic data, and type-check
and production build succeed. CI repeats this from scratch on every push (job "Database,
build and browser tests"). Locally the final state was verified with `supabase db reset`
→ `npm run seed` → all checks above. The VPS Docker image was built and run with a read-only
filesystem, dropped capabilities and a non-root user; `/api/health` answered 200 and the
foundation browser tests passed against it at all three widths (commit 3d54caf).

### AC02. Accounts — Pass (local email only)

- Invite → email → set password → accept: `admin.spec.ts` "an invitation email arrives once
  with a link to this app, and revoking it switches the link off"; `walkthrough.spec.ts`
  steps 1 (two learners invited and accepted through Mailpit).
- Expired, revoked, wrong-account and accepted invitation states: `account.spec.ts`
  "participant12 sees truthful expired, revoked, wrong-account and accepted states".
- Sign in, generic wrong-password error, sign out, protected deep links: `foundation.spec.ts`;
  sign out in `walkthrough.spec.ts` step 7.
- Password reset: `/forgot-password` and `/reset-password` use Supabase Auth recovery; the
  invitation path above uses the same set-password page. Rules (10+ characters, letters and
  digits) in `src/lib/password.ts` (`tests/unit/lib/password.test.ts`) and `supabase/config.toml`.
- No unauthenticated data and no accidental admin: `access-isolation.test.ts` "signed-out
  visitors" (no table readable, catalog projection only, privileged RPCs refused);
  `schema-invariants.test.ts` (anon can call only `catalog_list` and `public_site_settings`).
  Public sign-up is off (`enable_signup = false`); the first administrator is granted only by
  `npm run admin:bootstrap` against a confirmed user ID.
- Gap: email goes to the local Mailpit only. No production sender is configured.

### AC03. Permission isolation — Pass (local)

- Database client: `access-isolation.test.ts` "learner A vs learner B in the same offering"
  (grades, submissions, attempts, threads, profiles), "a learner cannot read an offering
  they are not enrolled in"; `quiz-integrity.test.ts` "another learner cannot fetch someone
  else's attempt or review".
- Storage link issuance: `learning-grades-comms.test.ts` "a learner's submission file is
  private even within the same course"; message attachments go through
  `private.can_read_object` (thread participants only).
- UI, direct URL and API: `walkthrough.spec.ts` step 6 (learner B gets Page not available on
  A's submission, attempt and grading pages, no thread, poll API and CSV export 404);
  `assessment.spec.ts`, `grades-calendar.spec.ts`, `comms.spec.ts` "outsiders see nothing";
  `learning.spec.ts` "people outside the offering … get Page not available".
- Export: the gradebook CSV is staff-only (`grades-calendar.spec.ts` export test; 404 for a
  learner in `walkthrough.spec.ts`).
- Cohort-scoped staff: `access-isolation.test.ts` "coordinator of the spring cohort cannot
  administer the fall cohort"; `admin.spec.ts` "a cohort coordinator manages only their own
  cohort"; `communities-admin.test.ts`.

### AC04. Mixed role and tampering — Pass (local)

`access-isolation.test.ts` "mixed role (AC04)": instructor in one offering, learner in
another; cannot author, grade or publish where they are a learner; altered `offeringId` in
an RPC does not escalate; "learners cannot change grades, roles, enrollments or other
people's records". Row-level security on every table and pinned `search_path` on every
definer function: `schema-invariants.test.ts`.

### AC05. Reference parity — Pass (local)

[REFERENCE_MAP.md](REFERENCE_MAP.md) maps each reference navigation item and control to its
route. Browser evidence: list/grid, search, filters, favorites, pagination and More info on
Courses (`foundation.spec.ts`, `walkthrough.spec.ts` step 7); current/archived grouping;
New Message (`comms.spec.ts`); grade drill-down (`grades-calendar.spec.ts` "the learner opens
it from Activity"; `walkthrough.spec.ts` step 5); Help and policy pages (`account.spec.ts`
"public pages"); Sign Out (`walkthrough.spec.ts`). Controls that depend on owner input
(support contact) say so on the page instead of linking nowhere.

### AC06. Authoring — Pass (local)

`learning.spec.ts` "an instructor builds a module with a reading, a PDF and a captioned
video, reorders, previews, publishes and releases it"; `admin.spec.ts` "courses are created
with a draft, renamed, duplicated and archived" and "an administrator creates a cohort and an
offering, then releases the offering". Visibility after reload and in a second browser
context (another device) is checked in `learning.spec.ts` and `walkthrough.spec.ts`.

### AC07. Media lifecycle — Partial

- Wrong type or size rejected before upload and verified after (size and file signature):
  `learning-grades-comms.test.ts` "rejects disallowed types and oversize files before upload";
  `tests/unit/lib/uploads.test.ts`.
- Unauthorized upload and link issuance denied: storage policies (`private.can_upload_object`,
  `private.can_read_object`) and `learning.spec.ts` (locked lesson file returns 404).
- Captions, play, seek and resume: `learning.spec.ts` "learners see released lessons …"
  (captions track, playback to 90%, resume position kept).
- Interrupted uploads: uploads above 6 MB are resumable (TUS); a failed upload can be retried
  from the uploader, and unfinished uploads are cleaned by `npm run maintenance:orphans`.
  An interrupted network transfer was not simulated in an automated test.
- Signed links: video and files are served through `/api/assets/<id>`, which checks access
  and redirects to a 5-minute signed URL. Anyone holding the URL can use it until it expires;
  this is access control, not DRM ([OPERATIONS.md](OPERATIONS.md#uploads)).
- Not done: "files remain available after a staging redeploy" needs a staging deployment
  (AC16). Files live in Supabase Storage, not on the application host, so a redeploy does not
  touch them by design.

### AC08. Prerequisites — Pass (local)

`learning-grades-comms.test.ts` "prerequisites (AC08)" (locked lesson, API and file link
closed until the rule is met; cycles rejected; audited staff override; optional items do not
block; playback rule needs 90%); `learning.spec.ts` "learners see released lessons; a locked
lesson and its files are refused…" and "staff follow progress on People; an override opens a
lesson until it is revoked".

### AC09. Quiz integrity — Pass (local)

`quiz-integrity.test.ts`: double click and parallel tabs never create extra attempts; attempt
limit and idempotent submit; answers after the server deadline rejected; lazy finalization
after a closed tab; deadline is the earlier of time limit and closing time; accommodations;
idempotent re-grading. `assessment.spec.ts` "a learner takes the quiz: autosave, restore on
reload … one attempt at a time". The countdown shown in the browser is informative; the
database decides. Offline state: the attempt page listens for the browser's offline event
and shows what was last saved (`src/components/assessment/attempt-runner.tsx`); no automated
test switches the browser offline.

### AC10. Answer confidentiality — Pass (local)

Answer keys live in `private.answer_keys` (schema not exposed: `schema-invariants.test.ts`
"the private schema is not reachable through the Data API"). `quiz-integrity.test.ts`
"learner cannot read questions, keys or explanations directly" and "the attempt payload
carries no correct answers or explanations"; `assessment.spec.ts` checks the page HTML and
network responses during an attempt for answer keys.

### AC11. Work and grades — Pass (local)

`assessment.spec.ts` "a learner submits and resubmits with timestamped receipts" and "staff
work the grading queue, return work for revision, grade with the rubric and publish";
`grades-calendar.spec.ts` grades tests (no draft grade visible, publication releases exactly
that grade, TA cannot publish, hidden items); `learning-grades-comms.test.ts` "grades and
publication (AC11)"; calculation rules in `src/lib/domain/grades.ts` with
`tests/unit` coverage of missing, exempt, zero, ungraded and unreleased items.

### AC12. Communication — Pass (local)

`learning-grades-comms.test.ts` "communication scope (AC12)"; `comms.spec.ts` messages
(scoped recipients, stored thread and reply, unread state, >10 recipients confirmation,
polling only for the signed-in user), announcements (schedule, pin, edit, archive), cohort
announcements, discussions (inert markup, edit history, hiding with a reason, pin, lock).
Rich text is sanitized (`src/lib/sanitize.ts`, unit tests). Tests send email only to
Mailpit with synthetic `@sample.crewscaler.test` addresses.

### AC13. Time zones — Pass (local)

`tests/unit/lib/time.test.ts` covers New York and Ho Chi Minh including the New York change on
2026-11-01; `tests/unit/calendar/ics.test.ts`; `grades-calendar.spec.ts` "staff add a course
event … the .ics has the right UTC times" and "a learner sees the event in their own time
zone". Deadlines are enforced by database time (`quiz-integrity.test.ts` server-side timing).

### AC14. Usability and accessibility — Partial

Automated (axe-core, WCAG 2.1 A/AA rules, inside the browser tests): Activity, Courses,
course content and lesson pages, grades and calendar, messages and discussions, account
pages, and every Administration page, at 390, 768 and 1440 px where tagged `@responsive`;
every page checked has no horizontal overflow. Result: no violations in the final run.

Keyboard: `keyboard.spec.ts` signs in, uses the navigation, opens a More info disclosure and
checks the visible focus ring with the keyboard only, at all three widths; on phone and tablet
it opens the navigation drawer, checks that focus moves into it, that Tab and Shift+Tab stay
inside it, and that Escape closes it and returns focus. Writing this test found that Tab could
leave the open drawer; that was fixed. Wide tables scroll inside a keyboard-focusable,
labelled region. Loading, empty, error and retry states are covered by the area specs
(for example the autosave and lost-response cases in `assessment.spec.ts`).

Not done: a screen-reader pass with NVDA/VoiceOver and a formal contrast audit beyond axe's
automated contrast rule. These should be done before enrolling learners who rely on them.

### AC15. Security and reliability — Pass (local, scope as stated)

- No secrets in Git or history: the branch history was scanned for key, token and
  private-key patterns (Supabase secret and publishable keys, JWTs, GitHub and cloud tokens,
  PEM blocks); none found. Only `.env.example` templates are tracked; `.env*` is ignored.
- Raw references excluded: `reference_images/` and `/private/` are git-ignored; no reference
  screenshot or record is tracked (`git ls-files` has no image outside `src/app` icons and
  `seed/assets` synthetic media).
- Unsafe rich text blocked: sanitizer unit tests; `comms.spec.ts` "inert markup".
- No cross-reading of cached pages: every private response sends
  `Cache-Control: private, no-store` (`src/proxy.ts`); pages are rendered per request.
- Revoked enrollment loses fresh access: `access-isolation.test.ts` "revocation takes effect
  on the next request (AC15)"; `admin.spec.ts` withdrawal and suspension tests.
- Failed saves never claim success: forms show server results only; `assessment.spec.ts`
  "a lost response never creates a second version".
- No production seed: `scripts/seed.ts` refuses `APP_ENV=production`.

### AC16. Deployment — Blocked

The application is not deployed and there is no URL to test. The Hostinger account's plan
(Single Web Hosting) cannot run a Node.js app, and no Hostinger access was available.

Hosted database, done 2026-10-05: the Supabase staging project `global-cohort-staging`
(Singapore) has all 18 migrations, applied by the `Database migrations` workflow
([run 37290628919](https://github.com/LeoHungNguyen158/Project-Global-Cohort/actions/runs/37290628919),
commit e397977). Its migration history lists the 18 versions with the same timestamps as
`supabase/migrations`. A fingerprint of the `public` and `private` schemas matched the
locally tested database exactly: 503 columns, 54 tables with RLS (none in `public` without
it), 92 policies including Storage, 185 functions with their bodies and settings, 215
function execute grants, 481 table grants, 61 triggers, 104 indexes, 341 constraints and
4 private buckets. The security advisor reports the expected design: one table with RLS and
no policy (`notification_outbox`, server-only), and SECURITY DEFINER RPCs that check the
caller's role inside the function (two of them, `catalog_list` and `public_site_settings`,
are callable signed out by design). No production Supabase project exists yet. The runbook is
[HOSTINGER_DEPLOYMENT.md](HOSTINGER_DEPLOYMENT.md); after deployment, run its smoke tests
(sign in, reset callback, private routes, file upload and download, quiz submission, grade
release) and record the URL, commit and date here.

### AC17. Recovery — Pass (local disposable stack; hosted staging not yet exercised)

Rehearsed on 2026-10-05 08:16–08:25 UTC after the final browser run, with the final 18
migrations, into a second, disposable local Supabase stack (`cohort-restore-drill`, its own
ports and volumes), created for the drill and deleted afterwards. The main stack was only
read.

| Step | Command | Result |
|---|---|---|
| Empty target | `supabase start` on a copy of `supabase/` | all 18 migrations applied in 39 s |
| Database backup | `supabase db dump --data-only --schema public,auth,private` | 57 tables, 570 KB, 2 s |
| File backup | `npm run backup:storage` | 15 files, 1.7 MB, SHA-256 manifest, 1 s |
| Restore check | `npm run restore:db -- --from …` | dry run; lists the one table cleared first (`upload_limits`) |
| Restore records | `… --yes` | loaded in one transaction, 1 s |
| Second load | `… --yes` again | refused: "target already has 18 account(s)" |
| Restore files | `npm run restore:storage -- --yes --verify` | 15 uploaded, 15 verified by checksum, 0 failed |
| Corrupted backup | one byte changed in a copy | refused: "backup file does not match its checksum; not uploaded", exit 1 |
| Production guard | `APP_ENV=production npm run restore:db … --replace` | refused without `--confirm-production`, exit 1 |

Row counts matched between source and restored target (users 18, enrollments 37, released
grades 16, submissions 7, quiz attempts 6, file records 14, communities 2, answer keys 11).
Checked as users against the restored stack with the publishable key: two sample learners
signed in with their original passwords; participant01 saw their active enrollment and
course progress (5 of 7), only their own 4 released grades and no working grades;
participant02 saw no other learner's grades or submissions; participant01 opened 5 restored
lesson files through the access check, byte-identical to the backup.

Rollback: releases advance a protected production branch only to a commit whose CI passed;
rolling back means pointing it at the previous green commit. Migrations are additive so the
previous release still works against the newer schema ([OPERATIONS.md](OPERATIONS.md#releases)).

## QA screenshots

Screenshots of the application with synthetic data are in `docs/qa/` (20 PNG files at 1440 and 390 px, captured with `scripts/qa-screenshots.ts` on 2026-10-05). They show
no real person's data.

## Remaining constraints

- Deployment, production email sender, hosted Supabase and domain: blocked on owner access.
- Interface in English only; Vietnamese names and text are supported.
- No malware scanner; quarantine mode is available.
- Policy pages are drafts awaiting the owner's review; no legal review was done.
- Manual screen-reader and contrast audit not done (AC14).
