import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { expectNoAxeViolations, expectNoHorizontalOverflow, sampleEmail, signIn, uniqueSuffix } from "./helpers";

// Communications journeys: course and cohort messages, announcements (including a
// scheduled one), discussions and cohort/community pages. Every run creates its own
// uniquely named records and only changes learner state of participant07/participant08.

// Pages render on the shared dev server, which can be slow while other areas compile.
const expect = baseExpect.configure({ timeout: 20_000 });
/** Waits for the outcome of a server action (it re-renders the page it was sent from). */
const ACTION_TIMEOUT = 45_000;

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** A separate signed-in session per person, at the viewport of the project being run. */
async function newPage(browser: Browser, who: string): Promise<Page> {
  const { viewport, hasTouch } = test.info().project.use;
  const context = await browser.newContext({ viewport, hasTouch });
  const page = await context.newPage();
  // The shared dev server can take longer than one sign-in attempt while other areas compile.
  for (let attempt = 1; ; attempt++) {
    try {
      await signIn(page, who);
      return page;
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
}

/** Signed-in Supabase client for a sample account, to prove the database itself refuses. */
async function supabaseAs(who: string) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: sampleEmail(who), password: process.env.SEED_PASSWORD ?? "" });
  if (error) throw error;
  return supabase;
}

