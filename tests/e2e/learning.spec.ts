import { expect as baseExpect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expectNoAxeViolations, expectNoHorizontalOverflow, sampleEmail, signIn, uniqueSuffix } from "./helpers";

// Course content journeys (AC06, AC08) on a course and offering this spec creates for
// itself on every run: Mai builds, previews, publishes and releases content; learners see
// it with server-enforced prerequisites; staff follow progress and grant overrides; people
// outside the offering get "Page not available", files included. Seeded courses are never
// touched, and only participant01/participant02 learner state changes.

// The shared dev server compiles routes on first use and serves five other streams, so
// assertions here wait longer than the 10 s default.
const expect = baseExpect.configure({ timeout: 60_000 });

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const NOT_AVAILABLE = { level: 1, name: "Page not available" } as const;
const DAY = 86_400_000;
const PDF = "seed/assets/agent-architectures-reading.pdf";
const CAPTIONS = "seed/assets/sample-lecture.en.vtt";
/** A 12-second, 1.1 KB VP8 WebM (a plain blue frame) generated for this spec. */
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
type UploadFile = string | { name: string; mimeType: string; buffer: Buffer };
const STAFF = "mai.tran";
const LEARNERS = ["participant01", "participant02"] as const;

type Fixture = {
  suffix: string;
  code: string;
  offeringId: string;
  versionId: string;
  users: Record<string, string>;
  names: Record<string, string>;
};

const contexts: BrowserContext[] = [];

async function newPage(browser: Browser, who: string): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  try {
    await signIn(page, who);
  } catch (error) {
    // Under load the shared server can need longer than the helper's 30 s: wait, then retry once.
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }).catch(() => undefined);
    if (!new URL(page.url()).pathname.startsWith("/login")) return page;
    if (!(error instanceof Error) || !/Timeout/i.test(error.message)) throw error;
    await signIn(page, who);
  }
  return page;
}

test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close()));
});

