import { readFileSync } from "node:fs";
import { expect as baseExpect, test, type Browser, type BrowserContext, type Download, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { expectNoAxeViolations, expectNoHorizontalOverflow, sampleEmail, signIn, uniqueSuffix } from "./helpers";

// Grades and calendar journeys. Every run creates its own uniquely named grade items and
// event, changes learner-visible state only for participant05 (participant06 is the
// "must see nothing" control), and cleans up: the grade items end hidden from learners
// and not counted, and the event is deleted.

// Server actions re-render the page on the shared dev server, which can be slow while other
// work runs: every assertion here may wait up to 30 s (passing checks return at once).
const expect = baseExpect.configure({ timeout: 30_000 });

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Browser contexts a test opens are closed after it, so later tests start clean.
const opened: BrowserContext[] = [];
test.afterEach(async () => {
  for (const context of opened.splice(0)) await context.close().catch(() => undefined);
});

async function newPage(browser: Browser, who: string): Promise<Page> {
  const context = await browser.newContext();
  opened.push(context);
  const page = await context.newPage();
  try {
    await signIn(page, who);
  } catch {
    // On a busy shared dev server the first page after signing in can take longer than
    // signIn allows: give the pending sign-in more time, then try once more.
    const done = await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }).then(
      () => true,
      () => false,
    );
    if (!done) await signIn(page, who);
  }
  return page;
}

async function supabaseAs(who: string) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: sampleEmail(who), password: process.env.SEED_PASSWORD ?? "" });
  if (error) throw error;
  return supabase;
}

/**
 * Clicks a dialog's trigger until the dialog is open. A click that lands before React has
 * hydrated the page does nothing, which happens when the shared dev server is busy.
 */
