/**
 * QA screenshots of the running app with the synthetic seed data (never real people).
 *
 *   BASE_URL=http://localhost:3000 SEED_PASSWORD=… npx tsx scripts/qa-screenshots.ts --out docs/qa
 *
 * Signs in as sample accounts and saves PNGs of the main learner, instructor and
 * administrator pages at 1440 px, plus a few at 390 px.
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Variables may come from the environment instead.
}

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SEED_PASSWORD;
const outArg = process.argv.indexOf("--out");
const OUT = outArg > 0 ? process.argv[outArg + 1] : "docs/qa";
if (!PASSWORD) throw new Error("SEED_PASSWORD is not set.");
if (process.env.APP_ENV === "production") {
  throw new Error("Refusing to screenshot production; use local or staging sample data.");
}
mkdirSync(OUT, { recursive: true });

async function session(browser: Browser, local: string, width: number) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 800 ? 844 : 900 }, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(`${local}@sample.crewscaler.test`);
  await page.getByLabel("Password").fill(PASSWORD!);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.getByRole("button", { name: "Sign in" }).click()]);
  return page;
}

async function shot(page: Page, url: string, name: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  console.log(`saved ${name}.png  (${url})`);
}

/** First course workspace link on /courses, for routes that need an offering id. */
async function firstOffering(page: Page) {
  await page.goto("/courses");
  const href = await page.locator('a[href^="/courses/"]').first().getAttribute("href");
  return href?.match(/^\/courses\/[^/?#]+/)?.[0] ?? "/courses";
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  try {
    const anon = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: BASE })).newPage();
    await shot(anon, "/login", "01-login-1440");

    const learner = await session(browser, "participant01", 1440);
    const course = await firstOffering(learner);
    await shot(learner, "/activity", "02-learner-activity-1440");
    await shot(learner, "/courses", "03-learner-courses-1440");
    await shot(learner, course, "04-learner-course-overview-1440");
    await shot(learner, `${course}/content`, "05-learner-course-content-1440");
    await shot(learner, "/grades", "06-learner-grades-1440");
    await shot(learner, "/calendar", "07-learner-calendar-1440");
    await shot(learner, "/messages", "08-learner-messages-1440");
    await shot(learner, "/cohorts", "09-learner-cohorts-1440");

    const phone = await session(browser, "participant01", 390);
    await shot(phone, "/activity", "10-learner-activity-390");
    await shot(phone, "/courses", "11-learner-courses-390");
    await shot(phone, "/grades", "12-learner-grades-390");

    const instructor = await session(browser, "mai.tran", 1440);
    const taught = await firstOffering(instructor);
    await shot(instructor, `${taught}/content/manage`, "13-instructor-manage-content-1440");
    await shot(instructor, `${taught}/grades`, "14-instructor-gradebook-1440");

    const admin = await session(browser, "admin", 1440);
    await shot(admin, "/admin", "15-admin-overview-1440");
    await shot(admin, "/admin/cohorts", "16-admin-cohorts-1440");
    await shot(admin, "/admin/courses", "17-admin-courses-1440");
    await shot(admin, "/admin/invitations", "18-admin-invitations-1440");
    await shot(admin, "/admin/communities", "19-admin-communities-1440");
    await shot(admin, "/admin/audit", "20-admin-audit-1440");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
