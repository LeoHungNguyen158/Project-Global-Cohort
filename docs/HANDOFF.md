# Handoff

Where the work stands and how to pick it up. Whoever stops work updates this file and
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) in the same commit.

## Current state

**Updated:** 2026-10-05, final build state.

- Repository: `LeoHungNguyen158/Project-Global-Cohort`, branch `feat/global-cohort-lms`.
  The commit that last changed this file is the reference point; `git log origin/feat/global-cohort-lms`
  shows anything newer.
- Built and committed on the branch: database schema with row-level security and private
  storage, synthetic seed, sign-in and password reset, app shell, Activity and Courses;
  the course workspace, content, authoring, uploads and video; quizzes and assignments;
  grades and calendar; messages, announcements, discussions, cohorts and communities;
  administration, including Administration → Communities; catalog, profile, tools, help,
  legal pages and invitation acceptance; operator commands (first admin, backup, restore,
  orphan cleanup), CI, Docker files for the VPS route, and the docs listed in the README.
  [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) has the item-by-item state and
  known gaps; [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md) has the acceptance evidence.
- Pull request: a pull request from this branch to `main` is being opened; see the pull
  request from this branch for its number and CI state.
- Deployment: none. Nothing has been deployed to Hostinger or to a hosted Supabase project.

## Resume in a new environment

1. `git clone` the repository, `git checkout feat/global-cohort-lms`, `npm ci`.
2. Start Docker, then `npm run db:start`. In a sandbox where Supabase's default image
   registry is unreachable, prefix it with `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`.
3. Create `.env.local` from `.env.example` with the values printed by
   `npx supabase status -o env` ([SETUP.md](SETUP.md) lists every variable).
4. `npm run seed`, then `npm run dev` and sign in with a sample account from SETUP.md.
5. Before committing: `npm run lint && npm run typecheck && npm run test:unit && npm run test:db && npm run build`,
   and `npm run test:e2e` for anything that changes pages.

To start again from a clean database: `npx supabase db reset` (local only), then
`npm run seed`.

## Next steps, in order

1. The owner provides the items under "Needed from the owner" below: Hostinger access,
   hosted Supabase projects, an SMTP sender, the domain and a support contact.
2. Follow [HOSTINGER_DEPLOYMENT.md](HOSTINGER_DEPLOYMENT.md), run the deployed smoke
   tests, and record the result as AC16 in [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md).
   Set the support contact in Administration → Settings.
3. Run a manual accessibility audit (screen reader and contrast; AC14) before enrolling
   learners who rely on assistive technology.
4. Have the privacy, terms and accessibility pages reviewed (they are drafts; no legal
   review has been done).
5. Optional: add a Vietnamese interface dictionary under `src/i18n/messages/` with the
   same keys, and its client subsets under `src/i18n/client/`.

## Needed from the owner

These block deployment or production use; none of them can be invented by the build.

- A Hostinger plan that runs Node.js applications (managed Node.js web app or a VPS) and
  access to set it up.
- A hosted Supabase project for staging and one for production, with the data region chosen.
- A verified email sender (SMTP) for invitations and password reset emails.
- The domain or subdomain the application will use.
- A support email address or URL for the Help page (set in Administration → Settings).
- Optional: a logo and brand colors; a license choice for the repository.

## Rules for whoever continues

- The reference screenshots contain a real person's academic records. Keep them outside
  the repository; never commit them or anything copied from them.
- Never commit secrets, `.env*` files (except `.env.example`), database dumps, storage
  backups or uploads. Sample people use the reserved domain `sample.crewscaler.test`.
- Report a push, merge or deployment only after checking it (for example with
  `git ls-remote` or the provider's dashboard).
