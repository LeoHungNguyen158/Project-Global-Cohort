import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Synthetic sample accounts created by `npm run seed` (development/staging only). */
export const SAMPLE_DOMAIN = "sample.crewscaler.test";

export function sampleEmail(localPart: string) {
  return localPart.includes("@") ? localPart : `${localPart}@${SAMPLE_DOMAIN}`;
}

/** Signs in through the real login form as a seeded sample account. */
export async function signIn(page: Page, localPart: string) {
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error("SEED_PASSWORD is not set; e2e tests sign in as seeded sample accounts.");
  await page.goto("/login");
  await page.getByLabel("Email address").fill(sampleEmail(localPart));
  await page.getByLabel("Password").fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}

/** Unique, readable suffix so repeated runs create distinct records. */
export function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Runs axe against WCAG 2.x A/AA rules and fails on any violation. */
export async function expectNoAxeViolations(page: Page, opts: { exclude?: string[] } = {}) {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  for (const selector of opts.exclude ?? []) builder = builder.exclude(selector);
  const results = await builder.analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help}`);
  expect(summary, "axe violations").toEqual([]);
}

/** The page itself must not scroll sideways; wide tables scroll inside their own region. */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal page overflow in px").toBeLessThanOrEqual(1);
}
