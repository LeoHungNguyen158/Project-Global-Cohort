import { defineConfig } from "@playwright/test";

// Local runs read the same env file as the app (SEED_PASSWORD, browser path).
try {
  process.loadEnvFile(".env.local");
} catch {
  // CI and other environments provide variables directly.
}

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Specs share one seeded database, so they run one at a time in a fixed order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Containers with a preinstalled Chromium point at it; CI installs its own browser.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
  },
  projects: [
    { name: "desktop-1440", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    // Responsive checks run only for tests tagged @responsive.
    { name: "tablet-768", grep: /@responsive/, use: { browserName: "chromium", viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "mobile-390", grep: /@responsive/, use: { browserName: "chromium", viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  // Reuses a running server (local dev); otherwise starts the production build (CI).
  webServer: process.env.BASE_URL
    ? undefined
    : { command: "npm run start", url: `${BASE_URL}/api/health`, reuseExistingServer: true, timeout: 120_000 },
});
