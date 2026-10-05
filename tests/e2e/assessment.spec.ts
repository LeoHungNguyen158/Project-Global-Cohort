import { expect as baseExpect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expectNoAxeViolations, expectNoHorizontalOverflow, sampleEmail, signIn, uniqueSuffix } from "./helpers";

// Quizzes and assignments, end to end, in a dedicated fixture offering ("E2E-ASMT-F26", sample
// data in the sample cohort) that beforeAll finds or creates with the service role: mai.tran
// teaches it (instructor), linh.pham is a TA who may grade only, and participant03/04 are the
// enrolled learners. Every run creates its own uniquely named quiz and assignment there, so
// nothing in the seeded AAF-F26 offering changes.

const FIXTURE = {
  courseCode: "E2E-ASMT",
  offeringCode: "E2E-ASMT-F26",
  cohortCode: "GC-FALL-2026",
  title: "Assessment E2E fixture (sample)",
};
// The shared development server can take well over 10 s to re-render a page after an action.
const expect = baseExpect.configure({ timeout: 30_000 });
const DAY = 86_400_000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const NOT_AVAILABLE = "Page not available";
const WHO = ["mai.tran", "linh.pham", "participant03", "participant04"] as const;
type Who = (typeof WHO)[number];

type Fixture = { offeringId: string; ids: Record<Who, string>; names: Record<Who, string> };

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are needed to create the assessment fixture offering.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function must<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await query;
  if (error || data === null) throw new Error(`${what}: ${error?.message ?? "no data"}`);
  return data;
}

/** Finds or creates the fixture offering, its staff and its two learners (idempotent). */
async function ensureFixture(): Promise<Fixture> {
  const admin = serviceClient();
  const { data: list, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const byEmail = new Map(list.users.map((u) => [String(u.email).toLowerCase(), u.id]));
  const ids = Object.fromEntries(
    WHO.map((w) => {
      const id = byEmail.get(sampleEmail(w));
      if (!id) throw new Error(`sample account ${w} not found`);
      return [w, id];
    }),
  ) as Record<Who, string>;
  const profiles = await must(admin.from("profiles").select("id, display_name").in("id", Object.values(ids)), "profiles");
  const names = Object.fromEntries(WHO.map((w) => [w, (profiles as { id: string; display_name: string }[]).find((p) => p.id === ids[w])?.display_name ?? w])) as Record<Who, string>;

  const cohort = await must<{ id: string }>(admin.from("cohorts").select("id").eq("code", FIXTURE.cohortCode).single(), "cohort");
  let course = (await admin.from("courses").select("id").eq("code", FIXTURE.courseCode).maybeSingle()).data as { id: string } | null;
  course ??= await must(admin.from("courses").insert({ code: FIXTURE.courseCode, title: FIXTURE.title, is_sample: true }).select("id").single(), "course");
  let version = (await admin.from("course_versions").select("id").eq("course_id", course.id).eq("version_no", 1).maybeSingle()).data as { id: string } | null;
  version ??= await must(
    admin
      .from("course_versions")
      .insert({
        course_id: course.id,
        version_no: 1,
        status: "published",
        title: FIXTURE.title,
        summary: "Synthetic course used by the assessment end-to-end tests.",
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single(),
    "course version",
  );
  const now = Date.now();
  let offering = (await admin.from("course_offerings").select("id, status, ends_at").eq("code", FIXTURE.offeringCode).maybeSingle()).data as {
    id: string;
    status: string;
    ends_at: string | null;
  } | null;
  if (!offering) {
    offering = await must(
      admin
        .from("course_offerings")
        .insert({
          course_id: course.id,
          course_version_id: version.id,
          cohort_id: cohort.id,
          code: FIXTURE.offeringCode,
          term_label: "Fall 2026",
          starts_at: new Date(now - 30 * DAY).toISOString(),
          ends_at: new Date(now + 120 * DAY).toISOString(),
          timezone: "America/New_York",
          status: "published",
          is_sample: true,
        })
        .select("id, status, ends_at")
        .single(),
      "offering",
    );
  } else if (offering.status !== "published" || !offering.ends_at || new Date(offering.ends_at).getTime() < now + 30 * DAY) {
    await must(
      admin.from("course_offerings").update({ status: "published", ends_at: new Date(now + 120 * DAY).toISOString() }).eq("id", offering.id).select("id"),
      "offering dates",
    );
  }
  await must(
    admin
      .from("staff_assignments")
      .upsert(
        [
          { offering_id: offering.id, user_id: ids["mai.tran"], role: "instructor", can_author: true, can_grade: true, can_publish_grades: true },
          { offering_id: offering.id, user_id: ids["linh.pham"], role: "ta", can_author: false, can_grade: true, can_publish_grades: false },
        ],
        { onConflict: "offering_id,user_id" },
      )
      .select("user_id"),
    "staff",
  );
  await must(
    admin
      .from("enrollments")
      .upsert(
        [
          { offering_id: offering.id, user_id: ids.participant03, status: "active", source: "admin" },
          { offering_id: offering.id, user_id: ids.participant04, status: "active", source: "admin" },
        ],
        { onConflict: "offering_id,user_id" },
      )
      .select("user_id"),
    "enrollments",
  );
  return { offeringId: offering.id, ids, names };
}

async function newPage(browser: Browser, who: Who): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signIn(page, who);
  return page;
}

async function apiAs(who: Who): Promise<SupabaseClient> {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({ email: sampleEmail(who), password: process.env.SEED_PASSWORD ?? "" });
  if (error) throw error;
  return c;
}

/** The page must fit at phone, tablet and desktop widths without sideways scrolling. */
async function expectFitsAllWidths(page: Page) {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
  }
}

/** Waits until React has hydrated the element, so clicks and typing reach its handlers. */
async function hydrated(target: Locator): Promise<Locator> {
  await expect(target).toBeVisible();
  await expect
    .poll(() => target.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$"))), { timeout: 30_000 })
    .toBe(true);
  return target;
}

async function expectNotAvailable(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: NOT_AVAILABLE })).toBeVisible();
}

