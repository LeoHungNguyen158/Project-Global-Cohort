import { expect as baseExpect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sampleEmail, signIn } from "./helpers";

// The owner's demo path, end to end, at desktop width: the platform administrator sets up
// a cohort, a course and an offering, assigns Mai Trần as instructor and invites two new
// learners by email (Mailpit); Mai builds and releases the content, a quiz and an
// assignment; learner A works through it, is graded and reads the feedback; learner B
// sees none of A's work. Everything is created with a run suffix, so the spec reruns
// against the same seeded database. afterAll retires what the run created (learners
// withdrawn, Mai unassigned, offering/course/cohort archived); WALKTHROUGH_KEEP=1 keeps it.

// Server actions re-render pages on the shared dev server, which can be slow while other
// routes compile: every assertion may wait up to 30 s (passing checks return at once).
const expect = baseExpect.configure({ timeout: 30_000 });

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const NOT_AVAILABLE = { level: 1, name: "Page not available" } as const;
const DAY = 86_400_000;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const S = Date.now().toString(36);
const TZ = "Asia/Ho_Chi_Minh";
const COHORT = { code: `WALK-${S}`, name: `Owner walkthrough cohort ${S}` };
const COURSE = { code: `WALK-${S}-C`, title: `Owner walkthrough course ${S}` };
const OFFERING_CODE = `WALK-${S}-OFF`;
const INSTRUCTOR = { local: "mai.tran", name: "Mai Trần" };
// Same sample domain and pattern as admin.spec.ts; the passwords are set through the invitation link.
const LEARNER_A = { email: sampleEmail(`walk-la-${S}`), name: `Walkthrough Learner A ${S}`, password: `Walk-A-${S}-2026` };
const LEARNER_B = { email: sampleEmail(`walk-lb-${S}`), name: `Walkthrough Learner B ${S}`, password: `Walk-B-${S}-2026` };
type Learner = typeof LEARNER_A;

const T = {
  module: `Week 1: Agent architectures ${S}`,
  reading: `Reading: agent architectures ${S}`,
  video: `Lecture: the agent loop ${S}`,
  quiz: `Check-in quiz ${S}`,
  question: `Which step checks an agent's results? ${S}`,
  correct: `Observe the results ${S}`,
  wrong: `Skip the checks ${S}`,
  assignment: `Agent loop design ${S}`,
  answer: `My agent observes, plans, acts and checks each tool result ${S}`,
  feedback: `Clear loop, add an evaluation plan next time ${S}`,
  subjectA: `Question about the reading ${S}`,
  bodyA: `Hello Mai, is chapter 2 required for the quiz? ${S}`,
  subjectB: `Office hours request ${S}`,
  bodyB: `Hello Mai, could we meet this week? ${S}`,
};

const PDF = "seed/assets/agent-architectures-reading.pdf";
/** The 12-second, 1.1 KB VP8 WebM (a plain blue frame) used by learning.spec.ts. */
const VIDEO = {
  name: "agent-loop-lecture.webm",
  mimeType: "video/webm",
  buffer: Buffer.from(
    "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAQsEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTD" +
    "Z1OsggEeTbuMU6uEHFO7a1OsggQW7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiEDHcAAAAAAAFlSua8Gu" +
    "AQAAAAAAADjXgQFzxYiOrjTkfq9q5JyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhDuaygDgibCBILqBEpqBAhJUw2f8c3OgY8CAZ8iaRaOHRU5DT0RFUkSH" +
    "jUxhdmY2MC4xNi4xMDBzc9ZjwItjxYiOrjTkfq9q5GfIoUWjh0VOQ09ERVJEh5RMYXZjNjAuMzEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6" +
    "MTIuMDAwMDAwMDAwAB9DtnVBPOeBAKO9gQAAgNACAJ0BKiAAEgAAxwiFhYiZhIgEggJ1qgP4AgghKZ5w/vmo7/+e0fntH57R/57R/9Tj8nH5OP6ygKOwgQPo" +
    "ANEBAAMQEAAYAB5X9AwAQQ4A/v0hRf/wF/+Av/wF//4C//98CfeBPvAn+2wAo7CBB9AA0QEAAxAQABgAHlf0DABBDgD+/SFF//AX/4C//AX//gL//3wJ94E+" +
    "8Cf7bACjsIELuADRAQADEBAAGAAeV/QMAEEOAP79IUX/8Bf/gL/8Bf/+Av//fAn3gT7wJ/tsAKOwgQ+gANEBAAMQEAAYAB5X9AwAQQ4A/v0hRf/wF/+Av/wF" +
    "//4C//98CfeBPvAn+2wAo7CBE4gA0QEAAxAQABgAHlf0DABBDgD+/SFF//AX/4C//AX//gL//3wJ94E+8Cf7bAAfQ7Z1QS/nghdwo7CBAAAA0QEAAxAQABgA" +
    "Hlf0DABBDgD+/SFF//AX/4C//AX//gL//3wJ94E+8Cf7bACjs4ED6ADxAQADEBgUYCADUAEbdJBGgQD++3sX/7DP9hn+wz/+wz//s7vTu9O7++G5VH+AgKOv" +
    "gQfQANEBAAMQEAAYAB5X9AwAQQ4A/v0hRf/wF/4C/8Bf/+Av//fAneBO8Cf7bACjr4ELuADRAQADEBAAGAAeV/QMAEEOAP79IUX/8Bf+Av/AX//gL//3wJ3g" +
    "TvAn+2wAo6+BD6AA0QEAAxAQABgAHlf0DABBDgD+/SFF//AX/gL/wF//4C//98Cd4E7wJ/tsAKOvgROIANEBAAMQEAAYAB5X9AwAQQ4A/v0hRf/wF/4C/8Bf" +
    "/+Av//fAneBO8Cf7bAAcU7trkbuPs4EAt4r3gQHxggGf8IED",
    "base64",
  ),
};

