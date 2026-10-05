# Administrator and staff guide

For platform administrators, cohort coordinators, instructors and teaching assistants (TAs).
Labels in bold are the interface labels (English only). Full permission detail:
[PERMISSIONS.md](PERMISSIONS.md).

## 1. Roles

Roles are scoped: one person can be an instructor in one offering and a learner in another.

| Role | Scope | Main tasks | Sees **Administration** |
|---|---|---|---|
| Platform administrator | Whole platform | Everything below, plus Users, Courses, Uploads, Settings | Yes |
| Cohort coordinator | Assigned cohorts | Edit its cohorts; offerings, invitations, CSV import, access requests, enrollments, staff, reports, audit log for those cohorts | Yes |
| Instructor | One offering | Content, quizzes, assignments, grading, publishing grades, accommodations, overrides, announcements, discussions, calendar | No (works inside the course) |
| Teaching assistant | One offering | View and communicate; edit content, grade, publish grades only when the matching flag is on | No |
| Learner (participant) | Own enrollments | Study, submit work, see released grades | No |
| Registered Online Account | None | An account without enrollments; no private course or cohort access | No |

## 2. First platform administrator

Nothing in the application makes an account an administrator by sign-up order, email or
name, and there is no default password. The first administrator is granted once from an
authorized workstation that has the target project's `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SECRET_KEY` loaded (never from the web server).

1. In the Supabase dashboard (Authentication → Users), invite the owner's email address
   (public sign-up is disabled). The person opens the email, chooses their own password on
   **Set your password**, and so confirms their email.
2. Copy the person's user id (UUID) from Authentication → Users.
3. Dry run (changes nothing; shows the target project, account and existing administrators):
   `npm run admin:bootstrap -- --user-id <uuid>`, then grant with the same command plus `--yes`.
4. The person reloads the page and sees **Administration** in the navigation.

The command refuses unknown ids and unconfirmed, banned or suspended accounts, and refuses
to run when another administrator already exists unless `--additional` is passed. Grant later
administrators in **Administration → Users** so the granting person is recorded. Every
grant is written to the audit log.

## 3. Platform settings and branding

**Administration → Settings** (platform administrators only); changes are audited.

- **Program name** (top of Administration), **Support email address**, **Support page link**
  (https only). The support details appear on Help, Accessibility, Privacy and Terms; while
  both are empty those pages say "Support contact not configured yet".
- **Let signed-out visitors browse the catalog** (off: signed-in people only).
- **Allowed upload types and size limits**: per purpose (lesson content, assignment
  submissions, message attachments, profile photos), set **Max size (MB)**, **Stop allowing**
  a type, or **Allow another type**. Only types the server can verify by content are offered.
  Changes apply to the next upload.

Branding is not a setting ([ASSUMPTIONS.md](ASSUMPTIONS.md), item 1): names are the `app.*`
keys in `src/i18n/messages/core.ts`, colors the `@theme` tokens in `src/app/globals.css`, the
tab icon `src/app/icon.svg`; the email templates in `supabase/templates/` (subjects in
`supabase/config.toml`) also carry the name. Changes need a code change and redeploy.

## 4. Cohorts, courses, offerings, staff and enrollments

A **cohort** groups participants. A **course** holds versioned content. An **offering** runs
one course version for one cohort, with its own dates, staff and enrollments.

**Cohorts** (**Administration → Cohorts**)
1. Platform administrators: **Create a cohort** → code (used in CSV imports), name, time
   zone, dates → **Create cohort**. Coordinators can only edit their cohorts.
2. On the cohort page: **Invite people**, **New offering**, **Add participant** (existing
   account by email), **Add coordinator** (gives the coordinator role if needed),
   **Archive cohort** / **Restore cohort**. Archived cohorts accept no invitations.

**Courses** (platform administrators, **Administration → Courses**)
1. **New course** → code and title → **Create course**. It starts with an empty draft version 1.
2. On the course page: **Rename**, **Duplicate course** (copies content as a new draft v1;
   never offerings, enrollments or grades), **Archive course**, **New offering of this course**.
   Content is written from an offering (**Edit content in …**), see section 7.