/** Collects the text of every document and data response the page receives (not static bundles). */
function recordResponses(page: Page) {
  const bodies: Promise<string>[] = [];
  page.on("response", (res) => {
    const type = res.request().resourceType();
    if (!["document", "fetch", "xhr", "other"].includes(type)) return;
    if (res.url().includes("/_next/static/")) return;
    bodies.push(res.text().catch(() => ""));
  });
  return async () => (await Promise.all(bodies)).join("\n");
}

function occurrences(haystack: string, needle: string): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test.describe("assessment", () => {
  // On a shared development server, another engineer's edit can hot-reload a page mid-test; the
  // group then reruns from the start with fresh data (production servers do not hot-reload).
  test.describe.configure({ mode: "serial", retries: 2 });

  const suffix = uniqueSuffix();
  let fx: Fixture;
  let course = "";

  // Quiz content: correct and incorrect choices are equally plain text; only the server knows the key.
  const quizTitle = `E2E quiz ${suffix}`;
  const q1 = { prompt: `Which step checks the agent's results? ${suffix}`, correct: `Observe results ${suffix}`, picked: `Guess blindly ${suffix}`, other: `Skip checks ${suffix}` };
  const q2 = {
    prompt: `Which steps belong in an agent loop? ${suffix}`,
    correct: [`Plan steps ${suffix}`, `Act with tools ${suffix}`],
    picked: `Sleep forever ${suffix}`,
    other: `Delete logs ${suffix}`,
  };
  const q3 = { prompt: `Agents should log their tool calls. ${suffix}` };
  const q4 = { prompt: `Describe one evaluation you would run. ${suffix}`, answer: `I would compare outputs to a rubric ${suffix}` };
  const secret = { e1: `EXPLAIN-ONE-${suffix}`, e2: `EXPLAIN-TWO-${suffix}`, e3: `EXPLAIN-THREE-${suffix}`, model: `MODEL-ANSWER-${suffix}` };
  let quizId = "";
  let attemptId = "";

  const assignmentTitle = `E2E assignment ${suffix}`;
  let assignmentId = "";
  let submissionId = "";

  test.beforeAll(async () => {
    fx = await ensureFixture();
    course = `/courses/${fx.offeringId}`;
  });

  test("an instructor builds, previews and publishes a quiz with every question type", async ({ browser }) => {
    test.setTimeout(240_000);
    const mai = await newPage(browser, "mai.tran");
    await mai.goto(`${course}/quizzes/new`);
    await hydrated(mai.getByRole("button", { name: "Create quiz" }));
    await mai.getByLabel("Title").fill(quizTitle);
    await mai.getByLabel("Time limit (minutes)").fill("30");
    await mai.getByLabel("Attempts allowed").fill("2");
    await mai.getByLabel("Answer and feedback review").selectOption("after_submit");
    await mai.getByLabel("Score release").selectOption("immediate");
    await mai.getByLabel("Instructions").fill(`Answer all four questions. ${suffix}`);
    await mai.getByRole("button", { name: "Create quiz" }).click();
    await mai.waitForURL(/\/quizzes\/[0-9a-f-]{36}\/edit/);
    quizId = mai.url().match(new RegExp(`quizzes/(${UUID.source})`))?.[1] ?? "";
    expect(quizId).toMatch(UUID);
    await expect(mai.getByText("Quiz created as a draft.")).toBeVisible();

    // The innermost section holding the "Add a question" heading (the Questions section wraps it too).
    const add = mai.locator("section").filter({ has: mai.getByRole("heading", { name: "Add a question", exact: true }) }).last();
    await hydrated(add.getByRole("button", { name: "Add choice" }));
    let count = 0;
    async function addQuestion(spec: { type: string; prompt: string; points: string; choices?: { text: string; correct: boolean }[]; tf?: "True" | "False"; explanation: string }) {
      await add.getByLabel("Question type").selectOption(spec.type);
      await add.locator('input[name="points"]').fill(spec.points);
      await add.locator('textarea[name="prompt"]').fill(spec.prompt);
      if (spec.choices) {
        const inputs = add.locator('input[name="choice_text"]');
        for (let i = 2; i < spec.choices.length; i++) {
          await add.getByRole("button", { name: "Add choice" }).click();
          await expect(inputs).toHaveCount(i + 1);
        }
        for (const [i, c] of spec.choices.entries()) {
          await add.locator('input[name="choice_text"]').nth(i).fill(c.text);
          if (c.correct) await add.getByRole(spec.type === "single_choice" ? "radio" : "checkbox", { name: `(Choice ${i + 1})` }).check();
        }
      }
      if (spec.tf) await add.getByRole("radio", { name: spec.tf, exact: true }).check();
      await add.locator('textarea[name="explanation"]').fill(spec.explanation);
      await add.getByRole("button", { name: "Add question" }).click();
      count += 1;
      await expect(mai.getByRole("heading", { name: `Question ${count}`, exact: true })).toBeVisible();
      // The editor clears itself for the next question.
      await expect(add.locator('textarea[name="prompt"]')).toHaveValue("");
    }
    await addQuestion({
      type: "single_choice",
      prompt: q1.prompt,
      points: "2",
      choices: [
        { text: q1.correct, correct: true },
        { text: q1.picked, correct: false },
        { text: q1.other, correct: false },
      ],
      explanation: secret.e1,
    });
    await addQuestion({
      type: "multiple_select",
      prompt: q2.prompt,
      points: "2",
      choices: [
        { text: q2.correct[0], correct: true },
        { text: q2.picked, correct: false },
        { text: q2.correct[1], correct: true },
        { text: q2.other, correct: false },
      ],
      explanation: secret.e2,
    });
    await addQuestion({ type: "true_false", prompt: q3.prompt, points: "1", tf: "True", explanation: secret.e3 });
    await addQuestion({ type: "short_answer", prompt: q4.prompt, points: "2", explanation: secret.model });
    await expectFitsAllWidths(mai);

    // Preview shows the draft as learners will see it, without creating an attempt.
    await mai.goto(`${course}/quizzes/${quizId}/preview`);
    await expect(mai.getByText(/Preview of version 1 as learners see it/)).toBeVisible();
    await expect(mai.getByRole("group", { name: q1.prompt })).toBeVisible();
    await expect(mai.getByText("Submitting is not available in a preview.").first()).toBeVisible();

    await mai.goto(`${course}/quizzes/${quizId}/edit`);
    await (await hydrated(mai.getByRole("button", { name: "Publish version 1" }))).click();
    const dialog = mai.getByRole("dialog", { name: "Publish version 1?" });
    await dialog.getByRole("button", { name: "Publish" }).click();
    await expect(mai.getByText(/Learners currently see version 1, published/)).toBeVisible();
    await mai.context().close();
  });

  test("a learner takes the quiz: autosave, restore on reload, no answer keys in the browser, one attempt at a time", async ({ browser }) => {
    test.setTimeout(240_000);
    const p04 = await newPage(browser, "participant04");
    const allBodies = recordResponses(p04);
    const quizBase = `${course}/quizzes/${quizId}`;
    await p04.goto(quizBase);
    await expect(p04.getByRole("heading", { name: "Take the quiz" })).toBeVisible();
    await expect(p04.getByText(/If you start now, you must submit by/)).toBeVisible();
    await (await hydrated(p04.getByRole("button", { name: "Start attempt 1" }))).click();
    await p04.getByRole("dialog", { name: "Start attempt 1?" }).getByRole("button", { name: "Start now" }).click();
    await p04.waitForURL(/\/attempts\/[0-9a-f-]{36}$/);
    attemptId = p04.url().split("/attempts/")[1];
    expect(attemptId).toMatch(UUID);

    // Starting again (a second tab, a double click, a retry) returns the same attempt.
    const api04 = await apiAs("participant04");
    const again = await api04.rpc("start_quiz_attempt", { p_quiz: quizId });
    expect(again.error).toBeNull();
    expect(again.data).toBe(attemptId);

    const g1 = p04.getByRole("group", { name: q1.prompt });
    const g2 = p04.getByRole("group", { name: q2.prompt });
    const g3 = p04.getByRole("group", { name: q3.prompt });
    await hydrated(g1.getByRole("radio", { name: q1.picked }));
    await g1.getByRole("radio", { name: q1.picked }).check();
    await g2.getByRole("checkbox", { name: q2.picked }).check();
    await g3.getByRole("radio", { name: "True", exact: true }).check();
    await p04.getByLabel("Your answer to question 4").fill(q4.answer);
    await expect(p04.getByText(/All answers saved\. Last saved at/).first()).toBeVisible({ timeout: 20_000 });
    await expect(p04.getByRole("timer")).toBeVisible();

    // A reload restores every saved answer from the server.
    await p04.reload();
    await expect(g1.getByRole("radio", { name: q1.picked })).toBeChecked();
    await expect(g2.getByRole("checkbox", { name: q2.picked })).toBeChecked();
    await expect(g3.getByRole("radio", { name: "True", exact: true })).toBeChecked();
    await expect(p04.getByLabel("Your answer to question 4")).toHaveValue(q4.answer);

    // No answer key, explanation or model answer anywhere: not in the HTML, the RSC payloads, the
    // client props or any response body (saves and status checks included).
    const choiceIds = async (group: Locator) =>
      group.locator("input").evaluateAll((els) => els.map((e) => ({ id: (e as HTMLInputElement).value, label: e.closest("label")?.textContent?.trim() ?? "" })));
    const c1 = await choiceIds(g1);
    const c2 = await choiceIds(g2);
    const everything = `${await p04.content()}\n${await allBodies()}`;
    expect(everything).not.toMatch(/\\?"(is_correct|correct|correct_choice_ids|correct_choices|answer_key|answer_keys|explanation|model_answer)\\?"\s*:/);
    expect(everything).not.toMatch(/\b(is_correct|answer_key|correct_choice_ids)\b/);
    for (const s of Object.values(secret)) expect(everything).not.toContain(s);
    // Correct choices are indistinguishable: each appears exactly as often as an unselected wrong choice.
    const id = (list: { id: string; label: string }[], label: string) => list.find((c) => c.label === label)!.id;
    const pairs: [string, string][] = [
      [id(c1, q1.correct), id(c1, q1.other)],
      [q1.correct, q1.other],
      [id(c2, q2.correct[0]), id(c2, q2.other)],
      [id(c2, q2.correct[1]), id(c2, q2.other)],
      [q2.correct[0], q2.other],
      [q2.correct[1], q2.other],
    ];
    for (const [correct, reference] of pairs) {
      expect(occurrences(everything, reference)).toBeGreaterThan(0);
      expect(occurrences(everything, correct), `occurrences of a correct choice vs. a wrong one (${correct})`).toBe(occurrences(everything, reference));
    }

    await expectNoAxeViolations(p04);
    await expectFitsAllWidths(p04);

    // The overview offers to resume the same attempt instead of starting another.
    await p04.goto(quizBase);
    await expect(p04.getByRole("link", { name: "Resume attempt 1" }).first()).toHaveAttribute("href", new RegExp(`${attemptId}$`));
    await expect(p04.getByRole("button", { name: /Start attempt/ })).toHaveCount(0);

    await p04.getByRole("link", { name: "Resume attempt 1" }).first().click();
    // The same button sits in the sticky timer bar and after the last question.
    await (await hydrated(p04.getByRole("button", { name: "Submit attempt" }).last())).click();
    const confirm = p04.getByRole("dialog", { name: "Submit attempt 1?" });
    await expect(confirm.getByText("After you submit, you cannot change your answers.")).toBeVisible();
    await confirm.getByRole("button", { name: "Submit now" }).click();
    await expect(p04.getByText(/This attempt was submitted at/)).toBeVisible();

    // Review is allowed after submission for this quiz: explanations appear, with the key.
    await p04.goto(quizBase);
    await p04.getByRole("link", { name: "Review attempt 1" }).click();
    await expect(p04.getByText(secret.e1)).toBeVisible();
    await expect(p04.getByText(secret.model)).toBeVisible();
    await expectFitsAllWidths(p04);
    await p04.context().close();
  });

  test("staff grade the short answer; the TA can grade but not author; learners cannot open others' attempts", async ({ browser }) => {
    test.setTimeout(180_000);
    const quizBase = `${course}/quizzes/${quizId}`;
    const mai = await newPage(browser, "mai.tran");
    await mai.goto(`${quizBase}/grade`);
    await expect(mai.getByRole("rowheader", { name: fx.names.participant04 })).toBeVisible();
    await mai.goto(`${quizBase}/grade/${attemptId}`);
    const shortAnswer = mai.getByRole("region", { name: "Question 4 of 4" });
    await hydrated(shortAnswer.getByRole("button", { name: /Save grade/ }));
    await expect(shortAnswer.getByText(q4.answer)).toBeVisible();
    await shortAnswer.getByLabel("Points (0 to 2)").fill("1.5");
    await shortAnswer.getByLabel("Feedback to the learner").fill(`Clear plan ${suffix}`);
    await shortAnswer.getByRole("button", { name: /Save grade/ }).click();
    await expect(shortAnswer.getByText("Grade saved.")).toBeVisible();
    await expectFitsAllWidths(mai);
    await mai.context().close();

    // Results release immediately for this quiz: 0 + 0 + 1 + 1.5 of 7 points.
    const p04 = await newPage(browser, "participant04");
    await p04.goto(quizBase);
    await expect(p04.getByText("35.71%").first()).toBeVisible();
    await p04.context().close();

    const linh = await newPage(browser, "linh.pham");
    for (const path of [`${course}/quizzes/new`, `${quizBase}/edit`, `${quizBase}/preview`]) await expectNotAvailable(linh, path);
    await linh.goto(`${quizBase}/grade`);
    await expect(linh.getByRole("heading", { name: `Attempts and grading: ${quizTitle}` })).toBeVisible();
    await expect(linh.getByText("Only instructors and administrators can grant accommodations.")).toBeVisible();
    await linh.context().close();

    const p03 = await newPage(browser, "participant03");
    for (const path of [`${quizBase}/attempts/${attemptId}`, `${quizBase}/attempts/${attemptId}/review`, `${quizBase}/grade`, `${quizBase}/grade/${attemptId}`, `${quizBase}/edit`]) {
      await expectNotAvailable(p03, path);
    }
    await p03.context().close();
  });

  test("an instructor creates an assignment with a rubric", async ({ browser }) => {
    test.setTimeout(180_000);
    const mai = await newPage(browser, "mai.tran");
    await mai.goto(`${course}/assignments/new`);
    await hydrated(mai.getByRole("button", { name: "Add criterion" }));
    await mai.getByLabel("Title").fill(assignmentTitle);
    await mai.getByLabel("Instructions").fill(`Describe your agent loop. ${suffix}`);
    await mai.getByRole("checkbox", { name: "Link (https)" }).check();
    await mai.locator("#asg-points").fill("10");
    await mai.getByRole("button", { name: "Add criterion" }).click();
    const c1 = mai.getByRole("group", { name: "Criterion 1" });
    await c1.getByLabel("Criterion", { exact: false }).fill("Quality");
    await c1.locator('input[type="number"]').first().fill("6");
    await c1.getByRole("button", { name: "Add level (Criterion 1)" }).click();
    await c1.getByLabel("Level name").fill("Strong");
    await c1.getByRole("listitem").locator('input[type="number"]').fill("6");
    await mai.getByRole("button", { name: "Add criterion" }).click();
    const c2 = mai.getByRole("group", { name: "Criterion 2" });
    await c2.getByLabel("Criterion", { exact: false }).fill("Clarity");
    await c2.locator('input[type="number"]').first().fill("4");
    await expect(mai.getByText("Rubric total: 10 of 10 points")).toBeVisible();
    const due = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 16);
    await mai.locator("#dt-due_at").fill(due);
    await mai.getByLabel("Submissions allowed per learner").fill("5");
    await mai.getByRole("radio", { name: /^Published/ }).check();
    await mai.getByRole("button", { name: "Create assignment" }).click();
    await mai.waitForURL(/\/assignments\/[0-9a-f-]{36}\/edit\?created=1/);
    assignmentId = mai.url().match(new RegExp(`assignments/(${UUID.source})`))?.[1] ?? "";
    expect(assignmentId).toMatch(UUID);
    await expect(mai.getByText("Assignment created.")).toBeVisible();
    await expectFitsAllWidths(mai);
    await mai.context().close();
  });

  test("a learner submits and resubmits with timestamped receipts; a lost response never creates a second version", async ({ browser }) => {
    test.setTimeout(240_000);
    const p03 = await newPage(browser, "participant03");
    const page = `${course}/assignments/${assignmentId}`;
    await p03.goto(page);
    await expect(p03.getByRole("heading", { name: assignmentTitle })).toBeVisible();
    await hydrated(p03.getByRole("button", { name: "Save draft" }));
    await p03.getByLabel("Text submission").fill(`First version ${suffix}`);
    await p03.getByLabel("Add files").setInputFiles({ name: "agent.py", mimeType: "text/x-python", buffer: Buffer.from(`print("agent loop ${suffix}")\n`) });
    await expect(p03.getByRole("link", { name: "agent.py" })).toBeVisible({ timeout: 30_000 });
    await p03.getByRole("button", { name: "Save draft" }).click();
    await expect(p03.getByText(/Draft saved at/)).toBeVisible();

    await p03.getByRole("button", { name: "Submit", exact: true }).click();
    const receipt1 = p03.getByText(/Receipt CS-[0-9A-F]{10} · version 1 · /);
    await expect(receipt1).toBeVisible();
    const code1 = (await receipt1.textContent())!.match(/CS-[0-9A-F]{10}/)![0];

    // Version 2: the response to the first click is lost after the server has saved it.
    await p03.getByLabel("Text submission").fill(`Second version ${suffix}`);
    let dropped = false;
    await p03.route("**/*", async (route) => {
      const req = route.request();
      if (!dropped && req.method() === "POST" && req.headers()["next-action"]) {
        dropped = true;
        await route.fetch();
        await route.abort("connectionreset");
        return;
      }
      await route.continue();
    });
    await p03.getByRole("button", { name: "Submit version 2" }).click();
    await expect(p03.getByText(/could not confirm your submission/)).toBeVisible();
    expect(dropped).toBe(true);
    await p03.unroute("**/*");
    await p03.getByRole("button", { name: "Submit version 2" }).click();
    const receipt2 = p03.getByText(/Receipt CS-[0-9A-F]{10} · version 2 · /);
    await expect(receipt2).toBeVisible();
    await expect(p03.getByText("This submission was already received; no new version was created.")).toBeVisible();
    const code2 = (await receipt2.textContent())!.match(/CS-[0-9A-F]{10}/)![0];
    expect(code2).not.toBe(code1);

    await p03.reload();
    const history = p03.getByRole("table", { name: "Submission history" });
    await expect(history.getByRole("row")).toHaveCount(3);
    await expect(history.getByRole("row").filter({ hasText: code2 }).getByRole("rowheader")).toHaveText("2");
    await expect(history.getByRole("row").filter({ hasText: code1 }).getByRole("rowheader")).toHaveText("1");
    await expect(p03.getByText("2 of 5 submissions used")).toBeVisible();
    await expectNoAxeViolations(p03);
    await expectFitsAllWidths(p03);

    const api03 = await apiAs("participant03");
    const { data: sub } = await api03.from("submissions").select("id").eq("assignment_id", assignmentId).single();
    submissionId = (sub as { id: string }).id;
    await p03.context().close();
  });

  test("staff work the grading queue, return work for revision, grade with the rubric and publish; others see nothing", async ({ browser }) => {
    test.setTimeout(300_000);
    const base = `${course}/assignments/${assignmentId}`;

    // Learners: no staff pages, and no other learner's work through the API either.
    const p04 = await newPage(browser, "participant04");
    for (const path of [`${base}/grade`, `${base}/grade/${submissionId}`, `${base}/edit`, `${course}/assignments/new`]) await expectNotAvailable(p04, path);
    await p04.context().close();
    const api04 = await apiAs("participant04");
    expect((await api04.from("submissions").select("id").eq("id", submissionId)).data).toEqual([]);
    expect((await api04.from("submission_versions").select("id").eq("submission_id", submissionId)).data).toEqual([]);

    // The TA may grade but not author.
    const linh = await newPage(browser, "linh.pham");
    for (const path of [`${course}/assignments/new`, `${base}/edit`]) await expectNotAvailable(linh, path);
    await linh.goto(`${base}/grade`);
    const filters = linh.getByRole("navigation", { name: "Filter learners by status" });
    await expect(filters.getByRole("link", { name: "All learners (2)" })).toBeVisible();
    await expect(filters.getByRole("link", { name: "To grade (1)" })).toBeVisible();
    await expect(filters.getByRole("link", { name: "Not submitted (1)" })).toBeVisible();
    await expect(filters.getByRole("link", { name: "Graded (0)" })).toBeVisible();
    await linh.context().close();

    const mai = await newPage(browser, "mai.tran");
    await mai.goto(`${base}/grade?filter=to_grade`);
    await expect(mai.getByRole("table")).toContainText(fx.names.participant03);
    await expect(mai.getByRole("table")).not.toContainText(fx.names.participant04);
    await mai.getByRole("link", { name: `Grade (${fx.names.participant03})` }).click();
    await expect(mai.getByRole("heading", { name: "Version 2", exact: true })).toBeVisible();
    await expect(mai.getByText(`Second version ${suffix}`)).toBeVisible();
    await expectFitsAllWidths(mai);

    // Files are offered only as downloads; code arrives as a text attachment. (Storage keeps the
    // browser's type for small uploads, e.g. text/x-python, rather than the declared text/plain.)
    const fileLink = mai.getByRole("link", { name: "Download agent.py" }).first();
    const href = (await fileLink.getAttribute("href"))!;
    expect(href).toMatch(new RegExp(`^/api/assets/${UUID.source}\\?download=1$`));
    const redirect = await mai.request.get(href, { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    const file = await mai.request.get(redirect.headers()["location"]);
    expect(file.headers()["content-type"]).toMatch(/^text\/(plain|x-python)/);
    expect(file.headers()["content-disposition"] ?? "").toMatch(/attachment/);
    expect(await file.text()).toContain(`agent loop ${suffix}`);

    // Return for revision with a note.
    const note = `Please add an evaluation plan ${suffix}`;
    await (await hydrated(mai.getByRole("button", { name: "Return for revision" }))).click();
    const returnDialog = mai.getByRole("dialog", { name: "Return this submission for revision?" });
    await returnDialog.getByLabel("Note to the learner").fill(note);
    await returnDialog.getByRole("button", { name: "Return for revision" }).click();
    await expect(mai.getByText("Returned for revision. Waiting for the learner to submit a new version.")).toBeVisible();

    const p03 = await newPage(browser, "participant03");
    await p03.goto(base);
    await expect(p03.getByText(note)).toBeVisible();
    await hydrated(p03.getByRole("button", { name: "Submit version 3" }));
    await p03.getByLabel("Text submission").fill(`Third version with an evaluation plan ${suffix}`);
    await p03.getByRole("button", { name: "Submit version 3" }).click();
    await expect(p03.getByText(/Receipt CS-[0-9A-F]{10} · version 3 · /)).toBeVisible();

    // Grade the new version with the rubric (a level fills its score) and add feedback.
    const feedback = `Strong loop design ${suffix}`;
    await mai.reload();
    await expect(mai.getByRole("heading", { name: "Version 3", exact: true })).toBeVisible();
    await (await hydrated(mai.getByRole("button", { name: "Strong: 6" }))).click();
    await expect(mai.getByLabel("Score for Quality (0 to 6)")).toHaveValue("6");
    await mai.getByLabel("Score for Clarity (0 to 4)").fill("3");
    await expect(mai.getByText("Total: 9 / 10")).toBeVisible();
    await mai.getByLabel("Feedback to the learner").fill(feedback);
    await mai.getByRole("button", { name: "Save grade" }).click();
    await expect(mai.getByText("Grade saved. It is not visible to the learner until it is published.")).toBeVisible();

    // Before publication the learner sees that grading happened, not the points or feedback.
    await p03.reload();
    await expect(p03.getByText(/Your submission has been graded\. The grade and feedback appear here when your instructor releases them\./)).toBeVisible();
    expect(await p03.content()).not.toContain(feedback);

    await mai.reload();
    await (await hydrated(mai.getByRole("button", { name: "Publish grade" }))).click();
    await mai.getByRole("dialog", { name: "Publish this grade?" }).getByRole("button", { name: "Publish" }).click();
    await expect(mai.getByText(/Published to the learner/).first()).toBeVisible();

    await p03.reload();
    const gradePanel = p03.locator("section").filter({ has: p03.getByRole("heading", { name: "Your grade" }) });
    await expect(gradePanel.getByText("9 / 10", { exact: true })).toBeVisible();
    await expect(gradePanel.getByText(feedback)).toBeVisible();
    await expect(gradePanel.getByText(new RegExp(`Quality.*6 / 6`))).toBeVisible();
    await p03.context().close();

    await mai.goto(`${base}/grade`);
    await expect(mai.getByRole("navigation", { name: "Filter learners by status" }).getByRole("link", { name: "Graded (1)" })).toBeVisible();
    await expect(mai.getByRole("row", { name: new RegExp(esc(fx.names.participant03)) })).toContainText("Released");
    await mai.context().close();
  });
});