/** Due at noon in Mai's zone, ten days out: the same calendar day for viewers from UTC-5 to UTC+7. */
const DUE = (() => {
  const day = new Date(Date.now() + 10 * DAY);
  const ymd = day.toISOString().slice(0, 10);
  const instant = new Date(`${ymd}T05:00:00Z`); // 12:00 in Ho Chi Minh City (UTC+7)
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...o, timeZone: "UTC" }).format(instant);
  return {
    ymd,
    wall: `${ymd}T12:00`,
    heading: fmt({ weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    short: fmt({ month: "short", day: "numeric", year: "numeric" }),
  };
})();

const state = {
  cohortId: "",
  courseId: "",
  offeringId: "",
  quizId: "",
  attemptId: "",
  assignmentId: "",
  submissionId: "",
  threadA: "",
  lessons: { reading: "", video: "" },
};
const course = () => `/courses/${state.offeringId}`;

// ---------------------------------------------------------------------------
// Helpers (patterns from admin, account, learning, assessment, grades-calendar and comms specs)
// ---------------------------------------------------------------------------

function service(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required to retire the walkthrough fixtures.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => undefined)));
});

async function newContext(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  contexts.push(context);
  return context.newPage();
}

/** A seeded account (SEED_PASSWORD), retried once when the shared server is slow to answer. */
async function asSeeded(browser: Browser, who: string): Promise<Page> {
  const page = await newContext(browser);
  try {
    await signIn(page, who);
  } catch {
    const done = await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }).then(
      () => true,
      () => false,
    );
    if (!done) await signIn(page, who);
  }
  return page;
}

