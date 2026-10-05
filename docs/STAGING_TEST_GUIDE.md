# Testing on staging as administrator and as participant

How the owner tries the running LMS on the staging deployment before production. Every
account here is created by invitation to an address the tester controls. There are no
shared passwords, no sample accounts on an internet-facing URL, and no passwords or keys
in this repository or in chat.

## 1. Prerequisites (one time)

| Step | Who | Where | Done when |
|---|---|---|---|
| Staging schema migrated | owner runs, Claude verifies | GitHub → Actions → Database migrations (target `staging`) | the run is green and `list_migrations` shows all files in `supabase/migrations` |
| Staging Auth settings | owner | Supabase → `global-cohort-staging` → Authentication | sign-ups disabled; Site URL and Redirect URLs set to the staging URL; password minimum 10 with letters and digits; templates from `supabase/templates` ([SETUP.md §2](SETUP.md#2-hosted-supabase-project-staging-and-production)) |
| Staging app on Hostinger | owner | hPanel, Node.js web app ([HOSTINGER_DEPLOYMENT.md](HOSTINGER_DEPLOYMENT.md) C and D) with `APP_ENV=staging` and the staging project's URL and keys | `https://<temporary-domain>/api/health` returns `"status":"ok"` |

The Free plan's built-in email allows only a few messages per hour. That is enough for
the handful of invitations below; configure custom SMTP before inviting more people.

## 2. Create your administrator account

1. Supabase → `global-cohort-staging` → Authentication → Users → **Invite user**, with your
   own address.
2. Open the email, follow the link (it opens `/auth/confirm` on the staging URL), and set a
   password. You land in the app as an ordinary user.
3. Grant the platform administrator role to that account, by its user id only (copy it
   from Authentication → Users):
   - from a workstation with the staging keys in `.env.local`:
     `npm run admin:bootstrap -- --user-id <uuid>` (dry run), then add `--yes`; or
   - ask Claude in the project thread to grant it on staging, giving the user id. It runs
     the same checks as the command (email confirmed, profile exists, no other
     administrator) and records the grant in the audit log.
4. Reload the page. **Administration** appears in the navigation.

## 3. Administrator checklist

Do these at desktop width, then repeat the starred ones on a phone (or the browser's
390 px device mode) and a tablet (768 px).

1. Administration → Cohorts → create a cohort (name, code, dates). *
2. Administration → Courses → create a course, then an offering of it in the new cohort.
3. Assign yourself (or a second address) as instructor of the offering.
4. Administration → Invitations → invite one participant to the offering, using a second
   address you control (for Gmail, `you+learner1@gmail.com` reaches your own inbox). *
5. In the course, Content → add a module with: a PDF, a short video (under 50 MB on the
   Free plan), a quiz, and a second module that requires the first to be completed. *
6. Gradebook → after the participant's attempt, check the quiz score and release it.
7. Administration → Audit → the steps above appear with your name.

## 4. Participant checklist

Use a private browser window so the two sessions do not mix.

1. Accept the invitation email, set a password, sign in. *
2. Courses → the invited course is listed; no other cohort's courses are visible.
3. Open the PDF and play the video. *
4. The locked module says what must be completed first; complete the first module and
   check it unlocks. *
5. Take the quiz; after release, Grades shows the score and Progress moves. *
6. Sign out; `/activity` now redirects to sign-in.

## 5. Clean up

Administration → Users → suspend the test participant, and withdraw the enrollment. Keep
staging separate from production: never invite real learners to staging, and never
copy staging accounts to production.

Record the date, staging URL, commit and results in
[ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md) (AC16).