async function openDialog(trigger: Locator, dialog: Locator): Promise<Locator> {
  await expect(async () => {
    if (!(await dialog.isVisible())) await trigger.click({ timeout: 5_000 });
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  return dialog;
}

/** AutoSubmit hides the filter form's Apply button once React has hydrated the page. */
async function hydrated(page: Page) {
  await expect(page.locator("form[role=search] [data-apply]").first()).toHaveClass(/sr-only/, { timeout: 60_000 });
}

/** AAF-F26's id, read from the staff card on /grades. */
async function aafIdAsStaff(page: Page): Promise<string> {
  await page.goto("/grades");
  const href = await page.getByRole("article").filter({ hasText: "AAF-F26" }).getByRole("link", { name: /Open gradebook/ }).getAttribute("href");
  const id = href?.match(UUID)?.[0];
  expect(id).toBeTruthy();
  return id as string;
}

async function downloadText(page: Page, trigger: () => Promise<unknown>): Promise<{ text: string; download: Download }> {
  const [download] = await Promise.all([page.waitForEvent("download"), trigger()]);
  const path = await download.path();
  return { text: readFileSync(path, "utf8"), download };
}

const unfold = (ics: string) => ics.replace(/\r\n /g, "");

test.describe("grades", () => {
  test.describe.configure({ mode: "serial" });

  const suffix = uniqueSuffix();
  const itemTitle = `E2E participation ${suffix}`;
  const formulaTitle = `=1+1 formula check ${suffix}`;
  const feedback = `Thoughtful contributions in week 5 ${suffix}`;
  let aaf = "";
  let itemId = "";

  test("an instructor grades a learner on a new item; learners see nothing before publishing", async ({ browser }) => {
    test.setTimeout(300_000);
    const mai = await newPage(browser, "mai.tran");
    aaf = await aafIdAsStaff(mai);
    // Real counts on the overview card, never a learner percentage for staff.
    await expect(mai.getByRole("article").filter({ hasText: "AAF-F26" }).getByText(/to grade|Nothing is waiting/).first()).toBeVisible();
    await expectNoAxeViolations(mai);

    await mai.goto(`/courses/${aaf}/grades`);
    await expect(mai.getByRole("heading", { level: 2, name: "Gradebook" })).toBeVisible();
    await expect(mai.getByRole("region", { name: /Gradebook table/ })).toBeVisible();

    // A uniquely named participation item, and a hidden one whose title looks like a formula.
    for (const [title, kind, max, learnerFacing] of [
      [itemTitle, "participation", "10", true],
      [formulaTitle, "manual", "5", false],
    ] as const) {
      const dialog = await openDialog(mai.getByRole("button", { name: "Add grade item" }), mai.getByRole("dialog", { name: "Add a grade item" }));
      await dialog.getByLabel("Title").fill(title);
      await dialog.getByLabel("Type").selectOption(kind);
      await dialog.getByLabel("Max points").fill(max);
      if (!learnerFacing) {
        await dialog.getByLabel("Counts toward the running total").uncheck();
        await dialog.getByLabel("Visible to learners").uncheck();
      }
      await dialog.getByRole("button", { name: "Add item" }).click();
      await expect(mai.getByText(`Grade item “${title}” added.`)).toBeVisible();
    }

    // Filter to the new item and one learner; the URL keeps the filter.
    await hydrated(mai);
    await mai.getByLabel("Grade item", { exact: true }).selectOption({ label: itemTitle });
    await expect(mai).toHaveURL(/[?&]item=/);
    itemId = new URL(mai.url()).searchParams.get("item") ?? "";
    expect(itemId).toMatch(UUID);
    await mai.getByLabel("Search learners").fill("Kwame");
    await mai.getByLabel("Search learners").press("Enter");
    await expect(mai).toHaveURL(/q=Kwame/);
    await expect(mai.getByText("Showing 1 of 9 learners")).toBeVisible();

    const gradeDialog = await openDialog(
      mai.getByRole("button", { name: new RegExp(`^Edit grade for Kwame Mensah, ${esc(itemTitle)}\\. Current: Not graded`) }),
      mai.getByRole("dialog", { name: `Grade: ${itemTitle}` }),
    );
    await expect(gradeDialog.getByText("Kwame Mensah · out of 10 points")).toBeVisible();
    // Out-of-range points are refused and the typed feedback is kept.
    await gradeDialog.getByLabel("Points (0 to 10)").fill("12");
    await gradeDialog.getByLabel("Feedback for the learner").fill(feedback);
    await gradeDialog.getByRole("button", { name: "Save grade" }).click();
    await expect(gradeDialog.getByText("Enter points from 0 to 10, with at most two decimals.")).toBeVisible();
    await expect(gradeDialog.getByLabel("Feedback for the learner")).toHaveValue(feedback);
    await gradeDialog.getByLabel("Points (0 to 10)").fill("8.5");
    await expectNoAxeViolations(mai);
    await gradeDialog.getByRole("button", { name: "Save grade" }).click();
    await expect(mai.getByText(`Saved 8.5 / 10 for Kwame Mensah on ${itemTitle}. The learner does not see it until it is published.`)).toBeVisible();
    await expect(mai.getByRole("button", { name: new RegExp(`Edit grade for Kwame Mensah, ${esc(itemTitle)}\\. Current: 8\\.5 / 10, Not published`) })).toBeVisible();

    // participant05 sees the item but no score or feedback yet; the unpublished grade is not in the HTML.
    const p05 = await newPage(browser, "participant05");
    await p05.goto(`/grades/${aaf}`);
    const card = p05.locator(`#item-${itemId}`);
    await expect(card).toContainText("Not yet graded");
    await expect(card).not.toContainText("8.5");
    expect(await p05.content()).not.toContain(feedback);
    await p05.goto("/activity?kind=grade");
    await expect(p05.getByText(`Grade posted: ${itemTitle}`)).toHaveCount(0);

    // The database agrees: the learner cannot read the working grade.
    const db05 = await supabaseAs("participant05");
    const { data: working } = await db05.from("grades").select("id").eq("grade_item_id", itemId);
    expect(working ?? []).toHaveLength(0);
    const { data: released } = await db05.from("released_grades").select("grade_id").eq("grade_item_id", itemId);
    expect(released ?? []).toHaveLength(0);
  });

  test("publishing releases exactly that grade; the learner opens it from Activity; others see nothing", async ({ browser }) => {
    test.setTimeout(300_000);
    const mai = await newPage(browser, "mai.tran");
    await mai.goto(`/courses/${aaf}/grades?item=${itemId}&q=Kwame`);
    const confirm = await openDialog(mai.getByRole("button", { name: "Publish 1 grade" }), mai.getByRole("dialog", { name: "Publish 1 grade?" }));
    await expect(confirm.getByTestId("publish-summary")).toHaveText(`${itemTitle}: 1 learner`);
    await expectNoAxeViolations(mai);
    await confirm.getByRole("button", { name: "Publish grades" }).click();
    await expect(mai.getByText("Published 1 grade. The learner has been notified.")).toBeVisible();
    await expect(mai.getByRole("button", { name: new RegExp(`Edit grade for Kwame Mensah, ${esc(itemTitle)}\\. Current: 8\\.5 / 10, Published`) })).toBeVisible();

    // participant05 opens the grade notification and lands on the exact item.
    const p05 = await newPage(browser, "participant05");
    await p05.goto("/activity?kind=grade");
    const notice = p05.getByRole("listitem").filter({ hasText: `Grade posted: ${itemTitle}` });
    await notice.getByRole("button", { name: /^View my grade/ }).last().click();
    await expect(p05).toHaveURL(new RegExp(`/grades/${aaf}#item-${itemId}$`));
    const card = p05.locator(`#item-${itemId}`);
    await expect(card).toContainText("Released");
    await expect(card).toContainText("8.5 / 10");
    await expect(card).toContainText(feedback);
    await expect(p05.getByTestId("running-total")).toContainText("%");
    await expect(p05.getByRole("heading", { level: 2, name: "Running total" })).toBeVisible();
    await expectNoHorizontalOverflow(p05);
    await expectNoAxeViolations(p05);
    // The overview pill shows a released percentage (never a fabricated 0%).
    await p05.goto("/grades");
    await expect(p05.getByRole("article").filter({ hasText: "AAF-F26" }).getByTestId("grade-pill")).toHaveText(/^\d+\.\d{2}%$/);

    // participant06: same course, none of it.
    const p06 = await newPage(browser, "participant06");
    await p06.goto(`/grades/${aaf}`);
    await expect(p06.locator(`#item-${itemId}`)).toContainText("Not yet graded");
    await expect(p06.locator(`#item-${itemId}`)).not.toContainText("8.5");
    expect(await p06.content()).not.toContain(feedback);
    await p06.goto("/activity?kind=grade");
    await expect(p06.getByText(`Grade posted: ${itemTitle}`)).toHaveCount(0);
    // A learner opening the gradebook URL gets their own grades, not the gradebook.
    await p06.goto(`/courses/${aaf}/grades`);
    await expect(p06.getByRole("heading", { name: "Gradebook" })).toHaveCount(0);
    expect(await p06.content()).not.toContain("Kwame Mensah");
    const csv = await p06.request.get(`/api/grades/${aaf}/export`);
    expect(csv.status()).toBe(404);
  });

  test("a teaching assistant can enter grades but cannot publish (interface and database)", async ({ browser }) => {
    test.setTimeout(200_000);
    const linh = await newPage(browser, "linh.pham");
    await linh.goto(`/courses/${aaf}/grades?item=${itemId}`);
    await expect(linh.getByRole("button", { name: "Publish grades" })).toBeDisabled();
    await expect(linh.getByText("Publishing is unavailable: as a teaching assistant you can enter grades but not publish them. Ask the instructor to publish.")).toBeVisible();
    await expect(linh.getByRole("button", { name: "Add grade item" })).toHaveCount(0);
    await expectNoAxeViolations(linh);

    const db = await supabaseAs("linh.pham");
    const { data: grades } = await db.from("grades").select("id").eq("grade_item_id", itemId);
    expect((grades ?? []).length).toBe(1);
    const { error } = await db.rpc("publish_grades", { p_offering: aaf, p_grade_ids: [(grades ?? [])[0].id] });
    expect(error?.code).toBe("42501");
    const { error: unpublishError } = await db.rpc("unpublish_grade", { p_grade: (grades ?? [])[0].id });
    expect(unpublishError?.code).toBe("42501");
  });

  test("the gradebook CSV export has names and grades only, with formulas neutralized", async ({ browser }) => {
    test.setTimeout(200_000);
    const mai = await newPage(browser, "mai.tran");
    await mai.goto(`/courses/${aaf}/grades`);
    const { text, download } = await downloadText(mai, () => mai.getByRole("link", { name: "Export CSV" }).click());
    expect(download.suggestedFilename()).toMatch(/^AAF-F26-gradebook-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = text.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toContain(`${itemTitle} (points out of 10)`);
    // The formula-looking title is prefixed with ' so spreadsheets treat it as text.
    expect(lines[0]).toContain(`'${formulaTitle} (points out of 5)`);
    expect(text).not.toMatch(/(^|,|\r\n)"?[=+\-@]/);
    expect(text).not.toContain("@sample.crewscaler.test");
    const kwame = lines.find((l) => l.startsWith("Kwame Mensah,"));
    expect(kwame).toContain(`8.5,"Graded, Published"`);
  });

  test("hiding an item takes it out of learners' grades; graded items keep their max points", async ({ browser }) => {
    test.setTimeout(200_000);
    const mai = await newPage(browser, "mai.tran");
    await mai.goto(`/courses/${aaf}/grades`);
    const dialog = await openDialog(mai.getByRole("button", { name: `Edit ${itemTitle}` }), mai.getByRole("dialog", { name: "Edit grade item" }));
    await expect(dialog.getByLabel("Max points")).toHaveAttribute("readonly", "");
    await expect(dialog.getByText("Max points cannot change after grades are entered for this item.")).toBeVisible();
    await dialog.getByLabel("Counts toward the running total").uncheck();
    await dialog.getByLabel("Visible to learners").uncheck();
    await dialog.getByRole("button", { name: "Save item" }).click();
    await expect(mai.getByText("Grade item saved.")).toBeVisible();

    const p05 = await newPage(browser, "participant05");
    await p05.goto(`/grades/${aaf}`);
    await expect(p05.getByTestId("running-total")).toBeVisible();
    await expect(p05.locator(`#item-${itemId}`)).toHaveCount(0);
    await expect(p05.getByRole("main")).not.toContainText(itemTitle);
  });

  test.afterAll(async () => {
    if (!aaf) return;
    // Cleanup, also after a failed step: this run's items end hidden from learners and out
    // of totals, and an item nobody was graded on is deleted.
    const db = await supabaseAs("mai.tran");
    const { data: items } = await db.from("grade_items").select("id").eq("offering_id", aaf).in("title", [itemTitle, formulaTitle]);
    for (const item of items ?? []) {
      const { error } = await db.from("grade_items").delete().eq("id", item.id);
      if (error) await db.from("grade_items").update({ visible_to_learners: false, counts_toward_total: false }).eq("id", item.id);
    }
  });
});

test.describe("calendar", () => {
  test.describe.configure({ mode: "serial" });

  const suffix = uniqueSuffix();
  const title = `E2E office hours ${suffix}`;
  let aaf = "";
  let eventId = "";

  test("staff add a course event; month, week and list show it; the .ics has the right UTC times", async ({ browser }) => {
    test.setTimeout(300_000);
    const mai = await newPage(browser, "mai.tran"); // profile time zone: Asia/Ho_Chi_Minh
    aaf = await aafIdAsStaff(mai);
    await mai.goto(`/courses/${aaf}/calendar?date=2026-11-02`);
    await expect(mai.getByRole("heading", { level: 2, name: "November 2026" })).toBeVisible();
    const dialog = await openDialog(mai.getByRole("button", { name: "Add event" }), mai.getByRole("dialog", { name: "Add an event" }));
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Type").selectOption("office_hours");
    // Entered in New York time on the first Monday after the DST change (EST, UTC-5).
    await dialog.getByLabel("Time zone").selectOption("America/New_York");
    await dialog.getByLabel("Starts").fill("2026-11-02T09:00");
    await dialog.getByLabel("Ends").fill("2026-11-02T10:00");
    await dialog.getByLabel("Meeting link (optional)").fill("javascript:alert(1)");
    await dialog.getByRole("button", { name: "Add event" }).click();
    await expect(dialog.getByText("Meeting links must be complete https:// addresses.")).toBeVisible();
    await dialog.getByLabel("Meeting link (optional)").fill(`https://meet.example.com/e2e-${suffix}`);
    await dialog.getByLabel("Location (optional)").fill("Online");
    await dialog.getByLabel("Description (optional)").fill("Bring questions about agent loops; we will go through examples.");
    await expectNoAxeViolations(mai);
    await dialog.getByRole("button", { name: "Add event" }).click();
    await expect(mai.getByText(`Event “${title}” added.`)).toBeVisible();

    // Month view: on Nov 2 for a viewer in Ho Chi Minh City (9:00 PM GMT+7).
    const details = await openDialog(mai.getByRole("button", { name: new RegExp(esc(title)) }), mai.getByRole("dialog", { name: title }));
    await expect(details).toContainText("Nov 2, 2026, 9:00 PM GMT+7");
    await expect(details).toContainText("Event time zone: Nov 2, 2026, 9:00 AM EST");
    const join = details.getByRole("link", { name: /Join meeting/ });
    await expect(join).toHaveAttribute("href", `https://meet.example.com/e2e-${suffix}`);
    await expect(join).toHaveAttribute("target", "_blank");
    await expect(details).toContainText("Crew Scaler does not host or schedule this meeting.");
    await expectNoAxeViolations(mai);
    const icsHref = await details.getByRole("link", { name: "Download .ics" }).getAttribute("href");
    eventId = icsHref?.match(UUID)?.[0] ?? "";
    expect(eventId).toMatch(UUID);
    const { text, download } = await downloadText(mai, () => details.getByRole("link", { name: "Download .ics" }).click());
    expect(download.suggestedFilename()).toBe(`e2e-office-hours-${suffix}.ics`);
    const ics = unfold(text);
    expect(ics).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n");
    expect(ics).toContain(`UID:event-${eventId}@crew-scaler-lms\r\n`);
    expect(ics).toContain("DTSTART:20261102T140000Z\r\n");
    expect(ics).toContain("DTEND:20261102T150000Z\r\n");
    expect(ics).toContain(`SUMMARY:E2E office hours ${suffix}\r\n`);
    expect(ics).toContain("STATUS:CONFIRMED\r\nSEQUENCE:0\r\n");
    expect(ics).toContain(`Join meeting (external link\\, opens in a new tab): https://meet.example.com/e2e-${suffix}`);
    const res = await mai.request.get(icsHref ?? "");
    expect(res.headers()["content-type"]).toContain("text/calendar");
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(res.headers()["content-disposition"]).toContain("attachment");

    // Week and list views; the state is in the URL.
    await mai.goto(`/courses/${aaf}/calendar?view=week&date=2026-11-02`);
    await expect(mai.getByRole("heading", { level: 2, name: "Week of Nov 2 to Nov 8, 2026" })).toBeVisible();
    await expect(mai.getByRole("link", { name: "Week", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(mai.getByRole("button", { name: new RegExp(esc(title)) })).toBeVisible();
    await expectNoAxeViolations(mai);
    await mai.goto(`/courses/${aaf}/calendar?view=list&date=2026-11-02`);
    await expect(mai.getByRole("heading", { level: 2, name: "November 2026: all items" })).toBeVisible();
    await expect(mai.getByRole("heading", { level: 3, name: /Monday, November 2, 2026/ })).toBeVisible();
    await expect(mai.getByRole("button", { name: new RegExp(esc(title)) })).toBeVisible();
    await expectNoAxeViolations(mai);
  });

  test("a learner sees the event in their own time zone; outsiders cannot download it", async ({ browser }) => {
    test.setTimeout(200_000);
    // participant05's profile zone is America/New_York: same instant, shown as 9:00 AM EST.
    const p05 = await newPage(browser, "participant05");
    await p05.goto("/calendar?view=list&date=2026-11-02");
    const details = await openDialog(p05.getByRole("button", { name: new RegExp(esc(title)) }), p05.getByRole("dialog", { name: title }));
    await expect(details).toContainText("Nov 2, 2026, 9:00 AM EST");
    await expect(details.getByRole("button", { name: "Edit event" })).toHaveCount(0);
    const ics = unfold((await downloadText(p05, () => details.getByRole("link", { name: "Download .ics" }).click())).text);
    expect(ics).toContain("DTSTART:20261102T140000Z\r\n");

    // participant09 is not in AAF-F26: the .ics is a 404, and so is the course calendar.
    const p09 = await newPage(browser, "participant09");
    const res = await p09.request.get(`/api/calendar/event/${eventId}`);
    expect(res.status()).toBe(404);
    expect(await res.text()).not.toContain(title);
    await p09.goto("/calendar?view=list&date=2026-11-02");
    await expect(p09.getByText(title)).toHaveCount(0);
    await p09.goto(`/courses/${aaf}/calendar?date=2026-11-02`);
    await expect(p09.getByText(title)).toHaveCount(0);

    // No session: 401, never a public feed.
    const anon = await browser.newContext();
    const anonRes = await anon.request.get(`/api/calendar/event/${eventId}`);
    expect(anonRes.status()).toBe(401);
    await anon.close();
  });

  test("editing, cancelling and restoring update the event and its .ics; delete removes it", async ({ browser }) => {
    test.setTimeout(300_000);
    const mai = await newPage(browser, "mai.tran");
    const open = async () => {
      await mai.goto(`/courses/${aaf}/calendar?view=list&date=2026-11-02`);
      return openDialog(mai.getByRole("button", { name: new RegExp(esc(title)) }), mai.getByRole("dialog", { name: title }));
    };
    const ics = async () => unfold(await (await mai.request.get(`/api/calendar/event/${eventId}`)).text());

    let details = await open();
    await details.getByRole("button", { name: "Edit event" }).click();
    await details.getByLabel("Location (optional)").fill("Room 2 and online");
    await details.getByRole("button", { name: "Save event" }).click();
    await expect(mai.getByText("Event updated.")).toBeVisible();
    expect(await ics()).toContain("LOCATION:Room 2 and online\r\n");
    expect(await ics()).toContain("SEQUENCE:1\r\n");

    details = await open();
    await details.getByRole("button", { name: "Cancel event" }).click();
    await details.getByLabel("Reason (optional, shown to learners)").fill("Instructor travelling");
    await details.getByRole("button", { name: "Cancel event", exact: true }).click();
    await expect(mai.getByText("Event cancelled. It stays on the calendar marked as cancelled.")).toBeVisible();
    details = await open();
    await expect(details).toContainText("This event was cancelled.");
    await expect(details).toContainText("Reason: Instructor travelling");
    const cancelled = await ics();
    expect(cancelled).toContain("STATUS:CANCELLED\r\nSEQUENCE:2\r\n");

    // The learner sees it marked cancelled.
    const p05 = await newPage(browser, "participant05");
    await p05.goto(`/courses/${aaf}/calendar?view=list&date=2026-11-02`);
    const learnerDetails = await openDialog(p05.getByRole("button", { name: new RegExp(esc(title)) }), p05.getByRole("dialog", { name: title }));
    await expect(learnerDetails).toContainText("This event was cancelled.");
    await expect(learnerDetails).toContainText("Reason: Instructor travelling");
    await expect(learnerDetails.getByRole("button", { name: "Restore event" })).toHaveCount(0);

    await details.getByRole("button", { name: "Restore event" }).click();
    await details.getByRole("button", { name: "Restore event", exact: true }).click();
    await expect(mai.getByText("Event restored.")).toBeVisible();
    expect(await ics()).toContain("STATUS:CONFIRMED\r\nSEQUENCE:3\r\n");

    details = await open();
    await details.getByRole("button", { name: "Delete event" }).click();
    await details.getByRole("button", { name: "Delete permanently" }).click();
    await expect(mai.getByText("Event deleted.")).toBeVisible();
    await expect(mai.getByRole("button", { name: new RegExp(esc(title)) })).toHaveCount(0);
    expect((await mai.request.get(`/api/calendar/event/${eventId}`)).status()).toBe(404);
    eventId = "";
  });

  test.afterAll(async () => {
    // Cleanup if a step failed before the delete step: remove this run's event.
    const db = await supabaseAs("mai.tran");
    await db.from("calendar_events").delete().eq("title", title);
  });
});

test.describe("layout", () => {
  test("grades and calendar pages fit the screen and pass axe @responsive", async ({ browser }) => {
    test.setTimeout(300_000);
    const mai = await newPage(browser, "mai.tran");
    const aaf = await aafIdAsStaff(mai);
    for (const path of ["/grades", `/courses/${aaf}/grades`, "/calendar", `/courses/${aaf}/calendar?view=week`, "/calendar?view=list"]) {
      await mai.goto(path);
      await expect(mai.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(mai);
      await expectNoAxeViolations(mai);
    }
    // The gradebook scrolls inside its own labeled region instead of the page.
    await mai.goto(`/courses/${aaf}/grades`);
    const region = mai.getByRole("region", { name: "Gradebook table. Scroll sideways to see every grade item." });
    await expect(region).toBeVisible();
    const widths = await region.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(widths.scroll).toBeGreaterThan(widths.client);

    const p05 = await newPage(browser, "participant05");
    for (const path of ["/grades", `/grades/${aaf}`, `/courses/${aaf}/grades`, "/calendar", "/calendar?view=week"]) {
      await p05.goto(path);
      await expect(p05.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(p05);
      await expectNoAxeViolations(p05);
    }
  });
});
