import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, expectNoHorizontalOverflow, signIn } from "./helpers";

test.describe("sign-in and navigation shell", () => {
  test("a signed-out deep link goes to sign-in and returns afterwards", async ({ page }) => {
    await page.goto("/courses");
    await expect(page).toHaveURL(/\/login\?next=%2Fcourses/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("wrong password shows a generic error and no session", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email address").fill("participant01@sample.crewscaler.test");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/email or password is incorrect/i)).toBeVisible();
    // A rejected sign-in keeps what was typed.
    await expect(page.getByLabel("Email address")).toHaveValue("participant01@sample.crewscaler.test");
    await page.goto("/activity");
    await expect(page).toHaveURL(/\/login/);
  });

  test("learner lands on Activity and can open Courses @responsive", async ({ page }) => {
    await signIn(page, "participant01");
    await expect(page).toHaveURL(/\/activity/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hello");
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);

    await page.goto("/courses");
    await expect(page.getByRole("heading", { level: 1, name: "Courses" })).toBeVisible();
    await expect(page.getByText("Agentic AI Foundations").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
  });
});