/** The shared axe check; on failure, also prints which elements failed and on which page. */
async function axe(page: Page) {
  try {
    await expectNoAxeViolations(page);
  } catch (error) {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const nodes = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} ${n.html.slice(0, 200)}`));
    console.log(`axe violations on ${page.url()}:\n${nodes.join("\n")}`);
    throw error;
  }
}

/** Service-role client, used only to create and retire this spec's own fixture. */
function adminDb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are needed to create the learning fixture.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Signed-in client for a sample account, to prove the database itself refuses. */
async function supabaseAs(who: string): Promise<SupabaseClient> {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: sampleEmail(who), password: process.env.SEED_PASSWORD ?? "" });
  if (error) throw error;
  return supabase;
}

/** Awaits a fixture call that returns nothing useful, failing loudly when the database refused. */
async function ok(label: string, query: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
}

/** Awaits a fixture query and returns its rows, failing loudly when the database refused. */
async function one<R = { id: string }>(label: string, query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<R> {
  const { data, error } = await query;
  if (error || data === null || data === undefined) throw new Error(`${label}: ${error?.message ?? "no row returned"}`);
  return data as R;
}

async function userIds(db: SupabaseClient, locals: string[]): Promise<Record<string, string>> {
  const wanted = new Map(locals.map((l) => [sampleEmail(l), l]));
  const found: Record<string, string> = {};
  for (let page = 1; page <= 50 && Object.keys(found).length < locals.length; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    for (const u of data.users) {
      const local = u.email ? wanted.get(u.email) : undefined;
      if (local) found[local] = u.id;
    }
    if (data.users.length < 100) break;
  }
  for (const l of locals) if (!found[l]) throw new Error(`Sample account ${l} not found (run the seed first).`);
  return found;
}

/**
 * A sample cohort and course with an empty draft version 1, and an offering that uses it,
 * not yet visible to learners (started a week ago, Asia/Ho_Chi_Minh). Mai teaches it with
 * author permission; participant01 and participant02 are enrolled.
 */
async function createFixture(kind: string): Promise<Fixture> {
  const db = adminDb();
  const suffix = uniqueSuffix();
  const code = `E2E-LRN-${kind}-${suffix}`;
  const users = await userIds(db, [STAFF, ...LEARNERS]);
  const profiles = await one<{ id: string; display_name: string }[]>("profiles", db.from("profiles").select("id, display_name").in("id", Object.values(users)));
  const names = Object.fromEntries(Object.entries(users).map(([local, id]) => [local, profiles.find((p) => p.id === id)?.display_name ?? local]));
  const now = Date.now();
  const cohort = await one(
    "cohort",
    db
      .from("cohorts")
      .insert({
        code,
        name: `E2E learning cohort ${suffix}`,
        timezone: "Asia/Ho_Chi_Minh",
        status: "active",
        starts_on: new Date(now - 7 * DAY).toISOString().slice(0, 10),
        ends_on: new Date(now + 60 * DAY).toISOString().slice(0, 10),
        is_sample: true,
      })
      .select("id")
      .single(),
  );
  const course = await one("course", db.from("courses").insert({ code, title: `Agent Workshop ${suffix}`, is_sample: true }).select("id").single());
  const version = await one(
    "course version",
    db
      .from("course_versions")
      .insert({
        course_id: course.id,
        version_no: 1,
        status: "draft",
        title: `Agent Workshop ${suffix}`,
        summary: "A short workshop on agent loops, built by the learning end-to-end tests.",
        objectives: ["Explain the agent loop", "Compare agent architectures"],
        audience: "Practitioners new to agents",
        expected_effort: "2 hours",
        prerequisites_text: "Basic Python",
        grading_policy: "Completion of the required lessons.",
      })
      .select("id")
      .single(),
  );
  const offering = await one(
    "offering",
    db
      .from("course_offerings")
      .insert({
        course_id: course.id,
        course_version_id: version.id,
        cohort_id: cohort.id,
        code,
        term_label: "E2E",
        starts_at: new Date(now - 7 * DAY).toISOString(),
        ends_at: new Date(now + 60 * DAY).toISOString(),
        timezone: "Asia/Ho_Chi_Minh",
        status: "draft",
        is_sample: true,
      })
      .select("id")
      .single(),
  );
  await one(
    "staff assignment",
    db
      .from("staff_assignments")
      .insert({ offering_id: offering.id, user_id: users[STAFF], role: "instructor", can_author: true, can_grade: true, can_publish_grades: true })
      .select("offering_id")
      .single(),
  );
  await one(
    "enrollments",
    db
      .from("enrollments")
      .insert(LEARNERS.map((l) => ({ offering_id: offering.id, user_id: users[l], status: "active", source: "admin" })))
      .select("id"),
  );
  return { suffix, code, offeringId: offering.id, versionId: version.id, users, names };
}

/** After the run nobody keeps seeing the fixture: learners withdrawn, staff unassigned, offering archived. */
async function retireFixture(f: Fixture | undefined) {
  if (!f) return;
  const db = adminDb();
  await db.from("enrollments").update({ status: "withdrawn" }).eq("offering_id", f.offeringId);
  await db.from("staff_assignments").delete().eq("offering_id", f.offeringId);
  // Archiving needs a published version; a run that stopped earlier leaves a hidden draft offering.
  await db.from("course_offerings").update({ status: "archived" }).eq("id", f.offeringId);
}

async function assetStatus(page: Page, assetId: string): Promise<number> {
  return (await page.request.get(`/api/assets/${assetId}`, { maxRedirects: 0 })).status();
}

const idIn = (value: string | null): string => {
  const id = value?.match(UUID)?.[0];
  expect(id, `uuid in ${value}`).toBeTruthy();
  return id as string;
};

test.describe("course content from authoring to learning", () => {
  test.describe.configure({ mode: "serial" });

  let f: Fixture;
  const t = { module: "", text: "", pdf: "", video: "", body: "", transcript: "" };
  const lessons = { text: "", pdf: "", video: "" };
  const assets = { pdf: "", video: "", captions: "" };

  test.beforeAll(async () => {
    f = await createFixture("UI");
    t.module = `Week 1: Agent loops ${f.suffix}`;
    t.text = `Welcome and orientation ${f.suffix}`;
    t.pdf = `Reading: agent architectures ${f.suffix}`;
    t.video = `Lecture: the agent loop ${f.suffix}`;
    t.body = `Agent loops observe, plan, act and check ${f.suffix}`;
    t.transcript = `Transcript ${f.suffix}: an agent loop observes, plans, acts and checks the result.`;
  });

  test.afterAll(async () => {
    await retireFixture(f);
  });

  test("an instructor builds a module with a reading, a PDF and a captioned video, reorders, previews, publishes and releases it", async ({ browser }) => {
    test.setTimeout(900_000);
    const base = `/courses/${f.offeringId}`;
    const manage = `${base}/content/manage`;

    // Not released yet: enrolled learners cannot open the offering at all.
    const p01 = await newPage(browser, "participant01");
    await p01.goto(base);
    await expect(p01.getByRole("heading", NOT_AVAILABLE)).toBeVisible();

    const mai = await newPage(browser, STAFF);
    await mai.goto(manage);
    await expect(mai.getByRole("heading", { level: 2, name: "Manage content" })).toBeVisible();
    await expect(mai.getByText("Draft version 1 is in progress.")).toBeVisible();
    await expect(mai.getByRole("button", { name: "Release to learners" })).toBeDisabled();
    await expect(mai.getByText("Release becomes available once this offering uses a published version.")).toBeVisible();
    await expectNoHorizontalOverflow(mai);
    await axe(mai);

    await mai.getByRole("link", { name: "Edit draft", exact: true }).click();
    await expect(mai).toHaveURL(new RegExp(`/content/manage/versions/${f.versionId}$`));
    await expect(mai.getByRole("button", { name: "Publish draft" })).toBeDisabled();
    await expect(mai.getByText("Add at least one lesson before publishing.")).toBeVisible();

    const addModule = mai.getByRole("region", { name: "Add a module" });
    await addModule.getByLabel("Module title").fill(t.module);
    await addModule.getByRole("button", { name: "Add module" }).click();
    await expect(addModule.getByText("Module added.")).toBeVisible();
    const moduleCard = mai.getByRole("region", { name: t.module, exact: true });
    await expect(moduleCard.getByText("No lessons in this module yet.")).toBeVisible();

    const addLesson = async (title: string, type: string): Promise<string> => {
      await mai.goto(`${manage}/versions/${f.versionId}`);
      const card = mai.getByRole("region", { name: t.module, exact: true });
      await card.getByText(`Add a lesson to ${t.module}`).click();
      await card.getByLabel("Lesson title").fill(title);
      await card.getByLabel("Content type").selectOption({ label: type });
      await card.getByRole("button", { name: "Add lesson" }).click();
      await expect(mai).toHaveURL(/\/lessons\/[0-9a-f-]{36}\?created=1$/);
      await expect(mai.getByText("Lesson added. Fill in its details and attach files, then save.")).toBeVisible();
      await expect(mai.getByRole("heading", { level: 3, name: `Edit lesson: ${title}` })).toBeVisible();
      return idIn(new URL(mai.url()).pathname.split("/").pop() ?? "");
    };
    const saveLesson = async () => {
      const details = mai.getByRole("region", { name: "Lesson details" });
      await details.getByRole("button", { name: "Save lesson" }).click();
      await expect(details.getByText("Lesson saved.")).toBeVisible();
    };
    const attach = async (role: string, file: UploadFile, language?: string) => {
      const add = mai.getByRole("region", { name: "Add files" });
      await add.getByLabel("Role", { exact: true }).selectOption({ label: role });
      if (language) await add.getByLabel("Caption language").fill(language);
      await add.getByLabel("Choose files to upload").setInputFiles(file);
      await expect(add.getByRole("list", { name: "Uploads" }).getByText("Uploaded")).toBeVisible({ timeout: 240_000 });
      await add.getByRole("button", { name: "Attach uploaded files" }).click();
      await expect(add.getByText("Files attached to the lesson.")).toBeVisible();
    };
    const files = () => mai.getByRole("list", { name: "Files attached to this lesson" });

    // 1. A reading with Markdown text.
    lessons.text = await addLesson(t.text, "Reading");
    await mai.getByLabel("Lesson text").fill(`## Why agents\n\n${t.body}.\n\n- Observe\n- Plan\n\nMore in [the platform guide](https://example.org/guide).`);
    await mai.getByLabel("Estimated duration (minutes)").fill("5");
    await saveLesson();

    // 2. An uploaded, captioned video that completes when played (added before the PDF; reordered below).
    lessons.video = await addLesson(t.video, "Video");
    // The playback rule is refused until a video is attached.
    await mai.getByLabel("Completion rule").selectOption("video_watched");
    await mai.getByRole("region", { name: "Lesson details" }).getByRole("button", { name: "Save lesson" }).click();
    await expect(mai.getByText("The playback rule needs an uploaded primary video. Attach a video first or use acknowledgement.")).toBeVisible();
    await attach("Primary (shown in the lesson)", VIDEO);
    await attach("Captions", CAPTIONS, "en");
    await expect(files().getByRole("listitem")).toHaveCount(2);
    await expect(files().getByRole("listitem").filter({ hasText: "sample-lecture.en.vtt" })).toContainText("Language: English (en)");
    await mai.getByLabel("Completion rule").selectOption("video_watched");
    await mai.getByLabel("Transcript").fill(t.transcript);
    await mai.getByLabel("Estimated duration (minutes)").fill("1");
    await saveLesson();

    // 3. A PDF with an accessible title.
    lessons.pdf = await addLesson(t.pdf, "PDF");
    await attach("Primary (shown in the lesson)", PDF);
    const pdfRow = files().getByRole("listitem").filter({ hasText: "agent-architectures-reading.pdf" });
    await expect(pdfRow).toContainText("Primary (shown in the lesson)");
    await expect(pdfRow).toContainText("Uploaded by Mai Trần");
    await pdfRow.getByText("Details and accessibility for agent-architectures-reading.pdf").click();
    await pdfRow.getByLabel("Title", { exact: true }).fill("Agent architectures reading");
    await pdfRow.getByRole("button", { name: "Save details" }).click();
    await expect(pdfRow.getByText("File details saved.")).toBeVisible();
    await expect(files()).toContainText("Agent architectures reading");
    await expectNoHorizontalOverflow(mai);
    await axe(mai);
    // The file editor also fits tablet and phone screens.
    for (const width of [768, 390]) {
      await mai.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(mai);
      await axe(mai);
    }
    await mai.setViewportSize({ width: 1440, height: 900 });

    // Reorder: the PDF moves above the video.
    await mai.getByRole("link", { name: "Back to version 1" }).click();
    const rows = moduleCard.getByRole("listitem");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(2)).toContainText(t.pdf);
    await expect(rows.nth(1)).toContainText("1 min");
    await moduleCard.getByRole("button", { name: `Move ${t.pdf} up` }).click();
    await expect(mai.getByText(`Moved “${t.pdf}” to position 2 of 3.`)).toBeAttached();
    await expect(rows.nth(0)).toContainText(t.text);
    await expect(rows.nth(1)).toContainText(t.pdf);
    await expect(rows.nth(2)).toContainText(t.video);
    await expect(rows.nth(2)).toContainText("Playback rule");
    await expect(moduleCard.getByRole("button", { name: `Move ${t.pdf} up` })).toBeFocused();
    await expectNoHorizontalOverflow(mai);
    await axe(mai);

    // Preview the draft with the real lesson viewer: read-only, nothing recorded.
    await moduleCard.getByRole("link", { name: `Preview ${t.text}` }).click();
    await expect(mai.getByRole("note").filter({ hasText: "Draft preview: read-only, no progress is recorded." })).toBeVisible();
    await expect(mai.getByText(t.body)).toBeVisible();
    await expect(mai.getByRole("link", { name: "the platform guide" })).toHaveAttribute("href", "https://example.org/guide");
    await expect(mai.getByRole("button", { name: "Mark as complete" })).toBeDisabled();
    await expect(mai.getByText("Staff preview: read-only, no progress is recorded.").last()).toBeVisible();

    await mai.getByRole("link", { name: `Next lesson ${t.pdf}` }).click();
    const pdfFrame = mai.locator('iframe[title="PDF: Agent architectures reading"]');
    await expect(pdfFrame).toBeAttached();
    assets.pdf = idIn(await pdfFrame.getAttribute("src"));
    await expect(mai.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", `/api/assets/${assets.pdf}?download=1`);
    expect(await assetStatus(mai, assets.pdf)).toBe(302);

    await mai.getByRole("link", { name: `Next lesson ${t.video}` }).click();
    const video = mai.locator("video");
    await expect(video).toBeVisible();
    assets.video = idIn(await video.locator("source").first().getAttribute("src"));
    const track = video.locator("track");
    await expect(track).toHaveAttribute("srclang", "en");
    await expect(track).toHaveAttribute("label", "English");
    assets.captions = idIn(await track.getAttribute("src"));
    await expect(mai.getByText("Preview: your position is not saved.")).toBeVisible();
    await expect(mai.getByRole("button", { name: "Mark as played" })).toBeDisabled();
    await mai.getByText("Show transcript").click();
    await expect(mai.getByText(t.transcript)).toBeVisible();
    await expectNoHorizontalOverflow(mai);
    await axe(mai);

    // Publish (the dialog states that published versions are immutable).
    await mai.goto(`${manage}/versions/${f.versionId}`);
    await mai.getByRole("button", { name: "Publish draft" }).click();
    const publish = mai.getByRole("dialog", { name: "Publish version 1?" });
    await expect(publish).toContainText("Published versions are immutable");
    await publish.getByRole("button", { name: "Publish draft" }).click();
    await expect(mai.getByText("Version 1 is published.")).toBeVisible();
    await expect(mai.getByText("Published versions are read-only. Create a draft on Manage content to make changes.")).toBeVisible();
    await expect(mai.getByRole("button", { name: "Publish draft" })).toHaveCount(0);
    await expect(mai).not.toHaveURL(/notice=/);

    // Release the offering to its learners.
    await mai.goto(manage);
    await mai.getByRole("button", { name: "Release to learners" }).click();
    const release = mai.getByRole("dialog", { name: `Release ${f.code} to learners?` });
    await expect(release).toContainText("Enrolled learners can open the course right away");
    await release.getByRole("button", { name: "Release to learners" }).click();
    await expect(mai.getByText("The offering is now visible to learners.")).toBeVisible();
    await expect(mai.getByText("Visible to learners", { exact: true })).toBeVisible();

    // The video waits for the reading; a cycle is refused with a clear message.
    await mai.goto(`${manage}/rules`);
    const lessonRule = mai.getByRole("region", { name: "Require another lesson" });
    await lessonRule.getByLabel("Lesson to lock").selectOption({ label: t.video });
    await lessonRule.getByLabel("Lesson that must be completed first").selectOption({ label: t.text });
    await lessonRule.getByRole("button", { name: "Add condition" }).click();
    await expect(lessonRule.getByText("Condition added.")).toBeVisible();
    await expect(mai.getByText(`Requires completing “${t.text}”`, { exact: true })).toBeVisible();
    await lessonRule.getByLabel("Lesson to lock").selectOption({ label: t.text });
    await lessonRule.getByLabel("Lesson that must be completed first").selectOption({ label: t.video });
    await lessonRule.getByRole("button", { name: "Add condition" }).click();
    await expect(lessonRule.getByText("That would create a cycle: the lessons would wait for each other. Choose a different lesson.")).toBeVisible();
    await expectNoHorizontalOverflow(mai);
    await axe(mai);

    // Staff see every lesson unlocked, with the learners' conditions listed.
    await mai.goto(`${base}/content`);
    await expect(mai.getByText("Staff view: all lessons are shown unlocked.", { exact: false })).toBeVisible();
    await expect(mai.getByText(`Requires completing “${t.text}”`, { exact: true })).toBeVisible();
  });

  test("learners see released lessons; a locked lesson and its files are refused until the prerequisite is complete", async ({ browser }) => {
    test.setTimeout(420_000);
    const base = `/courses/${f.offeringId}`;
    const p01 = await newPage(browser, "participant01");

    await p01.goto(`${base}/content`);
    await expect(p01.getByRole("heading", { level: 2, name: "Course content" })).toBeVisible();
    const outlineRows = p01.getByRole("listitem").filter({ has: p01.getByRole("link") });
    await expect(p01.getByRole("link", { name: t.text, exact: true })).toBeVisible();
    await expect(p01.getByRole("link", { name: t.pdf, exact: true })).toBeVisible();
    const videoRow = outlineRows.filter({ hasText: t.video }).last();
    await expect(videoRow).toContainText("Locked");
    await expect(videoRow).toContainText(`Complete “${t.text}” first.`);
    await expect(p01.getByRole("link", { name: "Start", exact: true })).toHaveAttribute("href", `${base}/content/${lessons.text}`);
    await expectNoHorizontalOverflow(p01);
    await axe(p01);

    // The locked lesson page shows only the unmet condition: no player, files or transcript.
    await p01.goto(`${base}/content/${lessons.video}`);
    await expect(p01.getByRole("heading", { name: "This lesson is locked" })).toBeVisible();
    await expect(p01.getByText(`Complete “${t.text}” first.`)).toBeVisible();
    await expect(p01.locator("video")).toHaveCount(0);
    const lockedHtml = await p01.content();
    expect(lockedHtml).not.toContain(assets.video);
    expect(lockedHtml).not.toContain(assets.captions);
    expect(lockedHtml).not.toContain(t.transcript);
    expect(await assetStatus(p01, assets.video)).toBe(404);
    expect(await assetStatus(p01, assets.captions)).toBe(404);
    await axe(p01);
    // The database refuses to record progress on it as well.
    const db01 = await supabaseAs("participant01");
    const refused = await db01.rpc("mark_lesson_progress", { p_offering: f.offeringId, p_lesson: lessons.video, p_position_seconds: 20, p_duration_seconds: 20, p_complete: true });
    expect(refused.error?.code).toBe("42501");

    // Meeting the condition: the link goes to the reading, which is acknowledged.
    await p01.getByRole("link", { name: `Go to ${t.text}` }).click();
    await expect(p01).toHaveURL(new RegExp(`/content/${lessons.text}$`));
    await expect(p01.getByText(t.body)).toBeVisible();
    await expect(p01.getByRole("link", { name: "the platform guide" })).toHaveAttribute("rel", /noopener/);
    await expectNoHorizontalOverflow(p01);
    await axe(p01);
    await p01.getByRole("button", { name: "Mark as complete" }).click();
    await expect(p01.getByText("Lesson marked complete.")).toBeVisible();
    await expect(p01.getByText(/Completed [A-Z][a-z]{2} \d{1,2}, \d{4}/).first()).toBeVisible();

    // The PDF lesson: inline preview plus download, both through the access-checked file route.
    await p01.getByRole("link", { name: `Next lesson ${t.pdf}` }).click();
    await expect(p01.locator('iframe[title="PDF: Agent architectures reading"]')).toHaveAttribute("src", `/api/assets/${assets.pdf}`);
    await expect(p01.getByRole("link", { name: "Download PDF" })).toBeVisible();
    expect(await assetStatus(p01, assets.pdf)).toBe(302);

    // Now the video opens, with captions; "played" needs 90% of it, and the position is kept.
    await p01.goto(`${base}/content/${lessons.video}`);
    const video = p01.locator("video");
    await expect(video).toBeVisible();
    await expect(video.locator("track")).toHaveAttribute("srclang", "en");
    expect(await assetStatus(p01, assets.video)).toBe(302);
    expect(await assetStatus(p01, assets.captions)).toBe(302);
    const played = p01.getByRole("button", { name: "Mark as played" });
    await expect(played).toBeDisabled();
    await expect(p01.getByText("Played so far: 0% of the video (90% needed).")).toBeVisible();
    await expectNoHorizontalOverflow(p01);
    await axe(p01);

    // The player tracks playback once it has the metadata and the page is interactive.
    await expect(video).toHaveAttribute("data-state", "ready");
    await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      if (v.readyState < 1) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
      v.currentTime = 5;
      await v.play();
      await new Promise((r) => setTimeout(r, 1500));
      v.pause();
    });
    await expect(p01.getByText(/Position saved at 0:0[5-9]\./)).toBeVisible();
    await p01.reload();
    await expect(p01.getByText(/Resumed at 0:0[5-9]\./)).toBeVisible();
    expect(await p01.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(5);

    await expect(p01.locator("video")).toHaveAttribute("data-state", "ready");
    await p01.locator("video").evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      v.currentTime = Math.max(0, v.duration - 1.5);
      await v.play();
      await new Promise((r) => v.addEventListener("ended", r, { once: true }));
    });
    await expect(played).toBeEnabled();
    await played.click();
    await expect(p01.getByText("Lesson marked as played.")).toBeVisible();
    await expect(p01.getByText(/Played [A-Z][a-z]{2} \d{1,2}, \d{4}/).first()).toBeVisible();

    // Server-computed progress on the Overview: 2 of 3 required, continue with the PDF.
    await p01.goto(base);
    await expect(p01.getByText("2 of 3 required items complete")).toBeVisible();
    await expect(p01.getByRole("link", { name: "Continue learning" })).toHaveAttribute("href", `${base}/content/${lessons.pdf}`);
    await expect(p01.getByText("Mai Trần")).toBeVisible();
    await expectNoHorizontalOverflow(p01);
    await axe(p01);

    // The PDF and video lessons at tablet and phone widths (the @responsive test covers the rest).
    for (const width of [768, 390]) {
      await p01.setViewportSize({ width, height: 900 });
      for (const [id, title] of [
        [lessons.pdf, t.pdf],
        [lessons.video, t.video],
      ]) {
        await p01.goto(`${base}/content/${id}`);
        await expect(p01.getByRole("heading", { level: 2, name: title })).toBeVisible();
        await expectNoHorizontalOverflow(p01);
        await axe(p01);
      }
    }
  });

  test("staff follow progress on People; an override opens a lesson until it is revoked; new conditions never remove progress", async ({ browser }) => {
    test.setTimeout(420_000);
    const base = `/courses/${f.offeringId}`;
    const p02Name = f.names.participant02;
    const p01Name = f.names.participant01;

    const mai = await newPage(browser, STAFF);
    await mai.goto(`${base}/people`);
    await expect(mai.getByRole("heading", { level: 2, name: "People" })).toBeVisible();
    await expect(mai.getByRole("region", { name: "Staff", exact: true })).toContainText("Mai Trần");
    await expect(mai.getByRole("region", { name: "Learners", exact: true })).toContainText(p01Name);
    await expect(mai.getByRole("region", { name: "Learners", exact: true })).toContainText(p02Name);
    expect(await mai.content()).not.toContain("@sample.crewscaler.test");
    const progress = mai.getByRole("region", { name: "Learner progress", exact: true });
    await expect(progress.getByRole("row").filter({ hasText: p01Name })).toContainText("2 of 3 (67%)");
    await expect(progress.getByRole("row").filter({ hasText: p02Name })).toContainText("0 of 3 (0%)");
    await expectNoHorizontalOverflow(mai);
    await axe(mai);

    await progress.getByRole("link", { name: `Grant an override to ${p02Name}` }).click();
    await expect(mai.getByRole("heading", { level: 2, name: `Progress: ${p02Name}` })).toBeVisible();
    await expect(mai.getByRole("row").filter({ hasText: t.video })).toContainText(`Complete “${t.text}” first.`);
    const grant = mai.getByRole("region", { name: "Grant an override", exact: true });
    await expect(grant.getByLabel("Lesson")).toHaveValue(/[0-9a-f-]{36}/);
    await grant.getByLabel("Lesson").selectOption({ label: `${t.video} (locked)` });
    // A reason is required, and only staff with author permission can grant (the database agrees).
    await expect(grant.getByLabel("Reason")).toHaveAttribute("minlength", "3");
    const db02 = await supabaseAs("participant02");
    const selfGrant = await db02.from("prerequisite_overrides").insert({
      offering_id: f.offeringId,
      user_id: f.users.participant02,
      target_lesson_lineage: lessons.video,
      reason: "Letting myself in",
      granted_by: f.users.participant02,
    });
    expect(selfGrant.error).not.toBeNull();
    await grant.getByLabel("Reason").fill(`Watched the recording together in office hours ${f.suffix}`);
    await grant.getByRole("button", { name: "Grant override" }).click();
    await expect(grant.getByText("Override granted. The learner can open the lesson now.")).toBeVisible();
    const overrides = mai.getByRole("region", { name: "Overrides", exact: true });
    const overrideRow = overrides.getByRole("row").filter({ hasText: `office hours ${f.suffix}` });
    await expect(overrideRow).toContainText("Mai Trần");
    await expect(overrideRow).toContainText("Active");
    await expect(mai.getByRole("row").filter({ hasText: t.video }).first()).toContainText("Unlocked by override");
    await expectNoHorizontalOverflow(mai);
    await axe(mai);

    // participant02 can open the video now, files included.
    const p02 = await newPage(browser, "participant02");
    await p02.goto(`${base}/content/${lessons.video}`);
    await expect(p02.locator("video")).toBeVisible();
    expect(await assetStatus(p02, assets.video)).toBe(302);

    // Revoking puts the condition back; the decision stays on record.
    await overrideRow.getByRole("button", { name: /^Revoke/ }).click();
    const revoke = mai.getByRole("dialog", { name: "Revoke this override?" });
    await revoke.getByRole("button", { name: "Revoke" }).click();
    await expect(mai.getByText("Override revoked.")).toBeVisible();
    await expect(mai.getByRole("region", { name: "Overrides", exact: true }).getByRole("row").filter({ hasText: `office hours ${f.suffix}` })).toContainText("Revoked");
    await p02.reload();
    await expect(p02.getByRole("heading", { name: "This lesson is locked" })).toBeVisible();
    expect(await assetStatus(p02, assets.video)).toBe(404);

    // The rules page lists the override with who granted it and when.
    await mai.goto(`${base}/content/manage/rules`);
    await expect(mai.getByRole("table", { name: "Per-learner overrides in this offering" }).getByRole("row").filter({ hasText: p02Name })).toContainText("Revoked");

    // A later condition on a lesson participant01 completed locks it again but keeps the completion.
    const release = mai.getByRole("region", { name: "Schedule a release" });
    await release.getByLabel("Lesson to lock").selectOption({ label: t.text });
    await release.getByLabel("Release date and time").fill("2030-01-15T09:00");
    await release.getByRole("button", { name: "Add condition" }).click();
    await expect(release.getByText("Condition added.")).toBeVisible();
    const p01 = await newPage(browser, "participant01");
    await p01.goto(`${base}/content/${lessons.text}`);
    await expect(p01.getByRole("heading", { name: "This lesson is locked" })).toBeVisible();
    await expect(p01.getByText(/You completed this lesson on .+, and that completion still counts\./)).toBeVisible();
    await expect(p01.getByText(/Opens .*2030/)).toBeVisible();
    await p01.goto(base);
    await expect(p01.getByText("2 of 3 required items complete")).toBeVisible();

    // Removing the condition opens it again, still completed.
    const ruleItem = mai.getByRole("listitem").filter({ hasText: /^Releases .*2030/ });
    await ruleItem.getByRole("button", { name: /^Remove/ }).click();
    await mai.getByRole("dialog", { name: "Remove this condition?" }).getByRole("button", { name: "Remove" }).click();
    await expect(mai.getByText("Condition removed.")).toBeVisible();
    await p01.goto(`${base}/content/${lessons.text}`);
    await expect(p01.getByText(t.body)).toBeVisible();
    await expect(p01.getByText(/Completed [A-Z][a-z]{2} \d{1,2}, \d{4}/).first()).toBeVisible();

    // A quiz-score condition on a quiz that has not opened yet never shows learners its title.
    const quizTitle = `Check-in quiz ${f.suffix}`;
    const maiDb = await supabaseAs(STAFF);
    await ok("draft quiz", maiDb.from("quizzes").insert({ offering_id: f.offeringId, title: quizTitle, created_by: f.users[STAFF] }));
    await mai.goto(`${base}/content/manage/rules`);
    const quizRule = mai.getByRole("region", { name: "Require a quiz score" });
    await quizRule.getByLabel("Lesson to lock").selectOption({ label: t.pdf });
    await quizRule.getByLabel("Quiz").selectOption({ label: `${quizTitle} (Draft)` });
    await quizRule.getByLabel("Minimum released score (%)").fill("70");
    await quizRule.getByRole("button", { name: "Add condition" }).click();
    await expect(quizRule.getByText("Condition added.")).toBeVisible();
    await expect(mai.getByText(`Requires at least 70% on “${quizTitle}” (released grade)`, { exact: true })).toBeVisible();
    await p01.goto(`${base}/content/${lessons.pdf}`);
    await expect(p01.getByRole("heading", { name: "This lesson is locked" })).toBeVisible();
    await expect(p01.getByText("Score at least 70% on a quiz that has not opened yet.")).toBeVisible();
    expect(await p01.content()).not.toContain(quizTitle);
    const quizItem = mai.getByRole("listitem").filter({ hasText: /^Requires at least 70%/ });
    await quizItem.getByRole("button", { name: /^Remove/ }).click();
    await mai.getByRole("dialog", { name: "Remove this condition?" }).getByRole("button", { name: "Remove" }).click();
    await expect(mai.getByText("Condition removed.")).toBeVisible();

    // Learners see names and roles only, and never another learner's progress.
    await p01.goto(`${base}/people`);
    await expect(p01.getByRole("region", { name: "Learners", exact: true })).toContainText(p02Name);
    await expect(p01.getByRole("region", { name: "Learner progress", exact: true })).toHaveCount(0);
    expect(await p01.content()).not.toContain("@sample.crewscaler.test");
    await p01.goto(`${base}/people/${f.users.participant02}`);
    await expect(p01.getByRole("heading", NOT_AVAILABLE)).toBeVisible();
  });

  test("people outside the offering, and learners on staff pages, get Page not available", async ({ browser }) => {
    test.setTimeout(300_000);
    const base = `/courses/${f.offeringId}`;

    // participant03 studies in other offerings only.
    const p03 = await newPage(browser, "participant03");
    for (const path of [base, `${base}/content`, `${base}/content/${lessons.text}`, `${base}/people`]) {
      await p03.goto(path);
      await expect(p03.getByRole("heading", NOT_AVAILABLE)).toBeVisible();
      expect(await p03.content()).not.toContain(t.text);
    }
    for (const id of [assets.pdf, assets.video, assets.captions]) expect(await assetStatus(p03, id)).toBe(404);

    // A teaching assistant of another course cannot manage this one.
    const linh = await newPage(browser, "linh.pham");
    for (const path of [`${base}/content/manage`, `${base}/content/manage/rules`, `${base}/content/manage/preview/${lessons.text}`]) {
      await linh.goto(path);
      await expect(linh.getByRole("heading", NOT_AVAILABLE)).toBeVisible();
    }

    // Enrolled learners cannot open authoring pages or drafts of their own course.
    const p01 = await newPage(browser, "participant01");
    for (const path of [`${base}/content/manage`, `${base}/content/manage/versions/${f.versionId}`, `${base}/content/manage/rules`, `${base}/content/manage/preview/${lessons.video}`]) {
      await p01.goto(path);
      await expect(p01.getByRole("heading", NOT_AVAILABLE)).toBeVisible();
    }
  });
});

