# Operations

How to run the platform day to day: backups and restore, monitoring, uploads, accounts,
releases and incident handling. Owners marked **(decide)** must be filled in by the
program before real learners are enrolled.

## Ownership (decide)

| Area | Owner | Backup person |
|---|---|---|
| Hostinger account and deployments | (decide) | (decide) |
| Supabase projects (production, staging) | (decide) | (decide) |
| Learner support channel | (decide; configure it in Administration → Settings so Help shows it) | (decide) |
| Incident response (outage, data exposure) | (decide) | (decide) |
| Data region | (decide; record the Supabase region here) | |

## Backups and restore

A database backup does **not** include uploaded files. Both must be backed up.

| What | How | Cadence | Retention |
|---|---|---|---|
| Database (managed) | Supabase Pro daily backups (automatic) | daily | 7 days on Pro; longer requires PITR or a higher plan |
| Database (independent copy) | `npx supabase db dump … --data-only --schema public,auth,private` from an authorized workstation | weekly (decide) and before every migration | (decide), stored encrypted outside Supabase |
| Uploaded files | `npm run backup:storage -- --out <folder>` downloads every object in the four private buckets with a SHA-256 manifest | daily or weekly (decide) | (decide), stored encrypted outside Supabase |

Commands (run from an authorized workstation with the source project's variables loaded:
`SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`; never commit the
outputs, `backups/` is git-ignored):

```bash
# Database records: app data (public), accounts and password hashes (auth),
# quiz answer keys and results (private). The schema itself comes from the migrations.
npx supabase db dump --db-url "$SUPABASE_DB_URL" --data-only --schema public,auth,private \
  -f backups/<date>/data.sql

# Files: every object in course-content, submissions, message-attachments, avatars
npm run backup:storage -- --out backups/<date>/storage
```

