# Project-Global-Cohort

**Crew Scaler Global Cohort** is a cohort-based learning platform: course workspaces with
modules and lessons (text, PDF, video with captions), quizzes, assignments, a gradebook with
deliberate grade release, announcements, discussions, private messages, a calendar and an
administration area for cohorts, invitations and enrollments. Its navigation follows the
layout of a familiar academic LMS (left navigation, Activity stream, Courses list) with
original Crew Scaler branding.

Where things stand is recorded in [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)
and [docs/ACCEPTANCE_REPORT.md](docs/ACCEPTANCE_REPORT.md). The application has **not been
deployed** yet; [docs/HOSTINGER_DEPLOYMENT.md](docs/HOSTINGER_DEPLOYMENT.md) is the runbook.

## Stack

- **Next.js 16** (App Router, server components and server actions) with TypeScript and
  Tailwind CSS. It needs a Node.js server; it is not a static export.
- **Supabase**: Postgres with row-level security on every table, Auth (invitation only,
  cookie sessions through `@supabase/ssr`), private Storage buckets for course files,
  submissions, message attachments and avatars.
- **Hosting**: Hostinger (managed Node.js web app, or a VPS with the included Docker files).

How the parts fit together: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Who may do what,
and where it is enforced: [docs/PERMISSIONS.md](docs/PERMISSIONS.md).

## Run it locally

Requires Node.js 22, npm and Docker. Full details, environment variables and sample
accounts are in [docs/SETUP.md](docs/SETUP.md).

```bash
npm ci
npm run db:start                  # local Supabase; applies every migration
cp .env.example .env.local        # fill in values from `npx supabase status -o env`
npm run seed                      # synthetic sample data (local only; needs SEED_PASSWORD)
npm run dev                       # http://localhost:3000
```

## Checks

```bash
npm run lint && npm run typecheck
npm run test:unit                 # pure logic
npm run test:db                   # permissions and integrity against the local API
npm run test:e2e                  # browser tests at 1440, 768 and 390 px with axe checks
npm run build
```

CI (`.github/workflows/ci.yml`) runs all of these on every pull request, against a fresh
local Supabase stack.

## Operator commands

Run from an authorized workstation with the target project's variables loaded. Each
command shows what it will do before it changes anything.

| Command | Purpose |
|---|---|
| `npm run admin:bootstrap -- --user-id <uuid> [--yes]` | Grant the first platform administrator to an exact, verified account |
| `npm run backup:storage -- --out <folder>` | Download every stored file with a checksum manifest |
| `npm run restore:db -- --from <data.sql> [--yes]` | Load a data-only database dump into a freshly migrated project |
| `npm run restore:storage -- --from <folder> [--yes --verify]` | Upload a file backup and verify checksums |
| `npm run maintenance:orphans [-- --apply]` | Find stored files with no record and unfinished uploads |
| `npm run seed` | Synthetic sample data for local and staging databases (refuses production) |

Backups, monitoring, releases and incidents: [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Documentation

| Document | For |
|---|---|
| [docs/HANDOFF.md](docs/HANDOFF.md) | Where to pick up the work |
| [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) | Program administrators and instructors |
| [docs/LEARNER_GUIDE.md](docs/LEARNER_GUIDE.md) | Participants |
| [docs/STAGING_TEST_GUIDE.md](docs/STAGING_TEST_GUIDE.md) | Owner: trying staging as administrator and participant |
| [docs/SETUP.md](docs/SETUP.md) | Local development and Supabase project setup |
| [docs/HOSTINGER_DEPLOYMENT.md](docs/HOSTINGER_DEPLOYMENT.md) | Deploying to Hostinger, verification, rollback |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Backups, monitoring, uploads, accounts, incidents |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technical design |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | Roles and capabilities |
| [docs/REFERENCE_MAP.md](docs/REFERENCE_MAP.md) | How the reference layouts map to pages |
| [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) | Decisions the owner should confirm |
| [docs/COST_NOTES.md](docs/COST_NOTES.md) | Dated provider prices and an editable estimate |
| [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) | Feature checklist and known gaps |
| [docs/ACCEPTANCE_REPORT.md](docs/ACCEPTANCE_REPORT.md) | Acceptance tests and their evidence |

## Data and privacy rules for contributors

- Never commit secrets, `.env*` files, backups, or real people's data. Sample data uses the
  reserved domain `sample.crewscaler.test`.
- The private reference screenshots used for layout stay outside the repository.
- Interface text lives in `src/i18n/messages/`; course content is never machine-translated.

No license file has been added; choosing one is the repository owner's decision.
