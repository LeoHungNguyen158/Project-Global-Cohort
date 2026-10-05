/**
 * Developer smoke check: signs in as a seeded synthetic user through the real login
 * form, visits pages, and reports HTTP status, heading, console errors and failed
 * requests. Screenshots go to .scratch/shots/ (gitignored).
 *
 *   npx tsx scripts/dev/check-pages.ts --as mai.tran /courses /activity
 *   npx tsx scripts/dev/check-pages.ts --as participant01 --width 390 /courses
 *   npx tsx scripts/dev/check-pages.ts --anon /login /catalog
 *
 * Base URL: BASE_URL env (default http://localhost:3000). Password: SEED_PASSWORD.
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

try {
  process.loadEnvFile(".env.local");
} catch {
  // env provided by the shell
}

const args = process.argv.slice(2);
let who: string | null = null;
let width = 1440;
const paths: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--as") who = args[++i];
  else if (args[i] === "--anon") who = null;
  else if (args[i] === "--width") width = Number(args[++i]);
  else paths.push(args[i]);
}
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const DOMAIN = "sample.crewscaler.test";

async function login(page: Page, user: string) {
  const email = user.includes("@") ? user : `${user}@${DOMAIN}`;
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(process.env.SEED_PASSWORD ?? "");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }), page.getByRole("button", { name: "Sign in" }).click()]);
}

async function main() {
  mkdirSync(".scratch/shots", { recursive: true });
  // In containers with a preinstalled browser, point at it; CI installs its own.
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const failed: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500) failed.push(`${r.status()} ${r.url()}`);
  });
  if (who) await login(page, who);
  for (const p of paths) {
    consoleErrors.length = 0;
    failed.length = 0;
    const res = await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    const h1 = await page.locator("h1").first().textContent({ timeout: 2000 }).catch(() => null);
    const shot = `.scratch/shots/${(who ?? "anon").replace(/[^a-z0-9]+/gi, "_")}${p.replace(/[^a-z0-9]+/gi, "_")}_${width}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    console.log(`${res?.status()} ${p} -> ${new URL(page.url()).pathname} | h1: ${h1?.trim() ?? "(none)"} | ${shot}${overflow ? " | HORIZONTAL OVERFLOW" : ""}`);
    for (const e of consoleErrors) console.log(`   console: ${e.slice(0, 300)}`);
    for (const f of failed) console.log(`   failed: ${f}`);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
