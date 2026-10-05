# Hostinger deployment runbook

**Current state (2026-10-05): not deployed.** Nothing has been deployed to Hostinger.
The build had no Hostinger access, and the account's current plan (**Single Web
Hosting**) cannot run this application (see A.1). A Supabase **staging** project exists
(`global-cohort-staging`, ref `xzhfjijyvwhtsekwdgak`, Singapore, Free plan) with only
the first migration applied; the rest are applied with the `Database migrations`
workflow (SETUP.md §2). No production Supabase project exists yet. Each step below says
who does it and how to verify it.

Target URLs: staging on Hostinger's temporary domain first, then production at
**`academy.crewscaler.org`**. The `crewscaler.org` website stays on Squarespace, and its
email records are not changed (section F).

The web application runs on Hostinger. Data, authentication and files stay in Supabase
(see [ARCHITECTURE.md](ARCHITECTURE.md)). Do not substitute another host, and do not
statically export the app: it needs a Node.js server for sign-in, server actions and the
`/api/*` routes.

## A. Preflight (owner, in hPanel)

1. Identify the exact plan on the account. Node.js web apps are available on **Business
   Web Hosting** and **Cloud** plans (Startup, Professional, Enterprise, Enterprise Plus);
   a **VPS** also works with route B below. Shared plans without Node.js web apps cannot
   run this application; do not buy or upgrade anything without deciding to.
   The account currently has **Single Web Hosting**, which has no Node.js web apps (only
   static files and PHP). Running the full LMS needs one of: Business Web Hosting, Cloud
   Startup or higher, or a VPS. A static export would lose sign-in, server actions and the
   `/api/*` routes, so it is not an option. The plan decision is the owner's.
2. Confirm Node.js **22.x** is offered for the app (the guide lists 18, 20, 22 and 24).
3. URLs: Hostinger's temporary domain for staging, and `academy.crewscaler.org` for
   production. Do not point `crewscaler.org` or `www` at this app.
