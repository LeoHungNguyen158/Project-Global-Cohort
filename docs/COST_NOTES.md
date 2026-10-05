# Cost and capacity notes

This is an **editable estimate**, not a quote. Provider prices change, promotional prices
renew higher, and taxes are excluded. Every number below is labeled as either a provider
list price (with the date it was read) or an assumption you should replace with real
figures. No capacity claim is made: nothing here has been load tested.

## Service boundary

| Part | Provider | Why it is separate |
|---|---|---|
| Web application (Next.js server) | Hostinger (managed Node.js web apps hosting, or a VPS) | Owner requirement |
| Database, authentication, file storage | Supabase (managed) | Postgres with row-level security, Auth and private object storage; uploads must survive app redeploys |
| Transactional email (invitations, password resets) | An SMTP provider configured in Supabase Auth | Supabase's built-in sender is for testing only |
| Domain and DNS | Owner's registrar or Hostinger | Must be owner-confirmed |

The data is **not** hosted on Hostinger, and the system is not zero-cost.

## Provider list prices read on 2026-10-05

Supabase (https://supabase.com/pricing):

| Plan | Price | Included | Overage |
|---|---|---|---|
| Free | $0/month | 500 MB database, 1 GB file storage, 5 GB egress, 50,000 monthly active users, **50 MB maximum file upload**, no backups, project pauses after 1 week of inactivity | — |
| Pro | $25/month (first project; additional projects $10/month each) | 8 GB database disk, 100 GB file storage, 250 GB egress, 100,000 MAU, uploads up to 500 GB, daily backups kept 7 days | Disk $0.125/GB, storage $0.0213/GB, egress $0.09/GB, MAU $0.00325 |
| Point-in-time recovery | add-on, $100/month per 7 days of retention | | |

Consequences for this application:

- **The Free plan cannot hold lecture videos above 50 MB** and has no backups, and a paused
  project takes the LMS offline. Use Pro (or higher) for any real cohort.
- Use separate projects for staging and production (Pro: +$10/month for the second project).

Hostinger (https://www.hostinger.com/web-apps-hosting and the Node.js deployment guide):

- Node.js web apps are offered on Business Web Hosting and on Cloud plans (Cloud Startup,
  Professional, Enterprise, Enterprise Plus); VPS also works with manual setup. Supported
  Node.js versions listed: 18, 20, 22, 24. This application needs Node 22.
- The web apps page showed, on 2026-10-05, promotional prices that assume a 48-month term
  and renew higher: for example Cloud Startup at $7.99/month promotional and
  $25.99/month on renewal (4 CPU cores, 4 GB RAM, 100 GB NVMe, 10 web apps). Plan names
  and inclusions change; **use the actual plan in the owner's hPanel**.

## Editable monthly estimate

Replace every assumption (A) with real numbers before committing to a budget.

| Line | Formula | Example (A) |
|---|---|---|
| Hostinger plan | plan price ÷ months, renewal rate after the term | $25.99 (Cloud Startup renewal rate) |
| Supabase production | Pro base + overages | $25 |
| Supabase staging | additional project | $10 |
| Video egress | learners × videos watched × average video size | (A) 120 learners × 10 videos × 150 MB ≈ 180 GB — inside the 250 GB included |
| File storage | lecture video + documents + submissions | (A) 40 GB — inside 100 GB included |
| Backups of stored files | separate object storage (database backups do not include files) | (A) $1–5 for 40–100 GB in a low-cost object store |
| Point-in-time recovery (optional) | $100 per 7 days retention | $0 unless enabled |
| Email (SMTP provider) | provider plan | (A) $0–20 depending on volume |
| Domain | registrar annual price ÷ 12 | (A) $1–2 |
| **Total (example)** | | **≈ $62–88 per month** at renewal prices, excluding tax |

Video is usually the dominant variable cost. Each full playback of a 150 MB video by one
learner is 150 MB of Supabase egress; rewatching and seeking add more. Keep lecture
files compressed (H.264 MP4 or VP9 WebM at a sensible bitrate) and check egress in the
Supabase usage dashboard after the first weeks.

## Capacity

No load test has been run, so no learner count is promised. Before stating a capacity:

1. Pick a target (for example 150 concurrent learners during a quiz window).
2. Run a load test against **staging** with synthetic accounts (never production).
3. Watch Hostinger CPU/RAM graphs and Supabase database CPU, connections and egress.
4. Record the result and the tested scope in [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md).

The application keeps no session, timer or job state in process memory, so it can run as
one instance on managed hosting; quiz deadlines are enforced by the database.