/** A learner created by this run, signing in with the password they chose. */
async function asLearner(browser: Browser, learner: Learner): Promise<Page> {
  const page = await newContext(browser);
  await page.goto("/login");
  await page.getByLabel("Email address").fill(learner.email);
  await page.getByLabel("Password").fill(learner.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
  return page;
}

/** Opens a page and waits until it is idle (hydrated), so forms run their client-side handlers. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/** Waits until React has hydrated the element, so clicks and typing reach its handlers. */
async function hydrated(target: Locator): Promise<Locator> {
  await expect(target).toBeVisible();
  await expect.poll(() => target.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$"))), { timeout: 30_000 }).toBe(true);
  return target;
}

/** Clicks a dialog's trigger until the dialog is open (a click before hydration does nothing). */
async function openDialog(trigger: Locator, dialog: Locator): Promise<Locator> {
  await expect(async () => {
    if (!(await dialog.isVisible())) await trigger.click({ timeout: 5_000 });
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  return dialog;
}

async function expectNotAvailable(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", NOT_AVAILABLE), path).toBeVisible();
}

const idFrom = (value: string | null | undefined): string => {
  const id = value?.match(UUID)?.[0] ?? "";
  expect(id, `uuid in ${value}`).toMatch(UUID);
  return id;
};

/** "YYYY-MM-DDTHH:mm" wall time in a zone, for a datetime-local input. */
function wallTime(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

type MailSummary = { ID: string; Subject: string };
async function mailsTo(address: string): Promise<MailSummary[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  return ((await res.json()) as { messages?: MailSummary[] }).messages ?? [];
}

async function confirmLink(messageId: string): Promise<string> {
  const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messageId}`)).json()) as { HTML: string; Text: string };
  const match = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(msg.HTML) ?? /(https?:\/\/\S*\/auth\/confirm\S*)/.exec(msg.Text);
  if (!match) throw new Error("The invitation email has no /auth/confirm link");
  return match[1].replaceAll("&amp;", "&");
}

// ---------------------------------------------------------------------------

test.describe("owner walkthrough", () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(async () => {
    if (process.env.WALKTHROUGH_KEEP === "1") return;
    // Nobody keeps seeing this run's data: learners withdrawn, Mai unassigned, the offering,
    // course and cohort archived. Accounts and messages stay (synthetic, on the sample domain).
    const db = service();
    if (state.offeringId) {
      await db.from("enrollments").update({ status: "withdrawn" }).eq("offering_id", state.offeringId);
      await db.from("staff_assignments").delete().eq("offering_id", state.offeringId);
      await db.from("course_offerings").update({ status: "archived" }).eq("id", state.offeringId);
    }
    if (state.courseId) await db.from("courses").update({ archived_at: new Date().toISOString() }).eq("id", state.courseId).is("archived_at", null);
    if (state.cohortId) await db.from("cohorts").update({ status: "archived" }).eq("id", state.cohortId);
  });

  test("1. the administrator sets up a cohort, course and offering, assigns an instructor and invites two learners who accept", async ({ browser, baseURL }) => {
    test.setTimeout(420_000);
    const admin = await asSeeded(browser, "admin");

    await test.step("create the cohort", async () => {
      await open(admin, "/admin/cohorts");
      await admin.getByText("Create a cohort").click();
      await admin.locator("#new-cohort-code").fill(COHORT.code);
      await admin.locator("#new-cohort-name").fill(COHORT.name);
      await admin.locator("#new-cohort-timezone").selectOption(TZ);
      await admin.getByRole("button", { name: "Create cohort" }).click();
      await admin.waitForURL(/\/admin\/cohorts\/[0-9a-f-]{36}\?created=1$/, { timeout: 30_000 });
      state.cohortId = idFrom(new URL(admin.url()).pathname);
      await expect(admin.getByText("Cohort created.")).toBeVisible();
    });

    await test.step("create the course (Administration → Courses) with its empty draft", async () => {
      await open(admin, "/admin");
      await admin.getByRole("navigation", { name: "Administration sections" }).getByRole("link", { name: "Courses" }).click();
      await expect(admin).toHaveURL(/\/admin\/courses$/);
      await admin.waitForLoadState("networkidle");
      await admin.locator("#course-code").fill(COURSE.code);
      await admin.locator("#course-title").fill(COURSE.title);
      await admin.getByRole("button", { name: "Create course" }).click();
      await admin.waitForURL(/\/admin\/courses\/[0-9a-f-]{36}\?created=1$/, { timeout: 30_000 });
      state.courseId = idFrom(new URL(admin.url()).pathname);
      await expect(admin.getByText("Course created with an empty draft version 1.")).toBeVisible();
    });

    await test.step("create an offering of the course in the cohort", async () => {
      await admin.getByRole("link", { name: "New offering of this course" }).click();
      await admin.waitForURL(/\/admin\/offerings\/new\?course=/);
      await admin.waitForLoadState("networkidle");
      // The course's draft version is preselected: the instructor publishes it later.
      const draftOption = admin.locator(`#new-version optgroup[label^="${COURSE.code} "] option`);
      await expect(draftOption).toHaveCount(1);
      await expect(admin.locator("#new-version")).toHaveValue((await draftOption.getAttribute("value")) ?? "missing");
      await admin.locator("#new-cohort").selectOption(state.cohortId);
      await admin.locator("#new-offering-code").fill(OFFERING_CODE);
      await admin.locator("#new-offering-term").fill(`Walkthrough term ${S}`);
      await admin.locator("#new-offering-tz").selectOption(TZ);
      await admin.locator("#new-offering-starts").fill(wallTime(new Date(Date.now() - DAY), TZ));
      await admin.locator("#new-offering-ends").fill(wallTime(new Date(Date.now() + 60 * DAY), TZ));
      await admin.getByRole("button", { name: "Create offering" }).click();
      await admin.waitForURL(/\/admin\/offerings\/[0-9a-f-]{36}\?created=1$/, { timeout: 30_000 });
      state.offeringId = idFrom(new URL(admin.url()).pathname);
      await expect(admin.getByText("Offering created as a draft.")).toBeVisible();
    });

    await test.step("assign the seeded instructor", async () => {
      await admin.waitForLoadState("networkidle");
      await admin.locator("#add-staff-email").fill(sampleEmail(INSTRUCTOR.local));
      await admin.locator("#add-staff-role").selectOption("instructor");
      await admin.getByRole("button", { name: "Add staff member" }).click();
      await expect(admin.getByText(`${INSTRUCTOR.name} added to the staff.`)).toBeVisible();
    });

    for (const learner of [LEARNER_A, LEARNER_B]) {
      await test.step(`invite ${learner.name}; the email arrives in Mailpit`, async () => {
        await open(admin, `/admin/invitations?cohort=${state.cohortId}`);
        await admin.locator("#invite-email").fill(learner.email);
        await admin.locator("#invite-name").fill(learner.name);
        await expect(admin.locator("#invite-cohort")).toHaveValue(state.cohortId);
        await admin.locator("#invite-offering").selectOption(state.offeringId);
        await admin.getByRole("button", { name: "Create invitation and send" }).click();
        const form = admin.getByRole("form", { name: "New invitation" });
        await expect(form.getByText(`Invitation created for ${learner.email}.`)).toBeVisible();
        await expect(form.getByText("The email service accepted the invitation email for delivery.")).toBeVisible();
      });
    }

    for (const learner of [LEARNER_A, LEARNER_B]) {
      await test.step(`${learner.name} opens the link, sets a password and accepts`, async () => {
        await expect.poll(async () => (await mailsTo(learner.email)).length, { timeout: 30_000, message: `emails to ${learner.email}` }).toBe(1);
        const [mail] = await mailsTo(learner.email);
        const link = await confirmLink(mail.ID);
        expect(new URL(link).origin).toBe(new URL(baseURL ?? "http://localhost:3000").origin);

        const page = await newContext(browser);
        await page.goto(link);
        await page.waitForURL(/\/reset-password\?invite=1/, { timeout: 30_000 });
        await page.waitForLoadState("networkidle");
        await expect(page.getByRole("heading", { level: 1, name: "Set your password" })).toBeVisible();
        await expect(page.getByText(`Signed in as ${learner.email}.`)).toBeVisible();
        await page.getByLabel(/^New password/).fill(learner.password);
        await page.getByLabel(/^Confirm new password/).fill(learner.password);
        await page.getByRole("button", { name: "Save password" }).click();
        await page.waitForURL(/\/invite\/accept\?password_updated=1/, { timeout: 30_000 });
        await page.waitForLoadState("networkidle");
        await expect(page.getByText("Your password is set. Accept your invitation below to join your cohort or course.")).toBeVisible();

        const pending = page.getByTestId("invitation").filter({ hasText: OFFERING_CODE });
        await expect(pending).toHaveAttribute("data-state", "pending");
        await pending.getByRole("button", { name: /^Accept invitation/ }).click();
        await expect(page).toHaveURL(/accepted=/, { timeout: 30_000 });
        await expect(page.getByText("Invitation accepted")).toBeVisible();
        await expect(page.getByText(new RegExp(`You now have access to ${esc(OFFERING_CODE)}`))).toBeVisible();
        await expect(page.getByTestId("invitation").filter({ hasText: OFFERING_CODE })).toHaveAttribute("data-state", "accepted");
      });
    }
  });

  test("2. the instructor builds a module with a PDF reading and a video, a prerequisite, a quiz and an assignment, then publishes and releases", async ({ browser }) => {
    test.setTimeout(900_000);
    const mai = await asSeeded(browser, INSTRUCTOR.local);
    const manage = `${course()}/content/manage`;

    await test.step("instructors cannot create courses", async () => {
      await expectNotAvailable(mai, "/admin/courses");
      await expect(mai.getByRole("link", { name: "Administration" })).toHaveCount(0);
    });

    let versionPath = "";
    await test.step("add a module with a PDF reading and a video lesson", async () => {
      await mai.goto(manage);
      await expect(mai.getByRole("heading", { level: 2, name: "Manage content" })).toBeVisible();
      await expect(mai.getByText("Draft version 1 is in progress.")).toBeVisible();
      await mai.getByRole("link", { name: "Edit draft", exact: true }).click();
      await expect(mai).toHaveURL(/\/content\/manage\/versions\/[0-9a-f-]{36}$/);
      versionPath = new URL(mai.url()).pathname;

      const addModule = mai.getByRole("region", { name: "Add a module" });
      await addModule.getByLabel("Module title").fill(T.module);
      await addModule.getByRole("button", { name: "Add module" }).click();
      await expect(addModule.getByText("Module added.")).toBeVisible();

      const addLesson = async (title: string, type: string): Promise<string> => {
        await mai.goto(versionPath);
        const card = mai.getByRole("region", { name: T.module, exact: true });
        await card.getByText(`Add a lesson to ${T.module}`).click();
        await card.getByLabel("Lesson title").fill(title);
        await card.getByLabel("Content type").selectOption({ label: type });
        await card.getByRole("button", { name: "Add lesson" }).click();
        await expect(mai).toHaveURL(/\/lessons\/[0-9a-f-]{36}\?created=1$/);
        await expect(mai.getByRole("heading", { level: 3, name: `Edit lesson: ${title}` })).toBeVisible();
        return idFrom(new URL(mai.url()).pathname.split("/").pop());
      };
      const attach = async (file: string | typeof VIDEO, filename: string) => {
        const add = mai.getByRole("region", { name: "Add files" });
        await add.getByLabel("Role", { exact: true }).selectOption({ label: "Primary (shown in the lesson)" });
        await add.getByLabel("Choose files to upload").setInputFiles(file);
        await expect(add.getByRole("list", { name: "Uploads" }).getByText("Uploaded")).toBeVisible({ timeout: 240_000 });
        await add.getByRole("button", { name: "Attach uploaded files" }).click();
        await expect(add.getByText("Files attached to the lesson.")).toBeVisible();
        await expect(mai.getByRole("list", { name: "Files attached to this lesson" }).getByRole("listitem").filter({ hasText: filename })).toContainText(
          "Primary (shown in the lesson)",
        );
      };

      state.lessons.reading = await addLesson(T.reading, "PDF");
      await attach(PDF, "agent-architectures-reading.pdf");
      state.lessons.video = await addLesson(T.video, "Video");
      await attach(VIDEO, VIDEO.name);

      await mai.goto(versionPath);
      const rows = mai.getByRole("region", { name: T.module, exact: true }).getByRole("listitem");
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText(T.reading);
      await expect(rows.nth(1)).toContainText(T.video);
    });

    await test.step("publish the draft and release the offering", async () => {
      await mai.getByRole("button", { name: "Publish draft" }).click();
      const publish = mai.getByRole("dialog", { name: "Publish version 1?" });
      await publish.getByRole("button", { name: "Publish draft" }).click();
      await expect(mai.getByText("Version 1 is published.")).toBeVisible();

      await mai.goto(manage);
      await mai.getByRole("button", { name: "Release to learners" }).click();
      const release = mai.getByRole("dialog", { name: `Release ${OFFERING_CODE} to learners?` });
      await release.getByRole("button", { name: "Release to learners" }).click();
      await expect(mai.getByText("The offering is now visible to learners.")).toBeVisible();
      await expect(mai.getByText("Visible to learners", { exact: true })).toBeVisible();
    });

    await test.step("the video stays locked until the reading is complete", async () => {
      await mai.goto(`${manage}/rules`);
      const rule = mai.getByRole("region", { name: "Require another lesson" });
      await rule.getByLabel("Lesson to lock").selectOption({ label: T.video });
      await rule.getByLabel("Lesson that must be completed first").selectOption({ label: T.reading });
      await rule.getByRole("button", { name: "Add condition" }).click();
      await expect(rule.getByText("Condition added.")).toBeVisible();
      await expect(mai.getByText(`Requires completing “${T.reading}”`, { exact: true })).toBeVisible();
    });

    await test.step("a simple quiz, published", async () => {
      await mai.goto(`${course()}/quizzes/new`);
      await hydrated(mai.getByRole("button", { name: "Create quiz" }));
      await mai.getByLabel("Title").fill(T.quiz);
      await mai.getByLabel("Answer and feedback review").selectOption("after_submit");
      await mai.getByLabel("Score release").selectOption("immediate");
      await mai.getByRole("button", { name: "Create quiz" }).click();
      await mai.waitForURL(/\/quizzes\/[0-9a-f-]{36}\/edit/);
      state.quizId = idFrom(mai.url().match(new RegExp(`quizzes/(${UUID.source})`))?.[1]);
      await expect(mai.getByText("Quiz created as a draft.")).toBeVisible();

      const add = mai.locator("section").filter({ has: mai.getByRole("heading", { name: "Add a question", exact: true }) }).last();
      await hydrated(add.getByRole("button", { name: "Add choice" }));
      await add.getByLabel("Question type").selectOption("single_choice");
      await add.locator('input[name="points"]').fill("2");
      await add.locator('textarea[name="prompt"]').fill(T.question);
      await add.locator('input[name="choice_text"]').nth(0).fill(T.correct);
      await add.locator('input[name="choice_text"]').nth(1).fill(T.wrong);
      await add.getByRole("radio", { name: "(Choice 1)" }).check();
      await add.locator('textarea[name="explanation"]').fill(`Checking results closes the loop. ${S}`);
      await add.getByRole("button", { name: "Add question" }).click();
      await expect(mai.getByRole("heading", { name: "Question 1", exact: true })).toBeVisible();

      await (await hydrated(mai.getByRole("button", { name: "Publish version 1" }))).click();
      await mai.getByRole("dialog", { name: "Publish version 1?" }).getByRole("button", { name: "Publish" }).click();
      await expect(mai.getByText(/Learners currently see version 1, published/)).toBeVisible();
    });

    await test.step("an assignment with a due date, published", async () => {
      await mai.goto(`${course()}/assignments/new`);
      await hydrated(mai.getByRole("button", { name: "Add criterion" }));
      await mai.getByLabel("Title").fill(T.assignment);
      await mai.getByLabel("Instructions").fill(`Describe your agent loop in a few sentences. ${S}`);
      await mai.locator("#asg-points").fill("10");
      await mai.locator("#dt-due_at").fill(DUE.wall);
      await mai.getByRole("radio", { name: /^Published/ }).check();
      await mai.getByRole("button", { name: "Create assignment" }).click();
      await mai.waitForURL(/\/assignments\/[0-9a-f-]{36}\/edit\?created=1/);
      state.assignmentId = idFrom(mai.url().match(new RegExp(`assignments/(${UUID.source})`))?.[1]);
      await expect(mai.getByText("Assignment created.")).toBeVisible();
    });
  });

  test("3. learner A meets the prerequisite, opens the video, takes the quiz and submits the assignment", async ({ browser }) => {
    test.setTimeout(600_000);
    const a = await asLearner(browser, LEARNER_A);
    const base = course();

    await test.step("the course is listed and the video is locked", async () => {
      await a.goto("/courses");
      await expect(a.getByRole("heading", { level: 1, name: "Courses" })).toBeVisible();
      await expect(a.getByRole("link", { name: COURSE.title })).toBeVisible();

      await a.goto(`${base}/content`);
      await expect(a.getByRole("heading", { level: 2, name: "Course content" })).toBeVisible();
      await expect(a.getByRole("link", { name: T.reading, exact: true })).toBeVisible();
      const videoRow = a.getByRole("listitem").filter({ has: a.getByRole("link") }).filter({ hasText: T.video }).last();
      await expect(videoRow).toContainText("Locked");
      await expect(videoRow).toContainText(`Complete “${T.reading}” first.`);

      await a.goto(`${base}/content/${state.lessons.video}`);
      await expect(a.getByRole("heading", { name: "This lesson is locked" })).toBeVisible();
      await expect(a.locator("video")).toHaveCount(0);
    });

    await test.step("completing the reading unlocks the video, which opens", async () => {
      await a.getByRole("link", { name: `Go to ${T.reading}` }).click();
      await expect(a).toHaveURL(new RegExp(`/content/${state.lessons.reading}$`));
      await expect(a.locator('iframe[title^="PDF:"]')).toBeAttached();
      await expect(a.getByRole("link", { name: "Download PDF" })).toBeVisible();
      await (await hydrated(a.getByRole("button", { name: "Mark as complete" }))).click();
      await expect(a.getByText("Lesson marked complete.")).toBeVisible();
      await a.goto(base);
      await expect(a.getByText("1 of 2 required items complete")).toBeVisible();

      await a.goto(`${base}/content/${state.lessons.reading}`);
      await a.getByRole("link", { name: `Next lesson ${T.video}` }).click();
      await expect(a).toHaveURL(new RegExp(`/content/${state.lessons.video}$`));
      await expect(a.getByRole("heading", { name: "This lesson is locked" })).toHaveCount(0);
      await expect(a.locator("video")).toBeVisible();
      const src = await a.locator("video source").first().getAttribute("src");
      expect((await a.request.get(src ?? "", { maxRedirects: 0 })).status()).toBe(302);
      await (await hydrated(a.getByRole("button", { name: "Mark as complete" }))).click();
      await expect(a.getByText("Lesson marked complete.")).toBeVisible();
      await a.goto(base);
      await expect(a.getByText("2 of 2 required items complete")).toBeVisible();
    });

    await test.step("take and submit the quiz", async () => {
      const quizBase = `${base}/quizzes/${state.quizId}`;
      await a.goto(`${base}/quizzes`);
      await a.getByRole("link", { name: T.quiz, exact: true }).click();
      await expect(a).toHaveURL(new RegExp(`${quizBase}$`));
      await expect(a.getByRole("heading", { name: "Take the quiz" })).toBeVisible();
      await (await hydrated(a.getByRole("button", { name: "Start attempt 1" }))).click();
      await a.getByRole("dialog", { name: "Start attempt 1?" }).getByRole("button", { name: "Start now" }).click();
      await a.waitForURL(/\/attempts\/[0-9a-f-]{36}$/);
      state.attemptId = idFrom(a.url().split("/attempts/")[1]);

      const group = a.getByRole("group", { name: T.question });
      await hydrated(group.getByRole("radio", { name: T.correct }));
      await group.getByRole("radio", { name: T.correct }).check();
      await expect(a.getByText(/All answers saved\. Last saved at/).first()).toBeVisible();
      await (await hydrated(a.getByRole("button", { name: "Submit attempt" }).last())).click();
      await a.getByRole("dialog", { name: "Submit attempt 1?" }).getByRole("button", { name: "Submit now" }).click();
      await expect(a.getByText(/This attempt was submitted at/)).toBeVisible();

      await a.goto(quizBase);
      await expect(a.getByRole("link", { name: "Review attempt 1" })).toBeVisible();
    });

    await test.step("submit the assignment", async () => {
      await a.goto(`${base}/assignments`);
      await a.getByRole("link", { name: T.assignment, exact: true }).click();
      await expect(a).toHaveURL(new RegExp(`/assignments/${state.assignmentId}$`));
      await expect(a.getByRole("heading", { name: T.assignment })).toBeVisible();
      await hydrated(a.getByRole("button", { name: "Save draft" }));
      await a.getByLabel("Text submission").fill(T.answer);
      await a.getByRole("button", { name: "Submit", exact: true }).click();
      await expect(a.getByText(/Receipt CS-[0-9A-F]{10} · version 1 · /)).toBeVisible();
    });
  });

  test("4. the instructor grades the assignment and publishes the grade", async ({ browser }) => {
    test.setTimeout(300_000);
    const mai = await asSeeded(browser, INSTRUCTOR.local);
    const base = `${course()}/assignments/${state.assignmentId}`;

    await mai.goto(`${base}/grade?filter=to_grade`);
    await expect(mai.getByRole("table")).toContainText(LEARNER_A.name);
    await expect(mai.getByRole("table")).not.toContainText(LEARNER_B.name);
    await mai.getByRole("link", { name: `Grade (${LEARNER_A.name})` }).click();
    await expect(mai).toHaveURL(new RegExp(`/grade/${UUID.source}`));
    state.submissionId = idFrom(mai.url().split("/grade/")[1]);
    await expect(mai.getByRole("heading", { name: "Version 1", exact: true })).toBeVisible();
    await expect(mai.getByText(T.answer)).toBeVisible();

    await hydrated(mai.getByRole("button", { name: "Save grade" }));
    await mai.getByLabel("Points (0 to 10)").fill("8");
    await mai.getByLabel("Feedback to the learner").fill(T.feedback);
    await mai.getByRole("button", { name: "Save grade" }).click();
    await expect(mai.getByText("Grade saved. It is not visible to the learner until it is published.")).toBeVisible();

    await mai.reload();
    await (await hydrated(mai.getByRole("button", { name: "Publish grade" }))).click();
    await mai.getByRole("dialog", { name: "Publish this grade?" }).getByRole("button", { name: "Publish" }).click();
    await expect(mai.getByText(/Published to the learner/).first()).toBeVisible();

    await mai.goto(`${base}/grade`);
    await expect(mai.getByRole("row", { name: new RegExp(esc(LEARNER_A.name)) })).toContainText("Released");
  });

  test("5. learner A sees the feedback and progress on Grades", async ({ browser }) => {
    test.setTimeout(240_000);
    const a = await asLearner(browser, LEARNER_A);

    await a.goto("/grades");
    const card = a.getByRole("article").filter({ hasText: OFFERING_CODE });
    await expect(card.getByTestId("grade-pill")).toHaveText(/^\d+(\.\d+)?%$/);
    await expect(card).toContainText("2 of 2 items released");

    await a.goto(`/grades/${state.offeringId}`);
    await expect(a.getByTestId("running-total")).toContainText("%");
    const item = a.getByRole("article").filter({ has: a.getByRole("heading", { level: 3, name: T.assignment }) });
    await expect(item).toContainText("Released");
    await expect(item).toContainText("8 / 10");
    await expect(item).toContainText(T.feedback);
    await expect(item).toContainText(`Due ${DUE.short}`);
    const quizItem = a.getByRole("article").filter({ has: a.getByRole("heading", { level: 3, name: T.quiz }) });
    await expect(quizItem).toContainText("Released");

    // The assignment page shows the same released grade and feedback.
    await a.goto(`${course()}/assignments/${state.assignmentId}`);
    const panel = a.locator("section").filter({ has: a.getByRole("heading", { name: "Your grade" }) });
    await expect(panel.getByText("8 / 10", { exact: true })).toBeVisible();
    await expect(panel.getByText(T.feedback)).toBeVisible();
  });

  test("6. learner B cannot see learner A's grades, submissions or messages", async ({ browser }) => {
    test.setTimeout(300_000);
    const a = await asLearner(browser, LEARNER_A);

    await test.step("learner A messages the instructor from Messages", async () => {
      await a.goto("/messages");
      await a.getByRole("listitem").filter({ hasText: `ID: ${OFFERING_CODE}` }).getByRole("link", { name: /New Message/ }).click();
      await expect(a).toHaveURL(new RegExp(`/messages/new\\?offering=${state.offeringId}`));
      await expect(a.getByRole("heading", { level: 1, name: "New message" })).toBeVisible();
      await a.getByLabel(`Search people in ${OFFERING_CODE}`).fill("Mai");
      await (await hydrated(a.getByRole("checkbox", { name: new RegExp(INSTRUCTOR.name) }))).check();
      await expect(a.getByText("1 selected")).toBeVisible();
      await a.getByLabel("Subject").fill(T.subjectA);
      await a.getByRole("textbox", { name: /^Message/ }).fill(T.bodyA);
      await a.getByRole("button", { name: "Send", exact: true }).click();
      await expect(a).toHaveURL(new RegExp(`/messages/${UUID.source}`), { timeout: 45_000 });
      await expect(a.getByText("Message sent.")).toBeVisible();
      state.threadA = idFrom(new URL(a.url()).pathname);
      await expect(a.getByRole("heading", { level: 1 })).toHaveText(T.subjectA);
    });

    const b = await asLearner(browser, LEARNER_B);
    const base = course();

    await test.step("B's Messages has no thread from A, and its URL is not available", async () => {
      await b.goto("/messages");
      await expect(b.getByRole("heading", { level: 1, name: "Messages" })).toBeVisible();
      await expect(b.getByText(T.subjectA)).toHaveCount(0);
      await b.goto(`/messages?offering=${state.offeringId}`);
      await expect(b.getByText(T.subjectA)).toHaveCount(0);
      await expectNotAvailable(b, `/messages/${state.threadA}`);
      await expect(b.getByText(T.bodyA)).toHaveCount(0);
      expect((await b.request.get(`/api/messages/poll?thread=${state.threadA}`)).status()).toBe(404);
    });

    await test.step("A's submission and quiz attempt are not available to B", async () => {
      for (const path of [
        `${base}/assignments/${state.assignmentId}/grade/${state.submissionId}`,
        `${base}/assignments/${state.assignmentId}/grade`,
        `${base}/quizzes/${state.quizId}/attempts/${state.attemptId}`,
        `${base}/quizzes/${state.quizId}/attempts/${state.attemptId}/review`,
        `${base}/quizzes/${state.quizId}/grade/${state.attemptId}`,
      ]) {
        await expectNotAvailable(b, path);
        expect(await b.content()).not.toContain(T.answer);
      }
      // B's own assignment page has nothing of A's work or feedback.
      await b.goto(`${base}/assignments/${state.assignmentId}`);
      await expect(b.getByRole("heading", { name: T.assignment })).toBeVisible();
      expect(await b.content()).not.toContain(T.answer);
      expect(await b.content()).not.toContain(T.feedback);
    });

    await test.step("B's Grades show only B's own (empty) results", async () => {
      await b.goto(`/grades/${state.offeringId}`);
      const item = b.getByRole("article").filter({ has: b.getByRole("heading", { level: 3, name: T.assignment }) });
      await expect(item).toBeVisible();
      await expect(item).not.toContainText("8 / 10");
      expect(await b.content()).not.toContain(T.feedback);
      // The gradebook URL gives B their own grades, never the class list.
      await b.goto(`${base}/grades`);
      await expect(b.getByRole("heading", { name: "Gradebook" })).toHaveCount(0);
      expect(await b.content()).not.toContain(LEARNER_A.name);
      expect((await b.request.get(`/api/grades/${state.offeringId}/export`)).status()).toBe(404);
    });
  });

  test("7. data persists after reload; search, favorites, messages, calendar and sign-out work", async ({ browser }) => {
    test.setTimeout(420_000);
    const a = await asLearner(browser, LEARNER_A);
    const base = course();

    await test.step("progress, quiz attempt, submission and message persist after reload", async () => {
      await a.goto(`${base}/content/${state.lessons.reading}`);
      await a.reload();
      await expect(a.getByText(/Completed [A-Z][a-z]{2} \d{1,2}, \d{4}/).first()).toBeVisible();
      await a.goto(`${base}/content`);
      await a.reload();
      const videoRow = a.getByRole("listitem").filter({ has: a.getByRole("link") }).filter({ hasText: T.video }).last();
      await expect(videoRow).not.toContainText("Locked");
      await a.goto(base);
      await a.reload();
      await expect(a.getByText("2 of 2 required items complete")).toBeVisible();

      await a.goto(`${base}/quizzes/${state.quizId}`);
      await a.reload();
      await expect(a.getByRole("link", { name: "Review attempt 1" })).toBeVisible();
      await expect(a.getByRole("button", { name: /Start attempt/ })).toHaveCount(0);

      await a.goto(`${base}/assignments/${state.assignmentId}`);
      await a.reload();
      const history = a.getByRole("table", { name: "Submission history" });
      await expect(history.getByRole("row")).toHaveCount(2);
      await expect(a.getByText(T.feedback)).toBeVisible();

      await a.goto(`/messages/${state.threadA}`);
      await a.reload();
      await expect(a.getByRole("heading", { level: 1 })).toHaveText(T.subjectA);
      await expect(a.getByText(T.bodyA)).toBeVisible();
    });

    await test.step("course search and filter", async () => {
      await open(a, "/courses");
      await a.getByLabel("Search your courses").fill(OFFERING_CODE);
      await a.getByLabel("Search your courses").press("Enter");
      await expect(a).toHaveURL(new RegExp(`q=${esc(encodeURIComponent(OFFERING_CODE))}`));
      await expect(a.getByText("1 result", { exact: true })).toBeVisible();
      await expect(a.getByRole("link", { name: COURSE.title })).toBeVisible();

      await a.getByLabel("Search your courses").fill(`no course is called this ${S}`);
      await a.getByLabel("Search your courses").press("Enter");
      await expect(a.getByText("No courses match your search and filters.")).toBeVisible();
      await expect(a.getByRole("link", { name: COURSE.title })).toHaveCount(0);

      await open(a, "/courses");
      await a.getByLabel("Filters").selectOption("learning");
      await expect(a).toHaveURL(/filter=learning/);
      await expect(a.getByRole("link", { name: COURSE.title })).toBeVisible();
      await a.getByLabel("Filters").selectOption("teaching");
      await expect(a).toHaveURL(/filter=teaching/);
      await expect(a.getByRole("link", { name: COURSE.title })).toHaveCount(0);
    });

    await test.step("favorite toggle persists after reload", async () => {
      await open(a, "/courses");
      const add = a.getByRole("button", { name: `Add ${COURSE.title} to favorites` });
      const remove = a.getByRole("button", { name: `Remove ${COURSE.title} from favorites` });
      await (await hydrated(add)).click();
      await expect(remove).toHaveAttribute("aria-pressed", "true");
      await a.reload();
      await expect(remove).toHaveAttribute("aria-pressed", "true");
      await open(a, "/courses?filter=favorites");
      await expect(a.getByRole("link", { name: COURSE.title })).toBeVisible();

      // Toggle back off from the Favorites view: the course leaves that list, and stays off after reload.
      await (await hydrated(remove)).click();
      await expect(a.getByText("No courses match your search and filters.")).toBeVisible();
      await a.reload();
      await expect(a.getByRole("link", { name: COURSE.title })).toHaveCount(0);
      await open(a, "/courses");
      await expect(add).toHaveAttribute("aria-pressed", "false");
    });

    await test.step("learner B composes a message to the instructor, who receives it", async () => {
      const b = await asLearner(browser, LEARNER_B);
      await b.goto(`/messages/new?offering=${state.offeringId}`);
      await b.getByLabel(`Search people in ${OFFERING_CODE}`).fill("Mai");
      await (await hydrated(b.getByRole("checkbox", { name: new RegExp(INSTRUCTOR.name) }))).check();
      await b.getByLabel("Subject").fill(T.subjectB);
      await b.getByRole("textbox", { name: /^Message/ }).fill(T.bodyB);
      await b.getByRole("button", { name: "Send", exact: true }).click();
      await expect(b).toHaveURL(new RegExp(`/messages/${UUID.source}`), { timeout: 45_000 });
      await expect(b.getByText("Message sent.")).toBeVisible();
      await b.reload();
      await expect(b.getByText(T.bodyB)).toBeVisible();

      const mai = await asSeeded(browser, INSTRUCTOR.local);
      await mai.goto(`/messages?offering=${state.offeringId}`);
      await expect(mai.getByRole("listitem").filter({ hasText: T.subjectA })).toBeVisible();
      await expect(mai.getByRole("listitem").filter({ hasText: T.subjectB })).toBeVisible();
      // A still cannot see B's conversation.
      await a.goto("/messages");
      await expect(a.getByText(T.subjectB)).toHaveCount(0);
    });

    await test.step("the calendar shows the assignment due date", async () => {
      await a.goto(`/calendar?view=list&date=${DUE.ymd}`);
      await expect(a.getByRole("heading", { level: 3, name: new RegExp(esc(DUE.heading)) })).toBeVisible();
      const details = await openDialog(a.getByRole("button", { name: new RegExp(esc(T.assignment)) }), a.getByRole("dialog", { name: T.assignment }));
      await expect(details).toContainText(DUE.short);
      await expect(details).toContainText("Due");
      await a.goto(`${base}/calendar?view=list&date=${DUE.ymd}`);
      await expect(a.getByRole("button", { name: new RegExp(esc(T.assignment)) })).toBeVisible();
    });

    await test.step("sign out ends the session", async () => {
      await open(a, "/courses");
      await a.getByRole("button", { name: "Sign Out" }).click();
      await a.waitForURL(/\/login\?signed_out=1/, { timeout: 30_000 });
      await expect(a.getByText("You have signed out.")).toBeVisible();
      await a.goto("/courses");
      await expect(a).toHaveURL(/\/login\?next=%2Fcourses/);
      await a.goto(`/grades/${state.offeringId}`);
      await expect(a).toHaveURL(/\/login\?next=/);
    });
  });
});
