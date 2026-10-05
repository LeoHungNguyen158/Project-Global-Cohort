# Assumptions and decisions

Decisions made where the brief left a choice, and assumptions that the owner should
confirm. Each item says where to change it.

## Product and content

1. **Branding.** No logo or brand guide was supplied. The product uses a text wordmark
   ("Crew Scaler" / "Global Cohort") and the brief's proposed palette (dark sidebar
   `#202326`, canvas `#F7F8FA`, primary `#1D4ED8`, border `#D8DEE6`). Change colors in
   `src/app/globals.css` (`@theme` tokens), names in `src/i18n/messages/core.ts`
   (`app.*` keys), and the tab icon in `src/app/icon.svg`.
2. **Sample curriculum.** The three sample courses (Agentic AI Foundations, Multi-Agent
   Systems Security, AI Governance Essentials), cohorts and people are illustrative
   placeholders marked as sample data. They are not a finalized curriculum, an accredited
   program, or real participants. No certification, CPE/CEU credit, university affiliation
   or employment outcome is claimed anywhere.
3. **Language.** English is the only complete interface language. All interface strings
   are in `src/i18n/messages/*.ts` so a Vietnamese dictionary can be added with the same
   keys. Vietnamese names and course text are stored and displayed as entered; nothing is
   machine-translated.
4. **Terminology.** "Participant"/"learner", "cohort", "enrollment", and "Registered Online
   Account" (an account without enrollments). The word "Membership" is not used.
5. **Legal and policy pages** (`/privacy`, `/terms`, `/accessibility`) are factual drafts
   marked for owner review. They make no claim that legal compliance has been reviewed.
6. **Support contact.** None was provided. Help shows that support details are not
   configured until an administrator sets them in Administration → Settings.
7. **Certificates** are not implemented (optional later feature). Completion records and
   progress are.

## Accounts and access

8. **Invitation-only.** Public sign-up is disabled in Supabase Auth. A person gets access
   through an invitation, an approved access request, or an administrator. Requesting
   access never enrolls anyone automatically and never implies payment.
9. **Passwords**: at least 10 characters with letters and digits (enforced by Supabase Auth
   and the app). Sessions use Supabase's refresh-token rotation; access tokens last one hour.
10. **Public catalog** is controlled by the `public_catalog` setting. When off, signed-out
    visitors are asked to sign in. Only approved metadata is ever shown.
11. **Staff preview.** Staff view learner pages as themselves with a read-only label;
    there is no impersonation, so no fake learner progress and no audit gaps.

## Learning and assessment

12. **Versioning.** Published course versions are immutable; edits create a draft that is
    published and then adopted per offering. Progress follows lesson lineage, so adopting a
    new version keeps completed work.
13. **Completion rules.** Readings and files: the learner acknowledges completion. Uploaded
    video: completion requires playback progress of at least 90% recorded by the player;
    the interface calls this "played", not "learned". Quizzes and assignments complete
    through their own results. Optional items never block course completion; course
    progress counts required items only.
14. **Quiz scoring.** Single choice and true/false: full points or zero. Multiple select:
    all-or-nothing by default; no negative totals. Short answers are graded manually; an
    attempt with ungraded short answers is "pending" and does not count yet.
15. **Quiz deadlines.** Effective deadline = the earlier of (start + time limit + any
    granted extra time) and the effective closing time; a missing bound is ignored. The
    closing time truncates an attempt, and the learner is told the exact deadline before
    starting. The countdown in the browser is informative; the database enforces the
    deadline.
16. **Multiple attempts.** The quiz grade is the highest fully graded attempt by default
    (a tie keeps the earlier attempt); a quiz can instead use the latest fully graded
    attempt, set explicitly per quiz. In-progress, voided and partly graded attempts are
    excluded and shown separately. The result goes to the gradebook and reaches the learner
    only when grades are published; the gradebook, pass/fail, prerequisites and completion
    all read this same result.
17. **Grades.** Points-based calculation. Learners see only published grades; working
    grades stay in a staff-only table until publication.

## Time

18. Timestamps are stored in UTC; each offering and event keeps an IANA time zone; pages
    show the viewer's profile time zone with a label and the course-time reference when
    different. A wall time that occurs twice on a daylight-saving fall-back day (for
    example 1:30 AM in New York on 2026-11-01) is interpreted as the first occurrence; a
    wall time skipped in spring is moved forward by the gap.

## Files, media and email

19. **Uploads** go directly to private Supabase Storage (resumable above 6 MB) and are
    verified on the server (size and file signature). No malware scanner is integrated;
    `UPLOAD_SCAN_MODE=quarantine` holds uploads for manual release.
20. **Video formats**: MP4 (H.264 video with AAC audio is the most widely playable) and
    WebM (VP9/Opus); captions as WebVTT. There is no transcoding: upload a
    browser-playable file. Embedded video is limited to YouTube (privacy-enhanced domain)
    and Vimeo, entered as a URL and stored as provider + id.
21. **Email**: only Supabase Auth emails are sent (invitation, password reset, email
    confirmation). Course notifications are in-app only; no course email is sent, and no
    setting pretends otherwise. A production SMTP sender must be configured before inviting
    real people.
22. **Messages** refresh by polling; there are no WebSockets and no email copies.

## Delivery

23. **Repository.** The existing repository and its initial commit were kept. Work is on the
    branch `feat/global-cohort-lms` with a pull request to `main`. Repository visibility and
    licensing were not changed (no license file was added).
24. **Hosting.** No Hostinger plan, domain or Supabase project details were available, so
    nothing is deployed. The runbook covers both managed Node.js hosting and a VPS.
25. **Deferred** (not built and not shown as navigation): payments, subscriptions, income
    share terms, external SSO, SCORM/xAPI/LTI, native mobile apps, AI tutoring, code
    execution or automatic code grading, proctoring, enterprise analytics, video
    transcoding, external LMS imports.
