import { defineConfig, devices } from "@playwright/test";

// Minimal Playwright config for the e2e/ smoke suite. Replaces the
// broken `createLovableConfig` import (lovable-agent-playwright-config
// was never actually installed in package.json).
//
// Tests target a deployed environment by default — set PLAYWRIGHT_BASE_URL
// to override (e.g. http://localhost:8080 for a local dev server).
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://www.louisianahelpr.com"),
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