/** Nothing this spec does may send email: no message in Mailpit mentions the run's suffix. */
async function expectNoEmailMentioning(page: Page, token: string) {
  const res = await page.request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(token)}`);
  expect(res.ok(), "Mailpit search").toBe(true);
  const body = (await res.json()) as { messages_count?: number; messages?: unknown[] };
  expect(body.messages?.length ?? 0, `emails mentioning ${token}`).toBe(0);
}

async function offeringIdFor(page: Page, code: string): Promise<string> {
  await page.goto("/messages");
  const href = await page.getByRole("listitem").filter({ hasText: `ID: ${code}` }).getByRole("link", { name: /New Message/ }).getAttribute("href");
  const id = new URL(href ?? "", "http://x").searchParams.get("offering");
  expect(id).toMatch(UUID);
  return id as string;
}

/** A cohort's id, from the signed-in person's own cohort list. */
async function cohortIdFor(page: Page, code: string): Promise<string> {
  await page.goto("/cohorts");
  const href = await page.getByRole("listitem").filter({ hasText: `ID: ${code}` }).getByRole("link").first().getAttribute("href");
  const id = (href ?? "").split("/").pop() ?? "";
  expect(id).toMatch(UUID);
  return id;
}

/** A community's id, from the community directory on /cohorts. */
async function communityIdFor(page: Page, name: string): Promise<string> {
  await page.goto("/cohorts#communities");
  const href = await page.getByRole("link", { name, exact: true }).getAttribute("href");
  const id = (href ?? "").split("/").pop() ?? "";
  expect(id).toMatch(UUID);
  return id;
}

test.describe("messages", () => {
  test("a learner messages an instructor in a course, the instructor reads and replies, outsiders see nothing @responsive", async ({ browser }) => {
    test.setTimeout(180_000);
    const suffix = uniqueSuffix();
    const subject = `Question about week 2 ${suffix}`;
    const body = `Hello Mai, could you look at my notes? ${suffix}`;
    const reply = `Thanks Jonas, I left comments. ${suffix}`;

    // participant07 composes in AAF-F26 from the course row (reference layout R3).
    const p07 = await newPage(browser, "participant07");
    const aaf = await offeringIdFor(p07, "AAF-F26");
    await expectNoHorizontalOverflow(p07);
    await expectNoAxeViolations(p07);
    await p07.getByRole("listitem").filter({ hasText: "ID: AAF-F26" }).getByRole("link", { name: /New Message/ }).click();
    await expect(p07).toHaveURL(new RegExp(`/messages/new\\?offering=${aaf}`));
    await expect(p07.getByRole("heading", { level: 1, name: "New message" })).toBeVisible();

    const search = p07.getByLabel("Search people in AAF-F26");
    // People outside the course (participant09 studies in other offerings) are not offered.
    await search.fill("Đặng Quốc Huy");
    await expect(p07.getByText(/No one in AAF-F26 matches/)).toBeVisible();
    await search.fill("tran");
    await p07.getByRole("checkbox", { name: /Mai Trần/ }).check();
    await expect(p07.getByText("1 selected")).toBeVisible();
    await search.fill("");
    await p07.getByLabel("Subject").fill(subject);
    await p07.getByRole("textbox", { name: /^Message/ }).fill(body);
    await p07.getByLabel("Attachments (optional)").setInputFiles({
      name: `notes-${suffix}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(`Private notes for Mai ${suffix}\n`),
    });
    await expect(p07.getByRole("button", { name: `Remove notes-${suffix}.txt` })).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expectNoAxeViolations(p07);
    await p07.getByRole("button", { name: "Send", exact: true }).click();

    // Success opens the stored conversation.
    await expect(p07).toHaveURL(new RegExp(`/messages/${UUID.source}`), { timeout: ACTION_TIMEOUT });
    await expect(p07.getByText("Message sent.")).toBeVisible();
    const threadId = new URL(p07.url()).pathname.split("/").pop() as string;
    await expect(p07.getByRole("heading", { level: 1 })).toHaveText(subject);
    await expect(p07.getByText(body)).toBeVisible();
    const attachment = p07.getByRole("link", { name: new RegExp(`notes-${suffix}\\.txt`) });
    await expect(attachment).toBeVisible();
    const assetId = ((await attachment.getAttribute("href")) ?? "").match(UUID)?.[0] ?? "";
    expect(assetId).toMatch(UUID);
    await p07.reload();
    await expect(p07.getByText(body)).toBeVisible();
    await expectNoHorizontalOverflow(p07);
    await expectNoAxeViolations(p07);

    // The instructor sees it as unread, opens it (now read) and replies.
    const mai = await newPage(browser, "mai.tran");
    await mai.goto(`/messages?offering=${aaf}`);
    const row = mai.getByRole("listitem").filter({ hasText: subject });
    await expect(row.getByText("1 unread")).toBeVisible();
    await row.getByRole("link", { name: subject }).click();
    await expect(mai.getByRole("heading", { level: 1 })).toHaveText(subject);
    await expect(mai.getByText(body)).toBeVisible();
    await mai.goto(`/messages?offering=${aaf}`);
    await expect(mai.getByRole("listitem").filter({ hasText: subject })).toBeVisible();
    await expect(mai.getByRole("listitem").filter({ hasText: subject }).getByText("1 unread")).toHaveCount(0);
    const maiAsset = await mai.request.get(`/api/assets/${assetId}`, { maxRedirects: 0 });
    expect(maiAsset.status()).toBe(302);

    await mai.goto(`/messages/${threadId}`);
    await mai.getByLabel("Your reply").fill(reply);
    await mai.getByRole("button", { name: "Send reply" }).click();
    await expect(mai.getByText("Reply sent.")).toBeVisible();
    await expect(mai.getByText(reply)).toBeVisible();

    // participant07 still has the conversation open: the reply arrives by polling.
    await expect(p07.getByText(reply)).toBeVisible({ timeout: 45_000 });

    // A reply whose answer is lost on the way back: the text stays, and Try again stores it once.
    const followUp = `One more question about the notes. ${suffix}`;
    let dropped = false;
    await p07.route(
      (url) => url.pathname === `/messages/${threadId}`,
      async (route) => {
        if (route.request().method() === "POST" && !dropped) {
          dropped = true;
          await route.fetch(); // the server stores the reply…
          await route.abort("connectionreset"); // …but its answer never arrives
          return;
        }
        await route.continue();
      },
    );
    await p07.getByLabel("Your reply").fill(followUp);
    await p07.getByRole("button", { name: "Send reply" }).click();
    await expect(p07.getByText(/We could not confirm that your message was sent/)).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(p07.getByLabel("Your reply")).toHaveValue(followUp);
    await p07.unrouteAll();
    await p07.getByRole("button", { name: "Try again" }).click();
    await expect(p07.getByText("Reply sent.")).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(p07.getByText(followUp)).toHaveCount(1);
    const db7 = await supabaseAs("participant07");
    expect((await db7.from("messages").select("id").eq("thread_id", threadId).eq("body", followUp)).data ?? []).toHaveLength(1);

    // participant08 is in the same course but not in the conversation.
    const p08 = await newPage(browser, "participant08");
    await p08.goto(`/messages/${threadId}`);
    await expect(p08.getByRole("heading", { level: 1, name: "Page not available" })).toBeVisible();
    await expect(p08.getByText(subject)).toHaveCount(0);
    await expect(p08.getByText(body)).toHaveCount(0);
    expect((await p08.request.get(`/api/messages/poll?thread=${threadId}`)).status()).toBe(404);
    expect((await p08.request.get(`/api/assets/${assetId}`, { maxRedirects: 0 })).status()).toBe(404);
    expect((await p07.request.get(`/api/assets/${assetId}`, { maxRedirects: 0 })).status()).toBe(302);

    // …and cannot address anyone outside the course, in the picker or directly in the database.
    await p08.goto(`/messages/new?offering=${aaf}`);
    await p08.getByLabel("Search people in AAF-F26").fill("Huy");
    await expect(p08.getByText(/No one in AAF-F26 matches/)).toBeVisible();
    const db = await supabaseAs("participant08");
    const { data: p09 } = await db.rpc("comms_recipients", { p_offering: aaf, p_cohort: null });
    expect((p09 as { display_name: string }[]).some((r) => r.display_name === "Đặng Quốc Huy")).toBe(false);
    const direct = await db.rpc("create_thread", {
      p_offering: aaf,
      p_cohort: null,
      p_recipients: ["9fc1460f-bc72-4fa1-adbb-fe9298ab02aa"],
      p_subject: `Should fail ${suffix}`,
      p_body: "x",
      p_assets: [],
      p_confirm_large: false,
      p_client_key: null,
    });
    expect(direct.error?.message).toMatch(/not members of this course or cohort/);
    const peek = await db.from("messages").select("id").eq("thread_id", threadId);
    expect(peek.data ?? []).toHaveLength(0);

    await expectNoEmailMentioning(p07, suffix);
  });

  test("messages to more than ten people need an explicit confirmation", async ({ browser }) => {
    test.setTimeout(120_000);
    const suffix = uniqueSuffix();
    const subject = `Study group invite ${suffix}`;
    const p07 = await newPage(browser, "participant07");
    const gc = await cohortIdFor(p07, "GC-FALL-2026");
    await p07.goto(`/messages/new?cohort=${gc}`);
    await p07.getByRole("button", { name: /^Select all \d+ matching/ }).click();
    const count = Number(/(\d+) selected/.exec((await p07.getByText(/^\d+ selected$/).first().textContent()) ?? "")?.[1]);
    expect(count).toBeGreaterThan(10);
    await p07.getByLabel("Subject").fill(subject);
    await p07.getByRole("textbox", { name: /^Message/ }).fill(`Anyone up for a study group? ${suffix}`);
    await p07.getByRole("button", { name: "Send", exact: true }).click();
    const dialog = p07.getByRole("dialog", { name: `Send to ${count} people?` });
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(p07);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(p07).toHaveURL(/\/messages\/new\?cohort=/);
    await expect(p07.getByLabel("Subject")).toHaveValue(subject);

    // Nothing was stored, and the database itself refuses a large send without the confirmation.
    const db7 = await supabaseAs("participant07");
    expect((await db7.from("threads").select("id").eq("subject", subject)).data ?? []).toHaveLength(0);
    const me = (await db7.auth.getUser()).data.user?.id;
    const people = ((await db7.rpc("comms_recipients", { p_offering: null, p_cohort: gc })).data ?? []) as { user_id: string }[];
    const refused = await db7.rpc("create_thread", {
      p_offering: null,
      p_cohort: gc,
      p_recipients: people.map((r) => r.user_id).filter((id) => id !== me),
      p_subject: subject,
      p_body: "x",
      p_assets: [],
      p_confirm_large: false,
      p_client_key: null,
    });
    expect(refused.error?.code).toBe("P0428");
    expect((await db7.from("threads").select("id").eq("subject", subject)).data ?? []).toHaveLength(0);
    await expectNoEmailMentioning(p07, suffix);
  });

  test("the polling endpoint answers only for the signed-in user", async ({ page }) => {
    const anonymous = await page.request.get("/api/messages/poll");
    expect(anonymous.status()).toBe(401);
    expect(anonymous.headers()["cache-control"]).toContain("no-store");
    await signIn(page, "participant08");
    const res = await page.request.get("/api/messages/poll?scopes=1");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("private");
    const json = (await res.json()) as { unread: number; scopes: { type: string; id: string }[] };
    expect(typeof json.unread).toBe("number");
    expect(json.scopes.length).toBeGreaterThan(0);
    expect((await page.request.get("/api/messages/poll?thread=not-a-uuid")).status()).toBe(400);
    expect((await page.request.get("/api/messages/poll?after=2026-01-01T00:00:00Z")).status()).toBe(400);
  });
});

