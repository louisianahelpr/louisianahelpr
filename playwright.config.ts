import { defineConfig, devices } from "@playwright/test";

// Minimal Playwright config for the e2e/ smoke suite. Replaces the
// broken `createLovableConfig` import (lovable-agent-playwright-config
// was never actually installed in package.json).
//
// Two project entries:
//   - chromium     — runs against a deployed env (PLAYWRIGHT_BASE_URL),
//                    same as before. Used by the mobile-viewports +
//                    smoke / post-and-apply specs that exercise the
//                    real bundle on a real URL.
//   - happy-path   — runs against the local Vite preview (npm run
//                    preview, http://localhost:4173), Supabase calls
//                    fully mocked via route(). The webServer block
//                    auto-starts `npm run build && npx vite preview`
//                    so the suite stands alone in CI.
//
// Set PLAYWRIGHT_BASE_URL to override the chromium project's base URL.
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
      // The default deployed-env suite — excludes happy-path/* which
      // requires the local preview server to be running.
      testIgnore: /happy-path\//,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "happy-path",
      // Local-preview smoke tests with mocked Supabase. Mobile viewport
      // (375x812 ≈ iPhone X/12/13/14), matching the existing Mobile
      // viewport spot-check config. We deliberately use Chromium, not
      // WebKit — CI only installs the Chromium browser and the React
      // bundle behaves identically across engines on a desktop emulator.
      testDir: "./e2e/happy-path",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        isMobile: false, // Chromium can't combine isMobile=true with non-webkit
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        // Override the deployed baseURL with the local Vite preview.
        baseURL: process.env.HAPPY_PATH_BASE_URL || "http://localhost:4173",
      },
    },
  ],
  // Auto-start `vite preview` for the happy-path project. Gated behind
  // PLAYWRIGHT_WEB_SERVER=1 because Playwright's webServer block runs
  // for EVERY project — leaving it unconditional would block the
  // chromium / mobile-viewports suites (which point at a deployed URL
  // and don't need a local preview).
  //
  // The CI workflow at .github/workflows/e2e-happy-path.yml sets the
  // env var; locally, run `PLAYWRIGHT_WEB_SERVER=1 npm run test:e2e:happy`
  // (or use the test:e2e:happy npm script which sets it for you).
  webServer: process.env.PLAYWRIGHT_WEB_SERVER
    ? {
        command: "npm run build && npx vite preview --port 4173 --strictPort",
        url: "http://localhost:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
      }
    : undefined,
});
