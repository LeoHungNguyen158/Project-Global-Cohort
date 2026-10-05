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
| Database (independent copy) | `npx supabase db dump` (schema and data) from an authorized workstation | weekly (decide) and before every migration | (decide), stored encrypted outside Supabase |
| Uploaded files | `npm run backup:storage -- --out <folder>` downloads every object in the four private buckets with a checksum manifest | daily or weekly (decide) | (decide), stored encrypted outside Supabase |

Commands (run from an authorized workstation with the target project's variables loaded;
never commit the outputs):

```bash
# Database: schema, then data
npx supabase db dump --db-url "$SUPABASE_DB_URL" -f backups/<date>/schema.sql
npx supabase db dump --db-url "$SUPABASE_DB_URL" --data-only -f backups/<date>/data.sql

# Files: every object in course-content, submissions, message-attachments, avatars
npm run backup:storage -- --out backups/<date>/storage
```

Backups contain learners' personal data and work. Store them encrypted, restrict who can
read them, and delete them when the retention period ends.

### Restore drill (in a disposable environment only)

Never demonstrate recovery by deleting production data. Exercise the procedure in a
throwaway Supabase project or the local stack:

1. Start an empty target (`npm run db:reset` locally, or a new disposable project with
   `npx supabase db push`).
2. Load the data dump: `psql "$TARGET_DB_URL" -f backups/<date>/data.sql` (run as the
   database owner).
3. Upload the files: `npm run restore:storage -- --from backups/<date>/storage` (refuses
   `APP_ENV=production` targets unless explicitly confirmed).
4. Verify: sign in as a restored account, open a lesson PDF and a video, and confirm the
   checksums reported by the restore script match the manifest.
5. Record the date, sizes, duration and result in
   [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md) (AC17).

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
- **Orphaned files**: `npm run maintenance:orphans` lists storage objects without a
  database record and abandoned pending uploads (dry run by default); add `--apply` to
  delete them.
- Video is played from private storage through 5-minute signed links that are re-issued
  after an access check. A signed link works for anyone who has it until it expires; this is
  access control, not DRM.

## Accounts and access

- **First administrator**: `npm run admin:bootstrap -- --user-id <uuid> --yes` (see
  [SETUP.md](SETUP.md)).
- **Invitations** are sent through Supabase Auth email. The invitation list shows whether the
  provider accepted each email; "accepted by provider" is not proof of delivery.
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
