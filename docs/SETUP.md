# Setup

This guide covers a local development environment and the configuration of a hosted
Supabase project for staging or production. Deployment of the web application to
Hostinger is in [HOSTINGER_DEPLOYMENT.md](HOSTINGER_DEPLOYMENT.md).

## 1. Local development

### Prerequisites

- Node.js 22 (see `.nvmrc`) and npm 10 (`packageManager` in `package.json`).
- Docker, for the local Supabase stack (Postgres, Auth, Storage, Mailpit).
- Git.

### Install and start

```bash
npm ci
npm run db:start                 # first run downloads images and applies every migration
npx supabase status -o env       # prints local URLs and keys for the next step
cp .env.example .env.local       # then fill in the values below
```

`.env.local` (never committed):

| Variable | Local value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `API_URL` from `supabase status` (http://127.0.0.1:54321) | Browser-visible |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `PUBLISHABLE_KEY` | Browser-visible |
| `SUPABASE_SECRET_KEY` | `SECRET_KEY` | **Server-only.** Never prefix with `NEXT_PUBLIC_`. |
| `SUPABASE_DB_URL` | `DB_URL` | Used by the seed, tests and maintenance scripts only |
| `APP_BASE_URL` | `http://localhost:3000` | Used in auth email links |
| `APP_ENV` | `development` | `production` disables the seed |
| `UPLOAD_SCAN_MODE` | `none` | `quarantine` holds uploads for administrator review |
| `SEED_PASSWORD` | choose one (12+ characters, letters and digits) | Password for the synthetic sample accounts |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | optional | Only if you use a preinstalled Chromium instead of `npx playwright install chromium` |

```bash
npm run seed      # loads isolated synthetic sample data (local databases only)
npm run dev       # http://localhost:3000
```

Local email (invitations, password resets) is captured by Mailpit at
http://127.0.0.1:54324. Nothing is delivered to real inboxes.

### Sample accounts

All sample accounts use the reserved domain `@sample.crewscaler.test` and the
`SEED_PASSWORD` you chose. They exist only where `npm run seed` ran.

| Account | Role |
|---|---|
| `admin@` | Platform administrator |
| `mai.tran@` | Instructor of Agentic AI Foundations (fall, ongoing; spring, upcoming) and AI Governance Essentials (archived) |
| `linh.pham@` | Teaching assistant in the fall Agentic AI Foundations offering (can grade; cannot author or publish grades) |
| `daniel.okafor@` | Instructor of Multi-Agent Systems Security, and a learner in Agentic AI Foundations (mixed roles) |
| `participant01@` … `participant12@` | Learners across the sample offerings |

The sample courses, cohorts and people are illustrative placeholders, not a finalized
curriculum or real participants.

### Tests

```bash
npm run lint
npm run typecheck
npm run test:unit                 # pure logic
npm run test:db                   # permission and integrity tests against the local API (needs the seed)
npx playwright install chromium   # once
npm run test:e2e                  # browser tests; reuses a running dev server on :3000
```

The database tests change sample records; run `npm run seed` again before taking
screenshots or running the browser tests.

### Resetting

```bash
npm run db:reset   # re-applies migrations to an empty local database
npm run seed       # reload sample data
```

`npm run seed` alone also works: it purges previous sample data (sample-marked records and
`@sample.crewscaler.test` accounts only) and recreates it.

## 2. Hosted Supabase project (staging and production)

Use **separate** Supabase projects for staging and production. Pick the data region
deliberately (closest to most learners, and acceptable for the program's data policy) and
record it in [OPERATIONS.md](OPERATIONS.md).

1. **Create the project** in the Supabase dashboard. Note the project reference.
2. **Apply the migrations** from an authorized workstation or CI job (not from the hosting
   server):
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push          # applies supabase/migrations in order
   ```
   Or, once `.github/workflows/db-migrate.yml` is on `main`, use **Actions → Database
   migrations → Run workflow** (dry run first). It needs, per GitHub environment
   (`staging`, `production`), the variable `SUPABASE_PROJECT_REF` and the secrets
   `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`; give `production` required reviewers.
   Never run `db reset` against a hosted project. Never seed production.
3. **Auth settings** (Dashboard → Authentication):
   - Disable new user sign-ups (accounts are created by invitation).
   - Site URL: the canonical app URL, e.g. `https://lms.example.org`.
   - Redirect URLs: `https://lms.example.org/**` (and the staging URL for the staging project).
   - Password policy: minimum 10 characters, letters and digits (matches the app).
   - Email templates: copy `supabase/templates/invite.html`, `recovery.html` and
     `confirmation.html` and their subjects from `supabase/config.toml`. The links must keep
     the `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=…` form so the
     Next.js server verifies them.
   - SMTP: configure a real sender (custom SMTP) before inviting real people. The built-in
     Supabase email service is rate-limited and intended for testing. Verify an invitation
     and a password reset end to end against the real domain.
4. **Storage**: the migrations create four private buckets (`course-content`,
   `submissions`, `message-attachments`, `avatars`) and their policies. Do not make them
   public. Check the project's file size limit allows the largest configured upload
   (lecture video: 1 GB by default in `upload_limits`). The Free plan caps every upload at
   50 MB, so long lecture videos need a paid plan (Pro raises the global limit, set under
   Storage → Settings); otherwise lower the video limit in Administration → Settings so the
   app states the real limit.
5. **Keys**: copy the publishable key and a secret key into the hosting environment
   variables ([HOSTINGER_DEPLOYMENT.md](HOSTINGER_DEPLOYMENT.md)). The secret key bypasses
   RLS; keep it server-only and rotate it if it is ever exposed.
6. **First administrator**: invite or create the owner's account in the Supabase dashboard,
   have them confirm their email and sign in once, then grant the role from an authorized
   workstation:
   ```bash
   npm run admin:bootstrap -- --user-id <their auth user id>          # shows what will happen
   npm run admin:bootstrap -- --user-id <their auth user id> --yes    # grants platform admin
   ```
   The command refuses unknown or unconfirmed users and writes an audit event.
7. **Staging sample data (optional)**: `APP_ENV=staging npm run seed -- --allow-remote`
   against the staging project only. Remove or disable sample accounts before any public
   access.
