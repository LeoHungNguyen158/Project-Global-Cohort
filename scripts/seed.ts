/**
 * Isolated, repeatable SAMPLE seed for development and staging.
 *
 *   npm run seed            # local only (refuses non-local databases)
 *   npm run seed -- --allow-remote   # staging, requires APP_ENV=staging and SEED_PASSWORD
 *
 * Every record created here is marked sample (is_sample or a @sample.crewscaler.test
 * account). Re-running first purges previous sample data only; real data is untouched.
 * The seed refuses to run when APP_ENV=production. It never sends email: accounts are
 * created already confirmed through the admin API and addresses use the reserved .test TLD.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { asUser, connect, isLocalUrl, requireEnv } from "./lib/db";
import { purgeSampleData, SAMPLE_DOMAIN } from "./lib/purge-sample";

const args = new Set(process.argv.slice(2));
const appEnv = process.env.APP_ENV ?? "development";
if (appEnv === "production") {
  console.error("Refusing to seed: APP_ENV=production.");
  process.exit(1);
}
const dbUrl = requireEnv("SUPABASE_DB_URL");
const apiUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const local = isLocalUrl(dbUrl) && isLocalUrl(apiUrl);
if (!local && !(args.has("--allow-remote") && appEnv === "staging")) {
  console.error("Refusing to seed a non-local database. For staging use APP_ENV=staging and --allow-remote.");
  process.exit(1);
}
const password = process.env.SEED_PASSWORD ?? "";
if (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  console.error("Set SEED_PASSWORD (12+ characters with letters and digits) for the synthetic sample accounts.");
  process.exit(1);
}

const admin = createClient(apiUrl, requireEnv("SUPABASE_SECRET_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
const ASSETS = join(__dirname, "..", "seed", "assets");
const day = 86_400_000;
const now = Date.now();
const iso = (offsetDays: number, hour?: number) => {
  const d = new Date(now + offsetDays * day);
  if (hour !== undefined) d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

type Person = { key: string; name: string; email: string; tz: string; locale?: "en" | "vi"; id?: string };
const people: Person[] = [
  { key: "admin", name: "Avery Morgan", email: `admin@${SAMPLE_DOMAIN}`, tz: "America/New_York" },
  { key: "mai", name: "Mai Trần", email: `mai.tran@${SAMPLE_DOMAIN}`, tz: "Asia/Ho_Chi_Minh" },
  { key: "daniel", name: "Daniel Okafor", email: `daniel.okafor@${SAMPLE_DOMAIN}`, tz: "America/New_York" },
  { key: "linh", name: "Linh Phạm", email: `linh.pham@${SAMPLE_DOMAIN}`, tz: "Asia/Ho_Chi_Minh" },
  ...[
    "Nguyễn Văn An", "Lê Thị Bình", "Hoàng Minh Châu", "Sofia Ramirez", "Kwame Mensah", "Priya Nair",
    "Jonas Weber", "Aiko Tanaka", "Đặng Quốc Huy", "Emily Carter", "Omar Haddad", "Võ Thanh Hà",
  ].map((name, i) => ({
    key: `p${i + 1}`,
    name,
    email: `participant${String(i + 1).padStart(2, "0")}@${SAMPLE_DOMAIN}`,
    tz: i % 3 === 0 ? "Asia/Ho_Chi_Minh" : i % 3 === 1 ? "America/New_York" : "Europe/Berlin",
  })),
];
const P = (key: string) => {
  const p = people.find((x) => x.key === key);
  if (!p?.id) throw new Error(`unknown person ${key}`);
  return p.id;
};

async function createUsers(db: Client) {
  for (const p of people) {
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email,
      password,
      email_confirm: true,
      user_metadata: { display_name: p.name },
    });
    if (error || !data.user) throw new Error(`createUser ${p.email}: ${error?.message}`);
    p.id = data.user.id;
    await db.query("update public.profiles set display_name = $2, timezone = $3, is_sample = true where id = $1", [p.id, p.name, p.tz]);
  }
  await db.query("insert into public.platform_role_grants (user_id, role) values ($1, 'platform_admin')", [P("admin")]);
}

async function uploadAsset(db: Client, opts: { owner: string; file: string; mime: string; versionId: string; title: string; description?: string }) {
  const body = readFileSync(join(ASSETS, opts.file));
  const id = crypto.randomUUID();
  const path = `lesson/${id}/${crypto.randomUUID()}`;
  const { error } = await admin.storage.from("course-content").upload(path, body, { contentType: opts.mime, upsert: false });
  if (error) throw new Error(`upload ${opts.file}: ${error.message}`);
  await db.query(
    `insert into public.content_assets (id, owner_id, purpose, bucket, object_path, filename, declared_mime, detected_mime, size_bytes,
       status, title, description, course_version_id, completed_at)
     values ($1, $2, 'lesson', 'course-content', $3, $4, $5, $5, $6, 'ready', $7, $8, $9, now())`,
    [id, opts.owner, path, opts.file, opts.mime, body.length, opts.title, opts.description ?? "", opts.versionId],
  );
  return id;
}

type LessonSpec = {
  key: string;
  title: string;
  type: "text" | "pdf" | "video" | "file" | "link" | "embed";
  body?: string;
  required?: boolean;
  minutes?: number;
  rule?: "acknowledge" | "video_watched";
  url?: string;
  transcript?: string;
  assets?: { file: string; mime: string; role: "primary" | "attachment" | "captions"; title: string; lang?: string }[];
};
type ModuleSpec = { key: string; title: string; description: string; lessons: LessonSpec[] };

const lineage: Record<string, string> = {};
const lin = (key: string) => (lineage[key] ??= crypto.randomUUID());

async function createVersion(db: Client, courseId: string, versionNo: number, title: string, meta: Record<string, string | string[]>,
                             modules: ModuleSpec[], owner: string, publish: boolean) {
  const { rows } = await db.query(
    `insert into public.course_versions (course_id, version_no, status, title, summary, objectives, audience, expected_effort,
       prerequisites_text, syllabus_html, grading_policy, created_by)
     values ($1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [courseId, versionNo, title, meta.summary, meta.objectives, meta.audience, meta.effort, meta.prereq, meta.syllabus, meta.grading, owner],
  );
  const versionId = rows[0].id as string;
  const lessonIds: Record<string, string> = {};
  for (const [mi, m] of modules.entries()) {
    const mod = await db.query(
      "insert into public.modules (course_version_id, lineage_id, position, title, description) values ($1, $2, $3, $4, $5) returning id",
      [versionId, lin(`${courseId}:${m.key}`), mi, m.title, m.description],
    );
    for (const [li, l] of m.lessons.entries()) {
      const les = await db.query(
        `insert into public.lessons (module_id, course_version_id, lineage_id, position, title, content_type, body_html, required,
           duration_minutes, completion_rule, external_url, transcript)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
        [mod.rows[0].id, versionId, lin(`${courseId}:${l.key}`), li, l.title, l.type, l.body ?? "", l.required ?? true,
         l.minutes ?? null, l.rule ?? "acknowledge", l.url ?? null, l.transcript ?? ""],
      );
      lessonIds[l.key] = les.rows[0].id;
      for (const [ai, a] of (l.assets ?? []).entries()) {
        const assetId = await uploadAsset(db, { owner, file: a.file, mime: a.mime, versionId, title: a.title });
        await db.query("insert into public.lesson_assets (lesson_id, asset_id, role, position, caption_language) values ($1, $2, $3, $4, $5)",
          [les.rows[0].id, assetId, a.role, ai, a.lang ?? null]);
      }
    }
  }
  if (publish) {
    await db.query("update public.course_versions set status = 'published', published_at = now(), published_by = $2 where id = $1", [versionId, owner]);
  }
  return { versionId, lessonIds };
}

const p = (s: string) => `<p>${s}</p>`;
const AAF_MODULES: ModuleSpec[] = [
  {
    key: "m1", title: "Getting started", description: "Orientation, core reading and the first lecture.",
    lessons: [
      { key: "l1", title: "Welcome and how this course works", type: "text", minutes: 10,
        body: p("<strong>SAMPLE CONTENT.</strong> Welcome to the Agentic AI Foundations sample course.") +
          "<ul><li>Work through each module in order.</li><li>Required items count toward completion; optional items do not.</li><li>Use Messages to contact your instructor.</li></ul>" },
      { key: "l2", title: "Reading: Agent architectures", type: "pdf", minutes: 20,
        body: p("Read the attached PDF. A download link is provided if the preview does not display."),
        assets: [{ file: "agent-architectures-reading.pdf", mime: "application/pdf", role: "primary", title: "Agent architectures (sample reading)" }] },
      { key: "l3", title: "Lecture: The agent loop", type: "video", minutes: 1, rule: "video_watched",
        body: p("Watch the short synthetic lecture. Captions are available from the player controls."),
        transcript: "SAMPLE TRANSCRIPT. Welcome to this Crew Scaler sample lecture. An agent loop observes, plans, acts, and checks the result. This video is synthetic test content created for the platform demo. Use the transcript and captions controls to follow along.",
        assets: [
          { file: "sample-lecture.mp4", mime: "video/mp4", role: "primary", title: "Sample lecture (MP4)" },
          { file: "sample-lecture.webm", mime: "video/webm", role: "primary", title: "Sample lecture (WebM)" },
          { file: "sample-lecture.en.vtt", mime: "text/vtt", role: "captions", title: "English captions", lang: "en" },
        ] },
      { key: "l4", title: "Optional: further reading", type: "link", required: false, minutes: 15, url: "https://example.com/",
        body: p("An optional external resource (placeholder link pending curriculum approval).") },
    ],
  },
  {
    key: "m2", title: "Tools and planning", description: "How agents use tools and plan multi-step work.",
    lessons: [
      { key: "l5", title: "Tool-use patterns", type: "text", minutes: 15, body: p("Agents call tools through well-defined interfaces. <em>Sample content.</em>") },
      { key: "l6", title: "Starter code download", type: "file", minutes: 10,
        body: p("Download the starter file. Code is provided as a text download and is never executed by the platform."),
        assets: [{ file: "starter_agent_loop.py", mime: "text/plain", role: "attachment", title: "Starter agent loop (Python, text)" }] },
      { key: "l7", title: "Planning strategies", type: "text", minutes: 20, body: p("Decompose goals into steps and check results. <em>Sample content.</em>") },
    ],
  },
  {
    key: "m3", title: "Evaluation", description: "Released later in the term.",
    lessons: [{ key: "l8", title: "Evaluating agents", type: "text", minutes: 20, body: p("How to evaluate agent behaviour. <em>Sample content.</em>") }],
  },
];

const META = (title: string) => ({
  summary: `SAMPLE: ${title} is an illustrative placeholder course pending Crew Scaler curriculum approval.`,
  objectives: ["Explain the core concepts", "Apply them in a guided exercise", "Evaluate results critically"],
  audience: "Global Cohort participants (sample)",
  effort: "3–4 hours per week (sample estimate)",
  prereq: "None for this sample course.",
  syllabus: p("Sample syllabus. Weekly modules, a quiz, and one project assignment."),
  grading: "Points-based: each released item contributes its points; exempt items are excluded. (Sample policy.)",
});

async function main() {
  const db = await connect();
  console.log("Purging previous sample data…");
  await purgeSampleData(db, admin);

  console.log("Creating synthetic accounts…");
  await createUsers(db);

  console.log("Creating program structure…");
  const cohorts = await db.query(
    `insert into public.cohorts (code, name, description, timezone, starts_on, ends_on, status, is_sample, created_by) values
     ('GC-FALL-2026', 'Global Cohort — Fall 2026 (sample)', 'Sample cohort for the fall term.', 'America/New_York', $1, $2, 'active', true, $5),
     ('GC-SPRING-2027', 'Global Cohort — Spring 2027 (sample)', 'Sample upcoming cohort.', 'Asia/Ho_Chi_Minh', $3, $4, 'upcoming', true, $5)
     returning id, code`,
    [iso(-40).slice(0, 10), iso(70).slice(0, 10), iso(90).slice(0, 10), iso(200).slice(0, 10), P("admin")],
  );
  const fall = cohorts.rows.find((r) => r.code === "GC-FALL-2026").id as string;
  const spring = cohorts.rows.find((r) => r.code === "GC-SPRING-2027").id as string;

  const courses = await db.query(
    `insert into public.courses (code, title, is_sample, created_by) values
     ('AAF', 'Agentic AI Foundations', true, $1), ('MASS', 'Multi-Agent Systems Security', true, $1), ('AIGE', 'AI Governance Essentials', true, $1)
     returning id, code`,
    [P("admin")],
  );
  const cid = (code: string) => courses.rows.find((r) => r.code === code).id as string;

  console.log("Uploading sample media and building course versions…");
  const aafV1 = await createVersion(db, cid("AAF"), 1, "Agentic AI Foundations", META("Agentic AI Foundations"), AAF_MODULES, P("mai"), true);
  // Draft v2: a revised copy (text lessons only) showing draft material that learners never see.
  const draftModules = AAF_MODULES.map((m) => ({
    ...m,
    lessons: m.lessons
      .filter((l) => !l.assets?.length)
      .map((l) => (l.key === "l1" ? { ...l, title: "Welcome and how this course works (revised draft)" } : l)),
  }));
  await createVersion(db, cid("AAF"), 2, "Agentic AI Foundations", META("Agentic AI Foundations"), draftModules, P("mai"), false);
  const massV1 = await createVersion(db, cid("MASS"), 1, "Multi-Agent Systems Security", META("Multi-Agent Systems Security"), [
    { key: "m1", title: "Threat models", description: "How multi-agent systems fail.", lessons: [
      { key: "s1", title: "Attack surfaces in agent systems", type: "text", minutes: 20, body: p("Prompt injection, tool abuse and data leakage. <em>Sample content.</em>") },
      { key: "s2", title: "Trust boundaries", type: "text", minutes: 20, body: p("Separate what each agent may read and do. <em>Sample content.</em>") },
    ] },
    { key: "m2", title: "Securing agent communication", description: "Authentication and least privilege.", lessons: [
      { key: "s3", title: "Least privilege for tools", type: "text", minutes: 25, body: p("Grant only the tools a task needs. <em>Sample content.</em>") },
    ] },
  ], P("daniel"), true);
  const aigeV1 = await createVersion(db, cid("AIGE"), 1, "AI Governance Essentials", META("AI Governance Essentials"), [
    { key: "m1", title: "Governance foundations", description: "Policies and accountability.", lessons: [
      { key: "g1", title: "Why governance matters", type: "text", minutes: 15, body: p("Sample content.") },
      { key: "g2", title: "Risk registers", type: "text", minutes: 20, body: p("Sample content.") },
    ] },
  ], P("mai"), true);

  const off = await db.query(
    `insert into public.course_offerings (course_id, course_version_id, cohort_id, code, term_label, starts_at, ends_at, timezone, status,
        accent_color, catalog_visible, catalog_state, is_sample, created_by) values
     ($1, $2, $3, 'AAF-F26', 'Fall 2026', $9, $10, 'America/New_York', 'published', '#2563EB', true, 'not_open', true, $15),
     ($4, $5, $3, 'MASS-F26', 'Fall 2026', $11, $10, 'America/New_York', 'published', '#BE185D', true, 'open_for_requests', true, $15),
     ($1, $2, $6, 'AAF-S27', 'Spring 2027', $12, $13, 'Asia/Ho_Chi_Minh', 'published', '#0369A1', true, 'open_for_requests', true, $15),
     ($7, $8, $3, 'AIGE-SUM26', 'Summer 2026', $14, $16, 'America/New_York', 'archived', '#475569', false, 'not_open', true, $15)
     returning id, code`,
    [cid("AAF"), aafV1.versionId, fall, cid("MASS"), massV1.versionId, spring, cid("AIGE"), aigeV1.versionId,
     iso(-30), iso(60), iso(-20), iso(90), iso(180), iso(-120), P("admin"), iso(-30)],
  );
  const O = (code: string) => off.rows.find((r) => r.code === code).id as string;
  const aaf = O("AAF-F26"), mass = O("MASS-F26"), aafS = O("AAF-S27"), aige = O("AIGE-SUM26");

  await db.query(
    `insert into public.staff_assignments (offering_id, user_id, role, can_author, can_grade, can_publish_grades) values
     ($1, $5, 'instructor', true, true, true), ($1, $6, 'ta', false, true, false), ($2, $7, 'instructor', true, true, true),
     ($3, $5, 'instructor', true, true, true), ($4, $5, 'instructor', true, true, true)`,
    [aaf, mass, aafS, aige, P("mai"), P("linh"), P("daniel")],
  );
  const enroll = async (offering: string, keys: string[], status = "active") => {
    for (const k of keys) {
      await db.query("insert into public.enrollments (offering_id, user_id, status, source) values ($1, $2, $3, 'seed')", [offering, P(k), status]);
    }
  };
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `p${a + i}`);
  await enroll(aaf, [...range(1, 8), "daniel"]);
  await enroll(mass, range(5, 12));
  await enroll(aafS, range(9, 12));
  await enroll(aige, range(1, 4), "completed");
  for (const k of range(1, 12)) await db.query("insert into public.cohort_participation (cohort_id, user_id) values ($1, $2)", [fall, P(k)]);
  for (const k of range(9, 12)) await db.query("insert into public.cohort_participation (cohort_id, user_id) values ($1, $2)", [spring, P(k)]);

  console.log("Prerequisites and release rules…");
  const L = (k: string) => lineage[`${cid("AAF")}:${k}`];

  console.log("Quizzes…");
  const quizRow = await db.query(
    `insert into public.quizzes (offering_id, module_lineage, title, available_from, closes_at, time_limit_minutes, attempt_limit, pass_pct,
       shuffle_choices, review_policy, score_release, created_by)
     values ($1, $2, 'Quiz 1: Foundations check', $3, $4, 20, 2, 70, true, 'after_close', 'manual', $5) returning id`,
    [aaf, lin(`${cid("AAF")}:m1`), iso(-10), iso(10), P("mai")],
  );
  const quiz1 = quizRow.rows[0].id as string;
  const practiceRow = await db.query(
    `insert into public.quizzes (offering_id, title, available_from, closes_at, attempt_limit, pass_pct, review_policy, score_release, created_by)
     values ($1, 'Practice quiz: agent vocabulary', $2, $3, 3, 50, 'after_submit', 'immediate', $4) returning id`,
    [aaf, iso(-10), iso(30), P("mai")],
  );
  const practice = practiceRow.rows[0].id as string;
  await db.query(
    "insert into public.quizzes (offering_id, title, attempt_limit, created_by) values ($1, 'Security basics check (draft)', 1, $2)",
    [mass, P("daniel")],
  );

  await asUser(db, P("mai"), async () => {
    const v1 = (await db.query("select id from public.quiz_versions where quiz_id = $1", [quiz1])).rows[0].id;
    await db.query("select public.update_quiz_instructions($1, $2)", [v1, "Answer all four questions. Short answers are graded by your instructor. (Sample quiz.)"]);
    await db.query("select public.upsert_question($1, null, 'single_choice', $2, 2, $3, $4, $5, 0)", [v1,
      "Which step comes right after planning in a basic agent loop?",
      JSON.stringify([{ id: "a", text: "Observe" }, { id: "b", text: "Act" }, { id: "c", text: "Retire" }, { id: "d", text: "Archive" }]),
      ["b"], "After planning, the agent acts (for example by calling a tool)."]);
    await db.query("select public.upsert_question($1, null, 'multiple_select', $2, 3, $3, $4, $5, 1)", [v1,
      "Select all components of a typical agent.",
      JSON.stringify([{ id: "a", text: "A model" }, { id: "b", text: "Tools" }, { id: "c", text: "Memory" }, { id: "d", text: "A spreadsheet macro" }]),
      ["a", "b", "c"], "Model, tools and memory; scoring is all-or-nothing."]);
    await db.query("select public.upsert_question($1, null, 'true_false', $2, 1, null, $3, $4, 2)", [v1,
      "Watching a lecture video to the end proves the learner mastered the topic.", ["false"], "Playback is not evidence of learning."]);
    await db.query("select public.upsert_question($1, null, 'short_answer', $2, 4, null, null, $3, 3)", [v1,
      "In one or two sentences, explain why evaluation matters in agent systems.", "Look for: catching errors before they compound; measuring quality."]);
    await db.query("select public.publish_quiz_version($1)", [v1]);

    const pv = (await db.query("select id from public.quiz_versions where quiz_id = $1", [practice])).rows[0].id;
    await db.query("select public.upsert_question($1, null, 'true_false', $2, 1, null, $3, $4, 0)", [pv, "A tool is an external capability an agent can call.", ["true"], ""]);
    await db.query("select public.upsert_question($1, null, 'single_choice', $2, 1, $3, $4, $5, 1)", [pv, "What does an agent keep across steps?",
      JSON.stringify([{ id: "a", text: "Memory/state" }, { id: "b", text: "Nothing" }]), ["a"], ""]);
    await db.query("select public.publish_quiz_version($1)", [pv]);
  });
  // Practice quizzes give feedback but do not count toward the course total.
  await db.query("update public.grade_items set counts_toward_total = false where quiz_id = $1", [practice]);

  await db.query(
    `insert into public.prerequisite_rules (offering_id, target_lesson_lineage, kind, required_lesson_lineage, quiz_id, min_score_pct, release_at) values
     ($1, $2, 'lesson_complete', $3, null, null, null),
     ($1, $4, 'quiz_min_score', null, $5, 70, null),
     ($1, $6, 'release_at', null, null, null, $7),
     ($1, $8, 'lesson_complete', $2, null, null, null)`,
    [aaf, L("l5"), L("l3"), L("l7"), quiz1, L("l8"), iso(14), L("l6")],
  );
  await db.query("insert into public.quiz_accommodations (quiz_id, user_id, extra_minutes, note, granted_by) values ($1, $2, 10, 'Sample accommodation', $3)",
    [quiz1, P("p3"), P("mai")]);

  console.log("Assignments…");
  const asg = await db.query(
    `insert into public.assignments (offering_id, module_lineage, title, instructions_html, submission_types, points, rubric, available_from, due_at, closes_at,
       late_policy, max_submissions, status, created_by) values
     ($1, $2, 'Project: design an agent loop', $3, array['text','file','url'], 100, $4, $5, $6, $7, 'accept_flag', 3, 'published', $8),
     ($1, null, 'Reflection journal (week 2)', $9, array['text'], 20, '[]', $10, $11, $12, 'reject', 1, 'published', $8)
     returning id, title`,
    [aaf, lin(`${cid("AAF")}:m2`),
     p("Describe an agent loop for a task of your choice. Submit text, a file and/or a repository link. <em>Sample assignment.</em>"),
     JSON.stringify([{ id: "clarity", criterion: "Clarity of design", points: 40 }, { id: "safety", criterion: "Safety considerations", points: 30 }, { id: "eval", criterion: "Evaluation plan", points: 30 }]),
     iso(-14), iso(7), iso(14), P("mai"), p("Write a short reflection. <em>Sample assignment.</em>"), iso(-20), iso(-2), iso(-1)],
  );
  const project = asg.rows.find((r) => r.title.startsWith("Project")).id as string;
  const journal = asg.rows.find((r) => r.title.startsWith("Reflection")).id as string;
  await db.query("insert into public.assignments (offering_id, title, instructions_html, points, status, created_by) values ($1, 'Final project (archived)', $2, 100, 'published', $3)",
    [aige, p("Archived sample assignment."), P("mai")]);

  console.log("Learner activity through the real RPCs…");
  // Progress
  for (const [k, lessons] of [["p1", ["l1", "l2", "l3", "l5", "l6"]], ["p2", ["l1"]], ["daniel", ["l1", "l2"]]] as const) {
    await asUser(db, P(k), async () => {
      for (const l of lessons) {
        if (l === "l3") await db.query("select public.mark_lesson_progress($1, $2, 20, 20, false)", [aaf, aafV1.lessonIds.l3]);
        await db.query("select public.mark_lesson_progress($1, $2, 0, null, true)", [aaf, aafV1.lessonIds[l]]);
      }
    });
  }
  await asUser(db, P("p2"), () => db.query("select public.mark_lesson_progress($1, $2, 8, 20, false)", [aaf, aafV1.lessonIds.l3]));

  // Quiz attempts
  const answerAll = async (userKey: string, answers: Record<number, unknown>, submit = true) =>
    asUser(db, P(userKey), async () => {
      const attempt = (await db.query("select public.start_quiz_attempt($1) as id", [quiz1])).rows[0].id as string;
      const view = (await db.query("select public.get_attempt($1) as a", [attempt])).rows[0].a as { questions: { id: string }[] };
      for (const [i, q] of view.questions.entries()) {
        if (answers[i] !== undefined) await db.query("select public.save_attempt_answer($1, $2, $3)", [attempt, q.id, JSON.stringify(answers[i])]);
      }
      if (submit) await db.query("select public.submit_quiz_attempt($1)", [attempt]);
      return attempt;
    });
  const correct = { 0: { choice: "b" }, 1: { choices: ["a", "b", "c"] }, 2: { choice: "false" }, 3: { text: "Evaluation catches mistakes before they compound across steps." } };
  const anAttempt = await answerAll("p1", correct);
  await answerAll("p2", { 0: { choice: "b" }, 1: { choices: ["a", "b"] }, 2: { choice: "false" }, 3: { text: "It shows whether the agent did the right thing." } });
  await answerAll("p4", { 0: { choice: "a" } }, false); // in progress
  await asUser(db, P("p5"), async () => {
    const a = (await db.query("select public.start_quiz_attempt($1) as id", [practice])).rows[0].id;
    const view = (await db.query("select public.get_attempt($1) as a", [a])).rows[0].a as { questions: { id: string; type: string }[] };
    for (const q of view.questions) {
      await db.query("select public.save_attempt_answer($1, $2, $3)", [a, q.id, JSON.stringify(q.type === "true_false" ? { choice: "true" } : { choice: "a" })]);
    }
    await db.query("select public.submit_quiz_attempt($1)", [a]);
  });
  await asUser(db, P("mai"), async () => {
    const q4 = (await db.query("select id from public.questions where quiz_version_id = (select quiz_version_id from public.quiz_attempts where id = $1) and position = 3", [anAttempt])).rows[0].id;
    await db.query("select public.grade_attempt_question($1, $2, 3, 'Good point about compounding errors.')", [anAttempt, q4]);
    const g = (await db.query("select id from public.grades where user_id = $1 and grade_item_id = (select id from public.grade_items where quiz_id = $2)", [P("p1"), quiz1])).rows[0].id;
    await db.query("select public.publish_grades($1, $2)", [aaf, [g]]);
  });

  // Assignment submissions
  const submit = async (k: string, text: string, url?: string) =>
    asUser(db, P(k), async () => {
      await db.query("select public.save_submission_draft($1, $2, $3, '{}')", [project, text, url ?? null]);
      return (await db.query("select public.submit_assignment($1, $2) as r", [project, crypto.randomUUID()])).rows[0].r;
    });
  await submit("p1", "My agent loop plans a literature review in three steps. (Sample submission.)", "https://example.com/sample-repo");
  await submit("p2", "An agent that triages support tickets. (Sample submission.)");
  await submit("p3", "A research assistant loop with explicit evaluation. (Sample submission.)");
  await asUser(db, P("p4"), () => db.query("select public.save_submission_draft($1, 'Draft notes only (sample)', null, '{}')", [project]));
  await asUser(db, P("p6"), async () => {
    await db.query("select public.save_submission_draft($1, 'Week 2 reflection (sample).', null, '{}')", [journal]);
  });
  await asUser(db, P("mai"), async () => {
    const s = (k: string) => db.query("select id from public.submissions where assignment_id = $1 and user_id = $2", [project, P(k)]).then((r) => r.rows[0].id);
    await db.query("select public.grade_submission($1, 85, 'Clear plan; add an evaluation metric.', $2, false, null)", [await s("p1"), JSON.stringify({ clarity: 35, safety: 25, eval: 25 })]);
    await db.query("select public.grade_submission($1, 78, 'Draft feedback (not yet published).', $2, false, null)", [await s("p2"), JSON.stringify({ clarity: 30, safety: 25, eval: 23 })]);
    const journalItem = (await db.query("select id from public.grade_items where assignment_id = $1", [journal])).rows[0].id;
    await db.query("select public.set_grade($1, $2, 'missing', null, 'No submission received.')", [journalItem, P("p5")]);
    await db.query("select public.set_grade($1, $2, 'exempt', null, 'Excused (sample).')", [journalItem, P("p6")]);
    const part = (await db.query("insert into public.grade_items (offering_id, kind, title, max_points) values ($1, 'participation', 'Class Participation', 10) returning id", [aaf])).rows[0].id;
    for (const [k, pts] of [["p1", 9], ["p2", 8], ["p3", 10], ["p4", 7]] as const) await db.query("select public.set_grade($1, $2, 'graded', $3, '')", [part, P(k), pts]);
    const toPublish = (await db.query(
      "select g.id from public.grades g where g.offering_id = $1 and ((g.user_id = $2 and g.grade_item_id in (select id from public.grade_items where assignment_id = $3)) or g.grade_item_id = $4 and g.user_id in ($2, $5) or g.grade_item_id = (select id from public.grade_items where assignment_id = $6))",
      [aaf, P("p1"), project, part, P("p2"), journal])).rows.map((r) => r.id);
    await db.query("select public.publish_grades($1, $2)", [aaf, toPublish]);
  });
  // Archived course: final grades + completion
  const aigeItem = (await db.query("select id from public.grade_items where offering_id = $1", [aige])).rows[0].id;
  await db.query("update public.enrollments set status = 'active' where offering_id = $1", [aige]);
  await db.query("update public.course_offerings set status = 'published' where id = $1", [aige]);
  for (const [i, k] of range(1, 4).entries()) {
    await asUser(db, P(k), async () => {
      for (const l of ["g1", "g2"]) await db.query("select public.mark_lesson_progress($1, $2, 0, null, true)", [aige, aigeV1.lessonIds[l]]);
    });
    await asUser(db, P("mai"), async () => {
      await db.query("select public.set_grade($1, $2, 'graded', $3, '')", [aigeItem, P(k), 80 + i * 4]);
      const g = (await db.query("select id from public.grades where grade_item_id = $1 and user_id = $2", [aigeItem, P(k)])).rows[0].id;
      await db.query("select public.publish_grades($1, $2)", [aige, [g]]);
    });
  }
  await db.query("update public.course_offerings set status = 'archived' where id = $1", [aige]);
  await db.query("update public.enrollments set status = 'completed' where offering_id = $1", [aige]);

  console.log("Communication…");
  await asUser(db, P("mai"), async () => {
    await db.query(`insert into public.announcements (offering_id, title, body_html, status, pinned, created_by) values
      ($1, 'Welcome to Agentic AI Foundations', $2, 'published', true, $3)`, [aaf, p("Welcome! Start with Module 1. <em>Sample announcement.</em>"), P("mai")]);
    await db.query(`insert into public.announcements (offering_id, title, body_html, status, publish_at, created_by) values
      ($1, 'Office hours moved to Thursday', $2, 'published', $4, $3),
      ($1, 'Week 5 preview (draft)', $5, 'draft', null, $3)`,
      [aaf, p("Scheduled sample announcement."), P("mai"), iso(2), p("Draft sample.")]);
  });
  await asUser(db, P("admin"), () => db.query(`insert into public.announcements (cohort_id, title, body_html, status, created_by) values
    ($1, 'Cohort orientation recording available', $2, 'published', $3)`, [fall, p("The orientation recording is in Tools. <em>Sample.</em>"), P("admin")]));
  await db.query(`insert into public.calendar_events (offering_id, cohort_id, kind, title, description, starts_at, ends_at, timezone, meeting_url, created_by) values
    ($1, null, 'live_session', 'Live session: agent loops', 'Weekly live session (sample).', $2, $3, 'America/New_York', 'https://meet.example.com/sample-session', $7),
    ($1, null, 'live_session', 'Live session: tool use', 'Weekly live session (sample).', $4, $5, 'America/New_York', 'https://meet.example.com/sample-session', $7),
    ($1, null, 'office_hours', 'Office hours with Mai', 'Drop-in questions (sample).', $8, $9, 'Asia/Ho_Chi_Minh', null, $7),
    (null, $6, 'event', 'Fall cohort community mixer', 'Optional social event (sample).', $10, $11, 'America/New_York', null, $12)`,
    [aaf, iso(3, 13), iso(3, 14), iso(10, 13), iso(10, 14), fall, P("mai"), iso(5, 13), iso(5, 14), iso(8, 23), iso(9, 0), P("admin")]);

  const topic = await asUser(db, P("mai"), async () =>
    (await db.query("insert into public.discussion_topics (offering_id, title, body_html, pinned, created_by) values ($1, 'Introduce yourself', $2, true, $3) returning id",
      [aaf, p("Share your name, location and what you hope to learn. <em>Sample topic.</em>"), P("mai")])).rows[0].id as string);
  await asUser(db, P("mai"), () => db.query("insert into public.discussion_topics (offering_id, title, body_html, created_by) values ($1, 'Week 1 questions', $2, $3)",
    [aaf, p("Ask anything about Module 1."), P("mai")]));
  const firstPost = await asUser(db, P("p1"), async () =>
    (await db.query("insert into public.discussion_posts (topic_id, author_id, body_html) values ($1, $2, $3) returning id",
      [topic, P("p1"), p("Xin chào! I'm An from Hà Nội, interested in planning agents. (Sample post.)")])).rows[0].id as string);
  await asUser(db, P("p4"), () => db.query("insert into public.discussion_posts (topic_id, author_id, body_html) values ($1, $2, $3)",
    [topic, P("p4"), p("Hi all, Sofia here from Madrid. (Sample post.)")]));
  await asUser(db, P("p2"), () => db.query("insert into public.discussion_posts (topic_id, parent_id, author_id, body_html) values ($1, $2, $3, $4)",
    [topic, firstPost, P("p2"), p("Chào An! Same here. (Sample reply.)")]));
  const lounge = await db.query("insert into public.communities (cohort_id, name, description, join_policy, is_sample, created_by) values (null, 'Global Cohort Community Lounge (sample)', 'Optional community space. Joining it does not grant access to any course.', 'open', true, $1) returning id", [P("admin")]);
  await db.query("insert into public.communities (cohort_id, name, description, join_policy, is_sample, created_by) values ($1, 'Fall 2026 Study Circle (sample)', 'Optional peer study group for the fall cohort.', 'open', true, $2)", [fall, P("admin")]);
  for (const k of ["p1", "p2", "p7"]) await db.query("insert into public.community_members (community_id, user_id) values ($1, $2)", [lounge.rows[0].id, P(k)]);
  await asUser(db, P("p1"), () => db.query("insert into public.discussion_topics (community_id, title, body_html, created_by) values ($1, 'Study tips that work for you', $2, $3)",
    [lounge.rows[0].id, p("Share a study habit. (Sample.)"), P("p1")]));

  const thread = await asUser(db, P("mai"), async () =>
    (await db.query("select public.create_thread($1, null, $2, 'Feedback on your project plans', $3, '{}', false, null) as id",
      [aaf, [P("p1"), P("p2")], "Hi both, I left comments on your plans. Let me know if you have questions. (Sample message.)"])).rows[0].id as string);
  await asUser(db, P("p1"), () => db.query("select public.send_message($1, 'Thank you! I will revise the evaluation section. (Sample reply.)', '{}', null)", [thread]));
  await asUser(db, P("admin"), () => db.query("select public.create_thread(null, $1, $2, 'Welcome to the fall cohort', 'Welcome everyone! (Sample cohort message.)', '{}', false, null)",
    [fall, [P("p1"), P("p3")]]));

  console.log("Tools, settings, invitations, requests…");
  await db.query(`insert into public.tool_resources (offering_id, cohort_id, category, title, description, body_html, url, position, created_by) values
    (null, null, 'setup', 'Technical setup checklist', 'Browser, audio and network checks before your first session.', $1, null, 0, $4),
    (null, null, 'policy', 'Participation policy (sample — pending owner review)', 'Placeholder policy text for review.', $2, null, 1, $4),
    (null, null, 'support', 'Getting help', 'How to reach support.', $3, null, 2, $4),
    ($5, null, 'resource', 'Sample course repository', 'Placeholder link to course code.', '', 'https://example.com/sample-repo', 0, $6),
    (null, $7, 'resource', 'Orientation recording (sample)', 'Placeholder link.', '', 'https://example.com/orientation', 0, $4)`,
    [p("Use a current version of Chrome, Edge, Firefox or Safari. Test your microphone before live sessions."),
     p("SAMPLE policy text. The program owner must supply and approve the real participation policy."),
     p("Use Messages to contact your instructor. The program support contact has not been configured yet."),
     P("admin"), aaf, P("mai"), fall]);
  await db.query("insert into public.platform_settings (key, value) values ('public_catalog', 'true') on conflict (key) do update set value = excluded.value");
  await db.query(`insert into public.invitations (email, role, cohort_id, offering_id, expires_at, created_by) values
    ($1, 'participant', $2, $3, $4, $5), ($6, 'participant', $2, $3, $7, $5)`,
    [`new.participant@${SAMPLE_DOMAIN}`, fall, aaf, iso(14), P("admin"), `expired.invite@${SAMPLE_DOMAIN}`, iso(-1)]);
  await asUser(db, P("p1"), () => db.query("select public.request_access($1, 'I would like to join the security course. (Sample request.)')", [mass]));
  await asUser(db, P("p1"), () => db.query("insert into public.favorites (user_id, offering_id) values ($1, $2)", [P("p1"), aaf]));

  await db.end();
  console.log("\nSample seed complete. Synthetic accounts (password from SEED_PASSWORD):");
  for (const person of people) console.log(`  ${person.email.padEnd(44)} ${person.name}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