Backups contain learners' personal data and work. Store them encrypted, restrict who can
read them, and delete them when the retention period ends. Auth settings (site URL,
redirect URLs, SMTP sender, email templates) are project configuration, not data: keep
them documented in [SETUP.md](SETUP.md#2-hosted-supabase-project-staging-and-production)
so a replacement project can be configured the same way.

### Restore (rehearse in a disposable environment)

Never demonstrate recovery by deleting production data. Rehearse into a throwaway Supabase
project, or a second local stack started from a copy of `supabase/` with a different
`project_id` and ports:

1. **Empty target with the same schema**: create the project and apply the migrations
   (`npx supabase link --project-ref <ref> && npx supabase db push`), or start the local copy.
   Use the same commit's migrations as the backup's source.
2. **Records**: `SUPABASE_DB_URL=<target> npm run restore:db -- --from backups/<date>/data.sql`
   shows what it will do; add `--yes` to load. It refuses a target that already has
   accounts (unless `--replace`), a non-local target unless `--confirm-target <host>`, and
   `APP_ENV=production` unless `--confirm-production`. Default rows created by the
   migrations (upload limits) are replaced by the backup's. The load is one transaction.
3. **Files**: with the target's `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`,
   `npm run restore:storage -- --from backups/<date>/storage --yes --verify`. Each file is
   checked against the manifest before upload (a corrupted backup file is reported and not
   uploaded), and `--verify` downloads every restored file again and compares its SHA-256.
4. **Configure** the target's Auth settings as in SETUP.md, point a staging app at it, and
   check: a restored learner signs in with their existing password, sees their own courses,
   grades and messages only, and opens a lesson PDF and video.
5. Record the date, sizes, duration and result in
   [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md) (AC17).

For a real incident, Supabase's own backup restore (dashboard) is usually faster for the
database; the commands above are the independent copy and the only copy of the files.

## Monitoring and logs

- **Health**: `GET /api/health` returns 200 only when the app can reach Supabase Auth.
  Point an external uptime monitor at it with alerts to the incident owner.
- **Application logs**: hPanel shows build and runtime logs for managed hosting; on a VPS,
  `docker compose logs app` (rotated at 10 MB × 5 files). The app does not log passwords,
  tokens, submission contents or private message bodies.
- **Supabase**: watch database CPU and size, storage size, egress and auth email rate
  limits in the usage dashboard; enable the dashboard's usage alerts.
- **Audit log**: Administration → Audit shows who changed roles, enrollments, content
  publication, grades and settings.

## Uploads

- Accepted types and size limits per purpose live in the `upload_limits` table
  (Administration → Settings). Defaults: documents 50 MB (PPTX 100 MB), images 10 MB,
  text 5 MB, lecture video (MP4/WebM) 1 GB, captions (VTT) 1 MB, avatars 5 MB. HTML, SVG,
  executables and archives are never accepted.
- Every upload is checked on the server after it lands in storage: stored size and leading
  bytes must match the declared type, otherwise the file is deleted and the upload marked
  rejected.
- **No malware scanner is integrated.** `UPLOAD_SCAN_MODE=none` makes verified files
  available immediately. `UPLOAD_SCAN_MODE=quarantine` holds every new upload until an
  administrator releases it in Administration → Uploads; use it if the program's policy
  requires human review until a scanning service is added.
- **Orphaned files**: `npm run maintenance:orphans` reports storage objects without a file
  record, bytes still stored for rejected or deleted records, uploads left pending for
  more than 24 hours, and profile photos that were replaced or removed more than 24 hours
  ago (report only by default). `--apply` deletes those bytes, marks the unfinished uploads
  rejected and the old photos deleted; file records, submissions and grades are kept. Run
  it weekly.
- Video is played from private storage through 5-minute signed links that are re-issued
  after an access check. A signed link works for anyone who has it until it expires; this is
  access control, not DRM.

## Accounts and access

- **First administrator**: `npm run admin:bootstrap -- --user-id <uuid> --yes` (see
  [SETUP.md](SETUP.md)).
- **Invitations** are sent through Supabase Auth email. A person who already has a confirmed
  account gets an in-app notification instead of an email. The invitation list
  (Administration → Invitations) shows whether the provider accepted each email; "accepted
  by provider" is not proof of delivery.
- **Suspension** (Administration → Users) blocks the account on its next request; it does
  not delete records. **Enrollment revocation** removes course access immediately.
- Academic records (grades, submissions, attempts) are never hard-deleted by the app;
  courses and offerings are archived instead.
- **Data requests** (decide the policy): export a learner's records with the admin reports
  and database queries; deletion of an account must consider academic record retention.
  No legal review of these processes has been done.

## Scheduled work

None is required for correctness: quiz deadlines are enforced by the database at every
access, scheduled announcements are released by comparing with database time, and expired
attempts are finalized when anyone next opens them. The optional RPC
`finalize_expired_attempts` can be run on a schedule (for example with Supabase Cron) so
reports show expired attempts as submitted without waiting for a visit.

## Releases

1. Open a pull request; CI must pass (lint, types, unit, database, build, browser tests).
2. If the release includes migrations, apply them to staging first
   (`npx supabase db push`), test, then to production **before** advancing the production
   branch. Write migrations so the previous app version still works against the new
   schema (add columns and functions; remove old ones in a later release).
3. Advance the production branch to the green commit
   ([HOSTINGER_DEPLOYMENT.md](HOSTINGER_DEPLOYMENT.md#b-release-gate-owner-in-github-one-time)).
4. Check `/api/health`, sign in, and spot-check the changed feature.

## Incidents

1. **Outage**: check `/api/health`, hPanel status and logs, and the Supabase status page.
   Roll back the code if a release caused it.
2. **Suspected data exposure**: rotate the Supabase secret key (Dashboard → API keys) and
   update the hosting variable, review the audit log and storage access, preserve logs, and
   inform the incident owner. Assess notification duties with the program's advisers.
3. **Lost or corrupted data**: stop writes if possible, then restore into a disposable
   project first, verify, and only then plan a production restore.

## Key rotation

Rotate the Supabase secret key at least yearly and whenever someone with access leaves:
create a new secret key in Supabase, update `SUPABASE_SECRET_KEY` in hPanel (or
`deploy/app.env`), redeploy or restart, then revoke the old key. The publishable key is
public by design but can be rotated the same way (requires a rebuild).