4. Create the Supabase projects (staging and production) and apply migrations as in
   [SETUP.md §2](SETUP.md#2-hosted-supabase-project-staging-and-production).

## B. Release gate (owner, in GitHub; one time)

Hostinger rebuilds automatically when the connected branch changes and **does not wait
for GitHub Actions**. So production must follow a branch that only moves after CI passes:

1. Merge reviewed work into `main` through pull requests with the `CI` checks required
   (Settings → Branches → branch protection or rulesets for `main`).
2. Create a `release` branch, protect it the same way, and connect **production** to
   `release`. Advance it only to a commit whose CI run is green:
   ```bash
   git fetch origin
   git push origin <green-commit-sha>:refs/heads/release
   ```
3. Staging may follow `main` (or a `staging` branch) so every merge is exercised first.

## C. Route A — managed Node.js web app (preferred when the plan supports it)

1. hPanel → Websites → add a website → **Node.js web app** → import from GitHub. Grant the
   Hostinger GitHub app access to **only** `LeoHungNguyen158/Project-Global-Cohort`.
2. Branch: `release` for production (`main` or `staging` for staging). App root: the
   repository root.
3. Framework: Next.js (auto-detected). Node.js version: **22.x**. If the form asks:
   install `npm ci`, build `npm run build`, start `npm run start`, output directory `.next`.
   `next start` listens on the `PORT` the platform provides.
4. Add the environment variables in section D **before the first build**: `NEXT_PUBLIC_*`
   values are compiled into the browser bundle, so changing them later requires a rebuild.
   Do not use the database connection wizard to paste a database password into the app;
   this application talks to Supabase over its HTTPS API and needs no direct database
   connection at run time.
5. Deploy and read the build log until it reports a successful Next.js build.
6. Managed hosting does not allow running npm commands over SSH. Run migrations and the
   first-administrator command from an authorized workstation or CI against the Supabase
   project ([SETUP.md §2](SETUP.md#2-hosted-supabase-project-staging-and-production)).
7. Files written under `hbuilds/` or `public_html` are replaced on every deployment. This
   application never writes uploads there: every upload goes to private Supabase Storage.

## D. Environment variables (names only; values live in hPanel or `deploy/app.env`)

| Name | Visibility | Value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser | the project's publishable key |
| `SUPABASE_SECRET_KEY` | **server only** | a secret key (bypasses RLS; used only for invitations, upload verification and maintenance after authorization) |
| `APP_BASE_URL` | server | canonical URL, e.g. `https://lms.example.org` |
| `APP_ENV` | server | `production` (or `staging`) |
| `UPLOAD_SCAN_MODE` | server | `none` or `quarantine` ([OPERATIONS.md](OPERATIONS.md#uploads)) |
| `SERVER_ACTIONS_ALLOWED_ORIGINS` | server | only if a proxy hides the public host (comma-separated hosts) |

Never set `SEED_PASSWORD` or `SUPABASE_DB_URL` on a production app, and never prefix a
secret with `NEXT_PUBLIC_`.

## E. Verify the deployment

1. `https://<app-url>/api/health` returns HTTP 200 with `"status":"ok"` and
   `"supabase_auth":"ok"`. A 503 means the app cannot reach Supabase Auth: check the URL and
   keys.
2. `https://<app-url>/activity` signed out redirects to `/login?next=%2Factivity`.
3. Response headers on a signed-in page include `Cache-Control: private, no-store`,
   `Content-Security-Policy`, `Strict-Transport-Security` and `X-Frame-Options: DENY`.
4. Sign in as the first administrator; invite a test learner using an address you control;
   confirm the email arrives from the configured sender, the link opens `/auth/confirm` on
   this domain, the password can be set, and the learner lands in the invited course.
5. Upload a small PDF as an instructor, redeploy the app, and confirm the file still opens.

## F. Domain and HTTPS

1. Add `academy.crewscaler.org` to the website in hPanel. hPanel then shows the record to
   create (an A record with an IP address, or a CNAME); do not guess the value.
2. Create that **one** record where `crewscaler.org`'s DNS is managed (if the domain is
   with Squarespace: Squarespace → Domains → crewscaler.org → DNS → Custom records), with
   host `academy`. Do not change nameservers, and do not edit or delete existing records:
   the `@` and `www` records keep the Squarespace site, and the `MX`, `SPF`/`TXT`,
   `DKIM` and `DMARC` records keep the email working. Check with
   `dig +short academy.crewscaler.org` and confirm `dig +short MX crewscaler.org` is
   unchanged.
3. Enable the free SSL certificate in hPanel and confirm `https://` loads without warnings.
4. Update Supabase Auth: Site URL and Redirect URLs to the final `https://` origin, and set
   `APP_BASE_URL` to the same origin. Re-test invitation and password-reset links.
5. If Hostinger's CDN is enabled, confirm it does not cache personalized pages: sign in as
   two different users in two browsers and check each sees only their own name, courses and
   grades, and that signed-in responses carry `Cache-Control: private, no-store`.

## G. Route B — Hostinger VPS with Docker (only if a VPS is the chosen infrastructure)

Files: `Dockerfile` (standalone Next.js server, non-root, health check),
`docker-compose.yml` (app + Caddy reverse proxy with automatic HTTPS, read-only app
filesystem, log rotation), `deploy/Caddyfile`, `deploy/app.env.example`.

```bash
# On the VPS (Ubuntu LTS), as a non-root user with Docker Engine and the compose plugin:
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp && sudo ufw enable
git clone https://github.com/LeoHungNguyen158/Project-Global-Cohort.git && cd Project-Global-Cohort
git checkout <release commit or tag>
cp deploy/app.env.example deploy/app.env && chmod 600 deploy/app.env   # fill in values
export APP_DOMAIN=lms.example.org APP_RELEASE=$(git rev-parse --short HEAD)
export NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
docker compose up -d --build
docker compose ps        # app should become "healthy"
```

Point the domain's A/AAAA records at the VPS address shown in hPanel; Caddy obtains the
certificate once DNS resolves. Only ports 80 and 443 are public; the app port is internal.
Update by checking out a newer release and running `docker compose up -d --build`; keep
the previous image tag for rollback. Supabase remains the data layer; do not run a
database on the VPS unless that is separately decided.

## H. Acceptance on the real URL, monitoring and rollback

**Smoke tests (AC16).** On **staging**, load the synthetic sample data
(`APP_ENV=staging npm run seed -- --allow-remote` against the staging Supabase project) and
run the browser suite against the deployed URL:

```bash
BASE_URL=https://<staging-url> SEED_PASSWORD=<the staging sample password> npm run test:e2e
```

On **production**, never seed. Walk through section E with the real administrator and one
test learner created by invitation, then revoke that learner's enrollment and suspend the
test account. Record the date, URL, commit and results in
[ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md).

**Monitoring.** Add an external uptime check on `/api/health` (any monitoring service the
owner chooses) with alerts to a named person, and enable Supabase usage and database
alerts. Decide who responds and record it in [OPERATIONS.md](OPERATIONS.md).

**Rollback.**
- Code: move `release` back to the previous known good commit
  (`git push --force-with-lease origin <previous-sha>:refs/heads/release`) or redeploy the
  previous build from hPanel's deployment history; on a VPS, check out the previous tag and
  rebuild.
- Schema: migrations are additive and applied before the code that needs them, so the
  previous build keeps working against the newer schema. Rolling code back does **not**
  roll data back; restoring data is a separate, deliberate operation
  ([OPERATIONS.md](OPERATIONS.md#backups-and-restore)).

## I. Cost

See [COST_NOTES.md](COST_NOTES.md). Use the plan actually on the account; do not purchase
or upgrade without an explicit decision.