/** "YYYY-MM-DDTHH:mm" wall time in a zone, for a datetime-local input. */
function wallTime(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

test.describe("announcements", () => {
  test("staff schedule, publish, pin, edit and archive; learners see an announcement only once it is released", async ({ browser }) => {
    test.setTimeout(300_000);
    const suffix = uniqueSuffix();
    const scheduledTitle = `Lab room change ${suffix}`;
    const draftTitle = `Reading list ${suffix}`;

    const mai = await newPage(browser, "mai.tran");
    const aaf = await offeringIdFor(mai, "AAF-F26");
    const list = `/courses/${aaf}/announcements`;

    // 1. Schedule one for the next minutes (the editor works in Mai's own time zone).
    await mai.goto(`${list}/new`);
    await expect(mai.getByRole("heading", { level: 2, name: "New announcement" })).toBeVisible();
    await expectNoAxeViolations(mai);
    await mai.getByLabel("Title").fill(scheduledTitle);
    await mai.getByRole("textbox", { name: /^Announcement/ }).fill(`The lab moves to **room 4**. ${suffix}`);
    await mai.getByLabel("Schedule for a later time").check();
    const zone = /Time zone: ([A-Za-z_]+\/[A-Za-z_]+|UTC)/.exec((await mai.getByText(/Time zone:/).first().textContent()) ?? "")?.[1] ?? "UTC";
    const releaseAt = new Date(Math.ceil((Date.now() + 90_000) / 60_000) * 60_000);
    await mai.getByLabel("Publication time").fill(wallTime(releaseAt, zone));
    await mai.getByRole("button", { name: "Save", exact: true }).click();
    await expect(mai.getByText("Announcement scheduled.")).toBeVisible({ timeout: ACTION_TIMEOUT });
    const scheduledCard = mai.locator("article", { hasText: scheduledTitle });
    await expect(scheduledCard.getByText("Scheduled", { exact: true })).toBeVisible();
    const annId = ((await scheduledCard.getAttribute("id")) ?? "").replace(/^a-/, "");
    expect(annId).toMatch(UUID);
    await expectNoHorizontalOverflow(mai);
    await expectNoAxeViolations(mai);

    // Learners see nothing yet, neither on the page nor through the database.
    const p07 = await newPage(browser, "participant07");
    await p07.goto(list);
    await expect(p07.getByRole("heading", { level: 2, name: "Announcements" })).toBeVisible();
    await expect(p07.getByText(scheduledTitle)).toHaveCount(0);
    const db7 = await supabaseAs("participant07");
    expect((await db7.from("announcements").select("id").eq("id", annId)).data ?? []).toHaveLength(0);
    await p07.goto(`${list}/${annId}/edit`);
    await expect(p07.getByRole("heading", { level: 1, name: "Page not available" })).toBeVisible();

    // 2. Meanwhile: a draft, published now, pinned, then archived.
    await mai.goto(`${list}/new`);
    await mai.getByLabel("Title").fill(draftTitle);
    await mai.getByRole("textbox", { name: /^Announcement/ }).fill(`Optional reading for week 3. ${suffix}`);
    await mai.getByRole("button", { name: "Save", exact: true }).click();
    await expect(mai.getByText("Draft saved.")).toBeVisible({ timeout: ACTION_TIMEOUT });
    const draftCard = mai.locator("article", { hasText: draftTitle });
    await expect(draftCard.getByText("Draft", { exact: true })).toBeVisible();
    await p07.goto(list);
    await expect(p07.getByText(draftTitle)).toHaveCount(0);

    await draftCard.getByRole("button", { name: /^Publish now/ }).click();
    const publishDialog = mai.getByRole("dialog", { name: "Publish this announcement now?" });
    await expect(publishDialog).toBeVisible();
    await publishDialog.getByRole("button", { name: "Publish now" }).click();
    await expect(mai.locator("article", { hasText: draftTitle }).getByText("Published", { exact: true })).toBeVisible({ timeout: ACTION_TIMEOUT });
    await mai.locator("article", { hasText: draftTitle }).getByRole("button", { name: /^Pin\b/ }).click();
    await expect(mai.locator("article", { hasText: draftTitle }).getByText("Pinned", { exact: true })).toBeVisible({ timeout: ACTION_TIMEOUT });

    await p07.goto(list);
    const learnerCard = p07.locator("article", { hasText: draftTitle });
    await expect(learnerCard).toBeVisible();
    await expect(learnerCard.getByText("Pinned", { exact: true })).toBeVisible();
    await expect(learnerCard.getByRole("button")).toHaveCount(0);
    await expectNoAxeViolations(p07);

    await mai.locator("article", { hasText: draftTitle }).getByRole("button", { name: /^Archive/ }).click();
    const archiveDialog = mai.getByRole("dialog", { name: "Archive this announcement?" });
    await archiveDialog.getByRole("button", { name: "Archive" }).click();
    await expect(mai.locator("details").filter({ hasText: /Archived \(\d+\)/ })).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(mai.locator("article", { hasText: draftTitle }).getByText("Archived", { exact: true })).toBeAttached();
    await p07.goto(list);
    await expect(p07.getByText(draftTitle)).toHaveCount(0);

    // 3. Once the scheduled time has passed (server time), learners see it at its anchor.
    await expect(async () => {
      await p07.goto(list);
      await expect(p07.locator(`#a-${annId}`)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 200_000, intervals: [5_000, 10_000] });
    await p07.goto(`${list}#a-${annId}`);
    await expect(p07.locator(`#a-${annId}`).getByRole("heading", { name: scheduledTitle })).toBeVisible();
    await expect(p07.locator(`#a-${annId}`).locator("strong", { hasText: "room 4" })).toBeVisible();

    // 4. Editing a released announcement keeps the replaced version in its history.
    await mai.goto(`${list}/${annId}/edit`);
    await expect(mai.getByText("This announcement is published.")).toBeVisible();
    await mai.getByLabel("Title").fill(`${scheduledTitle} (updated)`);
    await mai.getByRole("button", { name: "Save changes" }).click();
    await expect(mai.getByText("Changes saved.")).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(mai.locator(`#a-${annId}`).getByText("Edited · 1 earlier version")).toBeVisible();
    await mai.goto(`${list}/${annId}/edit#history`);
    const history = mai.locator("#history");
    await history.getByText(/Version replaced/).click();
    await expect(history.getByText(scheduledTitle, { exact: true })).toBeVisible();
    await p07.goto(list);
    await expect(p07.getByRole("heading", { name: `${scheduledTitle} (updated)` })).toBeVisible();
    expect((await db7.from("announcement_revisions").select("id").eq("announcement_id", annId)).data ?? []).toHaveLength(0);

    // Clean up: archive the scheduled one too.
    await mai.goto(list);
    await mai.locator(`#a-${annId}`).getByRole("button", { name: /^Archive/ }).click();
    await mai.getByRole("dialog", { name: "Archive this announcement?" }).getByRole("button", { name: "Archive" }).click();
    await expect(mai.locator("details").filter({ hasText: /Archived \(\d+\)/ })).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expectNoEmailMentioning(mai, suffix);
  });
});

test.describe("cohort announcements", () => {
  test("a cohort administrator publishes to the cohort; participants read it at its anchor but cannot manage it", async ({ browser }) => {
    test.setTimeout(180_000);
    const suffix = uniqueSuffix();
    const title = `Cohort social hour ${suffix}`;

    const admin = await newPage(browser, "admin");
    const gc = await cohortIdFor(admin, "GC-FALL-2026");
    await admin.goto(`/cohorts/${gc}/announcements/new`);
    await expect(admin.getByRole("heading", { level: 2, name: "New announcement" })).toBeVisible();
    await admin.getByLabel("Title").fill(title);
    await admin.getByRole("textbox", { name: /^Announcement/ }).fill(`Join us on *Friday* after the session. ${suffix}`);
    await admin.getByLabel("Publish now").check();
    await admin.getByRole("button", { name: "Save", exact: true }).click();
    await expect(admin.getByText("Announcement published.")).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(admin).toHaveURL(new RegExp(`/cohorts/${gc}`));
    const card = admin.locator("article", { hasText: title });
    await expect(card.getByText("Published", { exact: true })).toBeVisible();
    const annId = ((await card.getAttribute("id")) ?? "").replace(/^a-/, "");
    expect(annId).toMatch(UUID);

    const p08 = await newPage(browser, "participant08");
    await p08.goto(`/cohorts/${gc}#a-${annId}`);
    const seen = p08.locator(`#a-${annId}`);
    await expect(seen.getByRole("heading", { name: title })).toBeVisible();
    await expect(seen.locator("em", { hasText: "Friday" })).toBeVisible();
    await expect(seen.getByRole("button")).toHaveCount(0);
    await expect(p08.getByRole("link", { name: "New announcement" })).toHaveCount(0);
    await p08.goto(`/cohorts/${gc}/announcements/new`);
    await expect(p08.getByRole("heading", { level: 1, name: "Page not available" })).toBeVisible();
    await p08.goto(`/cohorts/${gc}/announcements/${annId}/edit`);
    await expect(p08.getByRole("heading", { level: 1, name: "Page not available" })).toBeVisible();

    // Archived: gone for participants.
    await admin.locator(`#a-${annId}`).getByRole("button", { name: /^Archive/ }).click();
    await admin.getByRole("dialog", { name: "Archive this announcement?" }).getByRole("button", { name: "Archive" }).click();
    await expect(admin.locator(`#a-${annId}`).getByText("Archived", { exact: true })).toBeAttached({ timeout: ACTION_TIMEOUT });
    await p08.goto(`/cohorts/${gc}`);
    await expect(p08.getByRole("heading", { name: "Cohort announcements" })).toBeVisible();
    await expect(p08.getByText(title)).toHaveCount(0);
    await expectNoEmailMentioning(admin, suffix);
  });
});

test.describe("discussions", () => {
  test("course discussion: inert markup, replies, edit history, hiding with a reason, pin and lock @responsive", async ({ browser }) => {
    test.setTimeout(240_000);
    const suffix = uniqueSuffix();
    const topicTitle = `Lab check-in ${suffix}`;
    const reason = `Off-topic for this check-in ${suffix}`;

    // Instructor opens a topic in AAF-F26.
    const mai = await newPage(browser, "mai.tran");
    const aaf = await offeringIdFor(mai, "AAF-F26");
    await mai.goto(`/courses/${aaf}/discussions/new`);
    await mai.getByLabel("Topic title").fill(topicTitle);
    await mai.getByLabel("Opening post (optional)").fill(`Share one thing you tried this week. ${suffix}`);
    await mai.getByRole("button", { name: "Create topic" }).click();
    await expect(mai).toHaveURL(new RegExp(`/courses/${aaf}/discussions/${UUID.source}$`), { timeout: ACTION_TIMEOUT });
    const topicId = new URL(mai.url()).pathname.split("/").pop() as string;
    const topicUrl = `/courses/${aaf}/discussions/${topicId}`;
    await expect(mai.getByRole("heading", { level: 2, name: topicTitle })).toBeVisible();

    // participant07 posts Markdown together with script, event-handler and javascript: payloads.
    const p07 = await newPage(browser, "participant07");
    await p07.goto(`/courses/${aaf}/discussions`);
    await p07.getByRole("link", { name: topicTitle }).click();
    await expect(p07.getByRole("heading", { level: 2, name: topicTitle })).toBeVisible();
    await p07.getByRole("textbox", { name: /^Your post/ }).fill(
      [
        `Trying **bold words** ${suffix}`,
        "",
        `<script>window.__commsXss = "script"</script>`,
        `<img src="x" onerror="window.__commsXss = 'img'">`,
        `<a href="#" onclick="window.__commsXss = 'click'">click me</a>`,
        "",
        `[a link](javascript:window.__commsXss='link')`,
      ].join("\n"),
    );
    await p07.getByRole("button", { name: "Post", exact: true }).click();
    await expect(p07).toHaveURL(new RegExp(`#p-${UUID.source}$`), { timeout: ACTION_TIMEOUT });
    const postId = new URL(p07.url()).hash.replace(/^#p-/, "");
    const post = p07.locator(`#p-${postId}`);
    await expect(post.locator("strong", { hasText: "bold words" })).toBeVisible();
    await expect(post.locator("script, img, [onerror], [onclick], a[href^='javascript']")).toHaveCount(0);
    await expect(post.getByRole("link", { name: "click me" })).not.toHaveAttribute("onclick", /./);
    expect(await p07.evaluate(() => (window as unknown as { __commsXss?: string }).__commsXss)).toBeUndefined();
    const db7 = await supabaseAs("participant07");
    const stored = await db7.from("discussion_posts").select("body_html").eq("id", postId).single();
    expect(stored.data?.body_html).toContain("<strong>bold words</strong>");
    expect(stored.data?.body_html).not.toMatch(/<script|onerror|onclick|javascript:|<img/i);
    await expectNoHorizontalOverflow(p07);
    await expectNoAxeViolations(p07);

    // The author edits; the replaced text stays in the post's history.
    await post.getByText("Edit", { exact: true }).click();
    await post.getByRole("textbox", { name: /^Edit your post/ }).fill(`Updated: I tried it again. ${suffix}`);
    await post.getByRole("button", { name: "Save changes" }).click();
    await expect(post.getByRole("paragraph").filter({ hasText: `Updated: I tried it again. ${suffix}` })).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(post.getByRole("textbox", { name: /^Edit your post/ })).toHaveCount(0);
    await expect(post.getByText(/Edited /)).toBeVisible();
    await post.getByText("Edit history (1)").click();
    await expect(post.locator("details", { hasText: "Edit history (1)" }).locator("strong", { hasText: "bold words" })).toBeVisible();

    // participant08 replies; other learners never see someone else's edit history.
    const p08 = await newPage(browser, "participant08");
    await p08.goto(topicUrl);
    const seenBy08 = p08.locator(`#p-${postId}`);
    await expect(seenBy08.getByRole("paragraph").filter({ hasText: `Updated: I tried it again. ${suffix}` })).toBeVisible();
    await expect(seenBy08.getByText(/Edit history/)).toHaveCount(0);
    await expect(seenBy08.getByText("Edit", { exact: true })).toHaveCount(0);
    await seenBy08.getByText("Reply", { exact: true }).click();
    await p08.getByRole("textbox", { name: /^Your reply to Jonas Weber/ }).fill(`Nice, I will try that too. ${suffix}`);
    await p08.getByRole("button", { name: "Post reply" }).click();
    await expect(p08).toHaveURL(new RegExp(`#p-${UUID.source}$`), { timeout: ACTION_TIMEOUT });
    const replyId = new URL(p08.url()).hash.replace(/^#p-/, "");
    expect(replyId).not.toBe(postId);
    await expect(p08.locator(`#p-${replyId}`).getByText("In reply to Jonas Weber")).toBeVisible();
    const db8 = await supabaseAs("participant08");
    expect((await db8.from("discussion_post_revisions").select("id").eq("post_id", postId)).data ?? []).toHaveLength(0);

    // The instructor hides the reply with a reason, then pins and locks the topic.
    await mai.goto(topicUrl);
    await expectNoAxeViolations(mai);
    await mai.locator(`#p-${replyId}`).getByRole("button", { name: /^Hide post by Aiko Tanaka/ }).click();
    const hideDialog = mai.getByRole("dialog", { name: "Hide this post?" });
    await hideDialog.getByLabel(/^Reason/).fill(reason);
    await hideDialog.getByRole("button", { name: "Hide post" }).click();
    await expect(mai.locator(`#p-${replyId}`).getByText("This post was removed by a moderator.")).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(mai.locator(`#p-${replyId}`).getByText(`Reason: ${reason}`)).toBeVisible();
    await mai.getByRole("button", { name: "Pin topic" }).click();
    await expect(mai.getByRole("button", { name: "Unpin topic" })).toBeVisible({ timeout: ACTION_TIMEOUT });
    await mai.getByRole("button", { name: "Lock topic" }).click();
    await expect(mai.getByRole("button", { name: "Unlock topic" })).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expectNoHorizontalOverflow(mai);

    // The reply's author sees the reason; other learners see only the notice.
    await p08.goto(topicUrl);
    await expect(p08.locator(`#p-${replyId}`).getByText("This post was removed by a moderator.")).toBeVisible();
    await expect(p08.locator(`#p-${replyId}`).getByText(`Reason: ${reason}`)).toBeVisible();
    await p07.goto(topicUrl);
    const hiddenFor07 = p07.locator(`#p-${replyId}`);
    await expect(hiddenFor07.getByText("This post was removed by a moderator.")).toBeVisible();
    await expect(hiddenFor07.getByText(/Reason:/)).toHaveCount(0);
    await expect(p07.getByText(`Nice, I will try that too. ${suffix}`)).toHaveCount(0);
    expect((await db7.from("discussion_posts").select("hidden_reason").eq("id", replyId)).error).not.toBeNull();
    expect((await db7.from("discussion_posts").select("body_html").eq("id", replyId).single()).data?.body_html).not.toContain("I will try that too");

    // Locked: no new posts, replies or edits, in the page or in the database.
    await expect(p07.getByText("This topic is locked. New posts, replies and edits are closed.")).toBeVisible();
    await expect(p07.getByRole("heading", { name: "Add a post" })).toHaveCount(0);
    await expect(p07.getByText("Reply", { exact: true })).toHaveCount(0);
    await expect(p07.locator(`#p-${postId}`).getByText("Edit", { exact: true })).toHaveCount(0);
    const me7 = (await db7.auth.getUser()).data.user?.id;
    const blocked = await db7.from("discussion_posts").insert({ topic_id: topicId, author_id: me7, body_html: `<p>late ${suffix}</p>` }).select("id");
    expect(blocked.error).not.toBeNull();
    await p07.goto(`/courses/${aaf}/discussions`);
    const listed = p07.getByRole("listitem").filter({ hasText: topicTitle });
    await expect(listed.getByText("Pinned", { exact: true })).toBeVisible();
    await expect(listed.getByText("Locked", { exact: true })).toBeVisible();
    await expect(listed.getByText("2 posts")).toBeVisible();
    await expectNoHorizontalOverflow(p07);

    // A topic exists only in its own course: cohort and community URLs show nothing.
    const gcFall = await cohortIdFor(p07, "GC-FALL-2026");
    const lounge = await communityIdFor(p07, "Global Cohort Community Lounge (sample)");
    for (const url of [`/cohorts/${gcFall}/discussions/${topicId}`, `/cohorts/communities/${lounge}/topics/${topicId}`]) {
      await p07.goto(url);
      await expect(p07.getByRole("heading", { level: 1, name: "Page not available" })).toBeVisible();
      await expect(p07.getByText(topicTitle)).toHaveCount(0);
    }

    // Clean up: unpin (the topic stays locked).
    await mai.getByRole("button", { name: "Unpin topic" }).click();
    await expect(mai.getByRole("button", { name: "Pin topic" })).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expectNoEmailMentioning(mai, suffix);
  });
});

test.describe("cohorts and communities", () => {
  test("a participant sees their cohort and a names-only roster; communities are joined and left apart from enrollment @responsive", async ({ browser }) => {
    test.setTimeout(180_000);
    const suffix = uniqueSuffix();
    const circleName = "Fall 2026 Study Circle (sample)";
    const topicTitle = `Friday study plan ${suffix}`;

    const p08 = await newPage(browser, "participant08");
    const db8 = await supabaseAs("participant08");
    const me = (await db8.auth.getUser()).data.user?.id as string;
    const circle = await communityIdFor(p08, circleName);
    // Start from a known state: participant08 is not in the Study Circle.
    await db8.from("community_members").delete().eq("community_id", circle).eq("user_id", me);

    // Cohort list and detail.
    await p08.goto("/cohorts");
    await expect(p08.getByRole("heading", { level: 1, name: "Cohorts & Communities" })).toBeVisible();
    const cohortRow = p08.getByRole("listitem").filter({ hasText: "ID: GC-FALL-2026" });
    await expect(cohortRow.getByText("Participant", { exact: true })).toBeVisible();
    await expect(p08.getByText("Joining a community never grants access to any course. Course access comes only from your enrollment.")).toBeVisible();
    await expectNoHorizontalOverflow(p08);
    await expectNoAxeViolations(p08);
    await cohortRow.getByRole("link", { name: "Global Cohort — Fall 2026 (sample)" }).click();
    await expect(p08).toHaveURL(new RegExp(`/cohorts/${UUID.source}$`));
    const cohortId = new URL(p08.url()).pathname.split("/").pop() as string;
    await expect(p08.getByRole("heading", { level: 1, name: "Global Cohort — Fall 2026 (sample)" })).toBeVisible();
    await expect(p08.getByRole("link", { name: "Cohort calendar" })).toHaveAttribute("href", `/calendar?cohort=${cohortId}`);
    await expect(p08.getByRole("link", { name: "Cohort tools and resources" })).toHaveAttribute("href", `/tools?cohort=${cohortId}`);
    await expect(p08.getByRole("heading", { name: "Cohort orientation recording available" })).toBeVisible();
    const roster = p08.getByRole("region", { name: "Participants" });
    await expect(roster.getByText("Jonas Weber")).toBeVisible();
    await expect(roster.getByText("Aiko Tanaka")).toBeVisible();
    await expect(p08.getByRole("listitem").filter({ hasText: "ID: AIGE-SUM26" }).getByText("Not enrolled")).toBeVisible();
    await expectNoHorizontalOverflow(p08);
    await expectNoAxeViolations(p08);
    // Names only: no one else's email address is in the HTML or the streamed page data.
    const html = await (await p08.request.get(`/cohorts/${cohortId}`)).text();
    const emails = (html.match(/[a-z0-9._+-]+@sample\.crewscaler\.test/gi) ?? []).map((e) => e.toLowerCase());
    expect(emails.filter((e) => e !== "participant08@sample.crewscaler.test")).toEqual([]);

    // A cohort the participant does not belong to does not exist for them.
    const admin = await supabaseAs("admin");
    const spring = (await admin.from("cohorts").select("id").eq("code", "GC-SPRING-2027").single()).data?.id as string;
    expect(spring).toMatch(UUID);
    await p08.goto(`/cohorts/${spring}`);
    await expect(p08.getByRole("heading", { level: 1, name: "Page not available" })).toBeVisible();
    await expect(p08.getByText("Global Cohort — Spring 2027")).toHaveCount(0);

    // Join the Study Circle from the directory.
    await p08.goto("/cohorts#communities");
    const card = p08.getByRole("listitem").filter({ hasText: circleName });
    await card.getByRole("button", { name: `Join community ${circleName}` }).click();
    await expect(card.getByText("Joined", { exact: true })).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(card.getByRole("button", { name: `Leave community ${circleName}` })).toBeVisible();

    // Members see members and topics, and any member can open a topic (pin/lock are for moderators).
    await card.getByRole("link", { name: circleName }).click();
    await expect(p08.getByRole("heading", { level: 1, name: circleName })).toBeVisible();
    await expect(p08.getByRole("region", { name: /^Members/ }).getByText("Aiko Tanaka")).toBeVisible();
    await p08.getByRole("link", { name: "New topic" }).click();
    await expect(p08.getByRole("heading", { level: 1, name: "New discussion topic" })).toBeVisible();
    await expect(p08.getByLabel("Pin this topic to the top")).toHaveCount(0);
    await p08.getByLabel("Topic title").fill(topicTitle);
    await p08.getByLabel("Opening post (optional)").fill(`Shall we meet on Fridays? ${suffix}`);
    await p08.getByRole("button", { name: "Create topic" }).click();
    await expect(p08).toHaveURL(new RegExp(`/cohorts/communities/${circle}/topics/${UUID.source}$`), { timeout: ACTION_TIMEOUT });
    const topicId = new URL(p08.url()).pathname.split("/").pop() as string;
    await expect(p08.getByRole("heading", { level: 1, name: topicTitle })).toBeVisible();
    await expectNoHorizontalOverflow(p08);
    await expectNoAxeViolations(p08);

    // Leaving hides the community's members and topics again; enrollment is unchanged.
    await p08.goto(`/cohorts/communities/${circle}`);
    await p08.getByRole("button", { name: `Leave community ${circleName}` }).click();
    const leaveDialog = p08.getByRole("dialog", { name: "Leave this community?" });
    await leaveDialog.getByRole("button", { name: "Leave community" }).click();
    await expect(p08.getByRole("button", { name: `Join community ${circleName}` })).toBeVisible({ timeout: ACTION_TIMEOUT });
    await expect(p08.getByText("Members and topics are visible to members only")).toBeVisible();
    await expect(p08.getByText(topicTitle)).toHaveCount(0);
    await p08.goto(`/cohorts/communities/${circle}/topics/${topicId}`);
    await expect(p08.getByRole("heading", { level: 1, name: "Page not available" })).toBeVisible();
    await p08.goto("/cohorts");
    await expect(p08.getByRole("listitem").filter({ hasText: "ID: GC-FALL-2026" }).getByText("Participant", { exact: true })).toBeVisible();

    // Clean up: the topic has no posts, so a moderator can remove it.
    const removed = await admin.from("discussion_topics").delete().eq("id", topicId).select("id");
    expect(removed.error).toBeNull();
    expect(removed.data ?? []).toHaveLength(1);
    await expectNoEmailMentioning(p08, suffix);
  });
});