test.describe("course content layout @responsive", () => {
  test.describe.configure({ mode: "serial" });
  let f: Fixture;
  const lessons = { reading: "", link: "", locked: "" };
  const titles = { module: "", reading: "", link: "", locked: "" };

  // Content is written through Mai's own session (RLS and the publish/release RPCs apply,
  // no uploads), so every viewport gets the same released course quickly.
  test.beforeAll(async () => {
    f = await createFixture("RWD");
    const db = await supabaseAs(STAFF);
    titles.module = `Foundations of agent design with a deliberately long module title ${f.suffix}`;
    titles.reading = `Reading: observation, planning and action in long-running agents ${f.suffix}`;
    titles.link = `External resource: agent evaluation checklist ${f.suffix}`;
    titles.locked = `Workshop: build your first loop ${f.suffix}`;
    const mod = await one(
      "module",
      db.from("modules").insert({ course_version_id: f.versionId, position: 0, title: titles.module, description: "Concepts and vocabulary." }).select("id").single(),
    );
    const rows = await one<{ id: string; title: string; lineage_id: string }[]>(
      "lessons",
      db
        .from("lessons")
        .insert([
          {
            module_id: mod.id,
            course_version_id: f.versionId,
            position: 0,
            title: titles.reading,
            content_type: "text",
            duration_minutes: 15,
            required: true,
            external_url: null,
            body_html: `<h2>Why agents</h2><p>An agent loop observes, plans, acts and checks the result. A_very_long_identifier_without_spaces_${"x".repeat(80)}</p><ul><li>Observe</li><li>Plan</li></ul>`,
          },
          {
            module_id: mod.id,
            course_version_id: f.versionId,
            position: 1,
            title: titles.link,
            content_type: "link",
            duration_minutes: 10,
            required: false,
            external_url: "https://example.org/agent-evaluation-checklist",
            body_html: "",
          },
          {
            module_id: mod.id,
            course_version_id: f.versionId,
            position: 2,
            title: titles.locked,
            content_type: "text",
            duration_minutes: 30,
            required: true,
            external_url: null,
            body_html: "<p>Build the loop step by step.</p>",
          },
        ])
        .select("id, title, lineage_id"),
    );
    const byTitle = new Map(rows.map((r) => [r.title, r]));
    lessons.reading = byTitle.get(titles.reading)!.id;
    lessons.link = byTitle.get(titles.link)!.id;
    lessons.locked = byTitle.get(titles.locked)!.id;
    await ok("publish version", db.rpc("publish_course_version", { p_version: f.versionId }));
    await ok("release offering", db.rpc("publish_offering", { p_offering: f.offeringId }));
    await ok(
      "rule",
      db.from("prerequisite_rules").insert({
        offering_id: f.offeringId,
        target_lesson_lineage: byTitle.get(titles.locked)!.lineage_id,
        kind: "lesson_complete",
        required_lesson_lineage: byTitle.get(titles.reading)!.lineage_id,
      }),
    );
  });

  test.afterAll(async () => {
    await retireFixture(f);
  });

  test("learner and staff pages fit the screen and pass axe @responsive", async ({ browser }) => {
    test.setTimeout(600_000);
    const base = `/courses/${f.offeringId}`;
    const check = async (page: Page, path: string, heading: { level: number; name: string | RegExp }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", heading).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await axe(page);
    };

    const p01 = await newPage(browser, "participant01");
    await check(p01, base, { level: 2, name: "Your progress" });
    await check(p01, `${base}/content`, { level: 2, name: "Course content" });
    await check(p01, `${base}/content/${lessons.reading}`, { level: 2, name: titles.reading });
    await check(p01, `${base}/content/${lessons.link}`, { level: 2, name: titles.link });
    await expect(p01.getByRole("link", { name: /Open external resource/ })).toHaveAttribute("rel", "noopener noreferrer");
    await check(p01, `${base}/content/${lessons.locked}`, { level: 3, name: "This lesson is locked" });
    await check(p01, `${base}/people`, { level: 2, name: "People" });

    const mai = await newPage(browser, STAFF);
    await check(mai, base, { level: 2, name: "Teaching tools" });
    await check(mai, `${base}/content`, { level: 2, name: "Course content" });
    await check(mai, `${base}/content/${lessons.locked}`, { level: 2, name: titles.locked });
    await check(mai, `${base}/content/manage`, { level: 2, name: "Manage content" });
    await check(mai, `${base}/content/manage/versions/${f.versionId}`, { level: 3, name: /Version 1/ });
    await check(mai, `${base}/content/manage/rules`, { level: 3, name: "Conditions by lesson" });
    await check(mai, `${base}/people`, { level: 3, name: "Learner progress" });
    await check(mai, `${base}/people/${f.users.participant01}`, { level: 2, name: `Progress: ${f.names.participant01}` });

    // A draft copy of version 1: the editors and the draft preview.
    await mai.goto(`${base}/content/manage`);
    await mai.getByRole("button", { name: "Create draft" }).click();
    await expect(mai).toHaveURL(/\/content\/manage\/versions\/[0-9a-f-]{36}$/);
    await expect(mai.getByRole("heading", { level: 3, name: /Version 2/ })).toBeVisible();
    await expectNoHorizontalOverflow(mai);
    await axe(mai);
    await mai.getByRole("link", { name: `Edit ${titles.reading}` }).click();
    await expect(mai.getByRole("heading", { level: 3, name: `Edit lesson: ${titles.reading}` })).toBeVisible();
    await expectNoHorizontalOverflow(mai);
    await axe(mai);
    await mai.getByRole("link", { name: `Preview ${titles.reading}` }).click();
    await expect(mai.getByRole("note").filter({ hasText: "Draft preview: read-only, no progress is recorded." })).toBeVisible();
    await expectNoHorizontalOverflow(mai);
    await axe(mai);
  });
});
