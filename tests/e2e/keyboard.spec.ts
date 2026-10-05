import { expect, test, type Page } from "@playwright/test";
import { sampleEmail } from "./helpers";

// Keyboard-only use of the shell: sign in, the phone navigation drawer, a disclosure, and a
// visible focus indicator. No mouse clicks in this file.

async function focusOutline(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "none";
    const s = getComputedStyle(el);
    return `${s.outlineStyle} ${s.outlineWidth}`;
  });
}

test.describe("keyboard only", () => {
  test("sign in, open and close the menu, expand More info, with a visible focus ring @responsive", async ({ page }) => {
    const password = process.env.SEED_PASSWORD;
    if (!password) throw new Error("SEED_PASSWORD is not set.");

    await page.goto("/login");
    await page.getByLabel("Email address").focus();
    await page.keyboard.type(sampleEmail("participant01"));
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password")).toBeFocused();
    expect(await focusOutline(page)).toMatch(/^solid [1-9]/);
    await page.keyboard.type(password);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/activity/, { timeout: 30_000 });

    await page.goto("/courses");
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 1024) {
      // Phone and tablet: the menu button opens a drawer, focus moves into it, Escape closes
      // it and returns focus to the button.
      const menu = page.getByRole("button", { name: "Open navigation" });
      await menu.focus();
      await page.keyboard.press("Enter");
      const drawer = page.getByRole("dialog", { name: "Primary" });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("button", { name: "Close navigation" })).toBeFocused();
      // Tab and Shift+Tab stay inside the drawer however far they go.
      const stops = await drawer.locator("a[href], button").count();
      for (let i = 0; i <= stops; i++) {
        await page.keyboard.press("Tab");
        await expect(drawer.locator(":focus")).toHaveCount(1);
      }
      for (let i = 0; i <= stops; i++) {
        await page.keyboard.press("Shift+Tab");
        await expect(drawer.locator(":focus")).toHaveCount(1);
      }
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(menu).toBeFocused();
    } else {
      // Desktop: the navigation is reachable by Tab.
      const courses = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Courses" });
      await courses.focus();
      expect(await focusOutline(page)).toMatch(/^solid [1-9]/);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/courses/);
    }

    // A More info disclosure opens with the keyboard.
    const more = page.getByText("More info", { exact: true }).first();
    await more.focus();
    expect(await focusOutline(page)).toMatch(/^solid [1-9]/);
    await page.keyboard.press("Enter");
    await expect(page.locator("details[open]").first()).toBeVisible();
  });
});