**Offerings** (**Administration → Offerings → New offering**)
1. Choose **Course and version**, cohort, code, **Term**, **Course time zone**, **Starts**,
   **Ends**; under **Catalog** tick **List this offering in the catalog once it is released**
   and choose **Open for access requests** or **Not open for requests**.
2. **Initial status**: Draft (hidden) or Published (needs a published course version) →
   **Create offering**.
3. On the offering page: **Release to learners**, **Complete offering** (active enrollments
   become completed, offering archived), **Archive offering**, **Restore as draft**,
   **Switch version**, **Edit content**, **Completion report**.

**Staff** (offering page → **Add a staff member**)
1. Enter the exact email of an existing account, choose Instructor or Teaching assistant.
2. For a TA tick any of **Edit content**, **Grade** (on by default), **Publish grades**.
   Without flags a TA can view and communicate only (a TA who joins by invitation gets
   **Grade**). **Add staff member**; change or **Remove** later.

**Enrollments** (offering page → **Enroll an existing account** → **Enroll**; people without
an account need an invitation). Status menu → **Save**: Active, Suspended or Withdrawn (end
access immediately), Completed (view only).

## 5. Inviting people

Accounts are created only through invitations. Existing accounts are notified in the app
instead of by email. An invitation can only be accepted while signed in with the invited
address.

**One invitation** (**Administration → Invitations → New invitation**)
1. **Email address**, optional **Name**, role (Participant, Instructor, Teaching assistant),
   cohort, offering (required for staff; for participants it also enrolls them),
   **Invitation expires after** (3–90 days, default 14).
2. **Create invitation and send**. Read the result message.

**CSV import** (**Administration → CSV import**, up to 200 rows)
1. **Download template** (`email,display_name,role,cohort_code,offering_code`; replace the
   placeholder `example.org` rows). Save as CSV UTF-8.
2. **1. Choose the data** (file or pasted rows); **2. Match the columns** and set
   **Values for empty cells**.
3. **3. Check the rows (dry run)** → **Check rows**. Nothing is created or sent. Each row
   shows **Ready** or **Problem** with the reason (invalid or duplicate address, unknown
   role or code, archived cohort/offering, already enrolled or invited, suspended account…).
   Use **Show only rows with problems**, fix the file and check again.
4. **4. Create the invitations** → **Create N invitation(s)…** → confirm **Create and send**.
   Rows are checked again; rows with problems are skipped. The **Import result** lists
   each row (Emailed, Email failed, Notified, Not created, Skipped).

**Resend, renew, revoke** (Sent invitations list, filter by status or **Delivery**)
- **Resend**: the emailed link expires after the Auth link lifetime (one hour by default);
  the invitation itself stays valid until its expiry date.
- **Renew and resend**: an expired invitation becomes valid for 14 more days.
- **Revoke** (optional reason, audited): the invitation can no longer be accepted.

