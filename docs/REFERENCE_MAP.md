# Reference map

The owner supplied six private screenshots (R1–R6) of an existing academic LMS and a
GitHub form. They were used **only** to understand information architecture and useful
density. They contain a real person's academic records, so they are not in this
repository, are listed in `.gitignore`, and nothing in this document reproduces their
names, grades, course codes or logos. Crew Scaler branding, colors, wording and all
sample data here are original and synthetic.

Status values: **Built** (implemented with real behavior), **Adapted** (implemented with a
deliberate change, explained), **Not applicable**.

## Shared navigation (R1–R5)

| Reference element | Crew Scaler implementation | Status |
|---|---|---|
| Dark persistent left navigation | `src/components/layout/sidebar.tsx`: dark sidebar (232 px), keyboard drawer below 1024 px with focus return and Escape | Built |
| Profile entry at the top | Person's display name linking to `/profile` | Built |
| Activity, Courses, Organizations, Calendar, Messages, Grades, Tools | Same order: Activity, Courses, **Cohorts & Communities** (the brief maps Organizations to it), Calendar, Messages (unread count), Grades, Tools; Administration appears only for administrators and coordinators | Adapted (renamed per brief) |
| Sign Out | Server action that ends the Supabase session | Built |
| Footer Privacy, Terms, Accessibility | Sidebar footer and public footers link to `/privacy`, `/terms`, `/accessibility` (drafts for owner review) | Built |
| Help | Floating Help button on every signed-in page and links on public pages → `/help` | Built |

## R1 and R4 — Courses (R4 duplicates R1; no extra screen was invented)

| Reference element | Implementation | Status |
|---|---|---|
| Page title and Course Catalog link | `/courses` header with a Course Catalog link → `/catalog` | Built |
| List/grid toggle | Two pressed-state buttons; the choice is saved to the person's profile (`profiles.courses_view`) and persists across devices | Built |
| Search | Searches code, title, cohort, term and staff names (locale-aware, Vietnamese works) | Built |
| Terms dropdown | "Cohorts / terms" filter built from the person's offerings | Adapted (brief: cohort/term) |
| Filters dropdown | All courses, Favorites, Courses I'm taking, Courses I teach, and for administrators "All offerings I administer" | Built |
| Items per page | 10 / 25 / 50 with pagination | Built |
| Result count | Live "N results" text | Built |
| Grouped rows | Ongoing, Upcoming, then each closed term | Built |
| Colored vertical accent | Per-offering accent color (decorative; never the only status signal) | Built |
| Course code and name | Code, course code and full title (titles wrap; no truncation) | Built |
| Open/closed status | Text status: Open, Opens on a date, Closed (with lock icon), Draft | Built |
| Multiple Instructors | Single name, or an accessible disclosure listing all staff | Built |
| More info | Disclosure with summary, cohort, term, dates with course time zone, role, progress | Built |
| Favorite star | Toggle with `aria-pressed`, stored per person (`favorites`) | Built |
| Contextual "…" menu | Role-aware menu: Open course, Course content, Grades, Messages, Calendar | Built |

## R2 — Grades

| Reference element | Implementation | Status |
|---|---|---|
| "Current courses and organizations" scope | `/grades` lists current offerings, with past offerings available separately | Built |
| Course cards with code, title, accent | Card per offering | Built |
| Overall percentage | Learner-only pill computed from **released** grades, or "No released grades" instead of a fabricated 0% | Adapted (learner/staff separated) |
| Participation item | Manual and participation grade items in the gradebook | Built |
| Grading queue count ("N to grade") | Staff-only, real count of submitted work awaiting grading | Adapted (shown only to graders) |
| Post grades | Staff-only link to publish with a confirmation summary; hidden from TAs without publish permission | Adapted |
| View all work | Learner detail page `/grades/<offering>` with every item, status and feedback | Built |
| Empty-grade states | Striped empty state component | Built |

The reference mixes teacher and learner capabilities on one screen. Here every control is
decided per offering by the viewer's role, so a learner never sees instructor actions.

## R3 — Messages

| Reference element | Implementation | Status |
|---|---|---|
| Course/group rows with accent, "ID: code" and name | `/messages` lists message scopes (offerings and cohorts) | Built |
| New Message action | Per-scope compose with a scoped recipient picker | Built |
| (Not shown) conversation list, thread, unread state | Thread list per scope, thread view with replies, unread counts, polling refresh | Built (brief requirement) |

The screenshot does not establish a real-time protocol or email integration; messages use
polling and in-app notifications only.

## R5 — Activity

| Reference element | Implementation | Status |
|---|---|---|
| Personal greeting | "Hello, <name>" | Built |
| Settings icon | Gear linking to notification settings (`/profile#notifications`) | Built |
| Course activity cards | Ongoing offerings with accent, code, title, labeled unread-update count, staff "N to grade", learner "% complete" | Built |
| Small flag count | Replaced by a **labeled** count ("3 unread updates"); the reference's meaning was not guessed | Adapted (brief R5 rule) |
| View all courses | Link to `/courses` | Built |
| Activity Stream with filter | Right-hand stream with a kind filter (Show all, announcements, content, due items, messages, grades) and Mark all read | Built |
| Recent timeline with dates and course context | Grouped timeline with date, time in the viewer's zone, course label, New badge | Built |
| View my grade buttons | Grade notifications open `/grades/<offering>#item-<id>`; every event opens its exact target | Built |
| (Brief) next deadlines | Upcoming deadlines panel for the next 14 days | Built |

## R6 — GitHub creation form

The form showed the owner `LeoHungNguyen158`, the name normalized to
`Project-Global-Cohort`, Public selected, README enabled, and no `.gitignore` or license.
It was not treated as proof of anything. The live repository was checked with
authenticated access: it existed with a single initial commit on `main`. Work was added on
the branch `feat/global-cohort-lms` on top of that history; visibility and license were
left unchanged.

## Screens the references do not show

Calendar, cohort and community interiors, tools, the course workspace (Overview, Content,
Announcements, Assignments, Quizzes, Discussions, Grades, Calendar, People), quizzes,
sign-in, administration and authoring were designed from the brief's written requirements,
not from the screenshots.