**Delivery status**: **Email accepted by provider** means the email service accepted the
message; sent is not delivered. If nothing arrived, check spam, then **Resend**. **Email
failed**: not sent (also when the hourly sending limit is hit). **Notified in the app**: the
address already had an account.
Locally, all email is captured by Mailpit (http://127.0.0.1:54324) and never reaches real
inboxes. Staging sends through whatever sender its Supabase project is configured with;
sample addresses (`@sample.crewscaler.test`) cannot receive mail.

## 6. Access requests

Signed-in people can ask to join a listed, released offering that is **Open for access
requests**. A request never enrolls anyone by itself.
1. **Administration → Access requests** (filter Pending, Approved, Declined, Withdrawn, All).
2. Read the requester's message, optionally add a note, then **Approve** (enrolls immediately)
   or **Decline**. The person is notified in Activity; the decision is audited.

### Communities

Communities are optional discussion groups, separate from cohort and course access: being in
one never opens a course. **Administration → Communities** lists them with their cohort,
join policy and member count.
1. Create one with a name, description, an optional cohort (platform administrators may
   leave it program-wide) and a join policy: **Open** (people join and leave themselves) or
   **By invitation**.
2. Open a community to edit it or manage members. For a cohort's community, add people from
   that cohort's list; for a program-wide one, platform administrators add an existing
   account by email. **Remove** asks for confirmation. Additions and removals are audited.
Cohort coordinators manage only their own cohorts' communities and never see email addresses.

## 7. Teaching: instructors and TAs

Open the course from **Courses**; the Overview shows **Teaching tools**. Staff see every lesson
unlocked with "Staff preview: read-only"; nothing staff open records progress.

**Content** (**Manage content**, needs author permission)
1. **Versions and release** lists versions. If there is no draft, **Create draft** (copy of
   the latest published version). Drafts are shared by all offerings of the course.
2. **Edit draft** → **Course details** (summary, objectives, syllabus…) → **Save details**.
3. **Add module**; in a module, **Add lesson** with a **Content type**: Reading, PDF, Video,
   Download, External resource, Embedded video. Reorder with **Move up** / **Move down**.
4. Lesson page: **Required for course completion**, estimated duration, **Completion rule**
   (learner marks it complete, or plays at least 90% of the uploaded video), **Lesson text**,
   **Transcript**, external or YouTube/Vimeo link → **Save lesson**.
5. **Files**: **Choose files to upload**, set the role (**Primary (shown in the lesson)** for a
   PDF, MP4/WebM video or image; **Captions** for a `.vtt` file with a **Caption language**
   such as `en`; **Download** for other files) → **Attach uploaded files**. Use **Details and
   accessibility** for titles and image alternative text. There is no transcoding: upload a
   browser-playable video.
6. **Preview** a lesson or **Preview draft**, then **Publish draft**. Published versions are
   immutable; publishing waits until every attached file has finished checking.
7. **Use for this offering** to adopt a published version. Learners keep completions of
   lessons carried over. Other offerings do not change.
8. **Release to learners** (when the offering uses a published version). Hiding or archiving
   a live offering is an administrator task.

**Prerequisites and release** (from Manage content)
- **Add a condition** to a **Lesson to lock**: **Require another lesson**, **Require a quiz
  score** (minimum released score, so the quiz result must be published), or **Schedule a
  release**. Cycles are rejected. **Remove** never deletes recorded progress.
- **Overrides**: **People** → **View progress** for a learner → **Grant an override** (lesson
  and reason required, audited) → **Grant override**; **Revoke** later.

**Quizzes** (Quizzes tab → **New quiz** → **Create quiz**)
1. **Settings**: Graded or Practice, points, pass mark, **Opens**/**Closes**, time limit,
   attempts, shuffling, **Answer and feedback review** (after submit, after close, when staff
   release, never), **Score release**, **Attempt that counts** → **Save settings**.
2. **Add a question**: Single choice, Multiple select (all-or-nothing), True or false, Short
   answer (graded by staff); points, explanation, model answer → **Add question**.
3. **Preview draft**, then **Publish version N** → **Publish**. To change a published quiz,
   **Create draft version N** and publish again; started attempts keep their version.
4. **Attempts and grading**: open an attempt with **Grade** to score short answers (points and
   feedback → **Save grade**), override a score, or **Void attempt** (reason required).
5. **Publish N results** sends results to learners. **Release answers and feedback** applies
   when the review policy is "When staff release answers" and cannot be undone.
6. **Accommodations** (instructors and administrators): **Set accommodation** with extra
   minutes, extra attempts or an extended closing time → **Save accommodation**.

**Assignments** (Assignments tab → **New assignment**)
1. Title, instructions, **Accepted submission types**, points, **Available from**, **Due**,
   **Closes**, **Late work**, **Submissions allowed per learner**, **Status** (learners see it
   only when Published and available).
2. Optional **Rubric**: **Add criterion** with points and optional levels; the rubric total
   must equal the assignment points.
3. **Grade submissions**: filter (To grade, Late, Returned, Graded, Not submitted) → **Grade**
   → points or rubric scores and **Feedback to the learner** → **Save grade** (not visible yet)
   → **Publish grade**. Or **Return for revision** with a note; the learner can submit a new
   version within the submission limit. Learner drafts are never shown to staff.

**Gradebook** (Grades tab)
- Click a cell to enter points, **Missing** (counts as 0) or **Exempt** with feedback →
  **Save grade**. Saved grades stay staff-only.
- **Publish this grade** (one) or **Publish N grades** (everything unpublished in the current
  filtered view). **Unpublish** removes a grade from the learner's view (audited).
- **Add grade item** for Manual items or Participation (max points, counts toward total,
  visible to learners). **Export CSV** gives names, enrollment status and grades, no emails.
- **Released total** is what learners see; **Working total** includes unpublished grades.

**Communication**
- **Announcements** tab → **New announcement**: save as draft, **Publish now** or schedule;
  pin, edit (history kept), archive. Cohort announcements are made by cohort administrators.
- **Discussions**: staff open course topics (**New topic**); learners post and reply.
  Moderators can **Pin topic**, **Lock topic** and **Hide** a post with a reason.
- **Calendar** tab → **Add event** (Live session, Office hours, Event; optional meeting link).
  **Cancel event** keeps it shown as cancelled; **Delete event** is for mistakes. Cohort
  administrators add cohort events in **Calendar** filtered to the cohort.
- **Messages** → **New Message**: course or cohort, recipients, subject, text, up to 10
  attachments; several recipients need a confirmation. No email copies are sent.
- **Tools** → **Add resource** (guides, policies, support, links) for a scope you manage.

## 8. Users, audit log, uploads and reports

- **Users** (platform administrators): search and filter accounts. On an account: **Suspend
  account** / **Reactivate account** (reason required; suspension takes effect on the next
  request and keeps all records), **Grant role** / **Remove role** (Platform administrator,
  Cohort coordinator), **Coordinator cohorts** → **Add cohort**. You cannot suspend or demote
  yourself, and the last platform administrator cannot be removed. Passwords are never visible.
- **Audit log**: filter by person, action, record type and dates. Coordinators see their
  cohorts only. Entries cannot be edited.
- **Uploads** (platform administrators): with `UPLOAD_SCAN_MODE=quarantine`, new uploads wait
  here. **Download to review**, then **Release** or **Reject** (reason required; the file is
  deleted). No malware scanner is connected; a release means a person reviewed the file.
- **Reports**: choose an offering → **Show report** for required-lesson completion per learner;
  **Export CSV** (names only, times in UTC).
- **Overview**: counts of pending invitations, failed emails, access requests and held uploads.

## 9. Owner demo path

Use a local or staging stack with sample data; never production.

- [ ] Administrator: **Create a cohort**; **New course** (Courses); **New offering** using its
      draft v1, status Draft; **Add a staff member** as Instructor.
- [ ] Administrator: invite learners (**New invitation** or **CSV import** with dry run).
      Learners accept from the email (Mailpit locally) and set a password.
- [ ] Instructor: **Manage content** → **Edit draft** → **Add module** → **Add lesson** (PDF)
      and **Add lesson** (Video with a `.vtt` caption file and transcript).
- [ ] Instructor: **Prerequisites and release** → lock the video lesson behind the PDF lesson;
      **Publish draft**, **Release to learners**; publish a quiz and an assignment.
- [ ] Learner: opens the PDF lesson, **Mark as complete**; the video lesson unlocks; plays it
      and **Mark as played**; takes the quiz; submits the assignment and keeps the receipt.
- [ ] Instructor: grades the assignment, **Publish grade**; **Publish N results** for the quiz.
- [ ] Learner: sees feedback on the assignment, the quiz result, **Grades** totals and course
      progress on the Overview.
