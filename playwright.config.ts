import { defineConfig, devices } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Minimal Playwright config for the e2e/ smoke suite.
//
// Two project entries:
//   - chromium     — runs against a deployed env (PLAYWRIGHT_BASE_URL),
//                    same as before. Used by the mobile-viewports +
//                    smoke / post-and-apply specs that exercise the
//                    real bundle on a real URL.
//   - happy-path   — runs against the local Vite preview (npm run
//                    preview, http://127.0.0.1:4173), Supabase calls
//                    fully mocked via route(). The webServer block
//                    auto-starts `npm run build && npx vite preview`
//                    so the suite stands alone in CI.
//
// Set PLAYWRIGHT_BASE_URL to override the chromium project's base URL.

// In cloud/pre-built environments PLAYWRIGHT_BROWSERS_PATH may contain a
// headless shell at a different revision than the installed @playwright/test
// package expects, and browser downloads are often network-restricted.
// This function finds the best available headless shell so tests can run
// without downloading browsers. Returns undefined when not needed (i.e. when
// the expected browser is already present at the default path).
function findAvailableHeadlessShell(): string | undefined {
  // Explicit override always wins.
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const browsersDir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersDir || !existsSync(browsersDir)) return undefined;
  try {
    for (const entry of readdirSync(browsersDir)) {
      if (!entry.startsWith("chromium_headless_shell-")) continue;
      const revDir = join(browsersDir, entry);
      try {
        for (const subdir of readdirSync(revDir)) {
          // Both "chrome-headless-shell" (newer) and "headless_shell"
          // (older pre-built naming) are tried.
          for (const bin of ["chrome-headless-shell", "headless_shell"]) {
            const candidate = join(revDir, subdir, bin);
            if (existsSync(candidate)) return candidate;
          }
        }
      } catch { /* skip unreadable sub-dirs */ }
    }
  } catch { /* browsers dir unreadable */ }
  return undefined;
}

const headlessShell = findAvailableHeadlessShell();

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
    // Allow CI environments that pre-install a specific Chromium build to
    // point Playwright at it directly, bypassing the headless-shell lookup
    // (which requires an exact revision match that may not be available when
    // browser downloads are network-restricted). headlessShell is resolved
    // at config-load time by findAvailableHeadlessShell() above.
    // executablePath must live inside launchOptions — setting it directly on
    // the use block is silently ignored by @playwright/test.
    ...(headlessShell ? { launchOptions: { executablePath: headlessShell } } : {}),
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
        baseURL: process.env.HAPPY_PATH_BASE_URL || "http://127.0.0.1:4173",
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
        command: "npm run build && npx vite preview --port 4173 --strictPort --host 127.0.0.1",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
        // The happy-path suite mocks all Supabase HTTP calls, so the
        // actual key is never used in requests. A value must still be
        // provided so the supabase-js client initialises without throwing
        // "supabaseUrl is required" — which prevents the React app from
        // mounting. The publishable (anon) key is already present in
        // vitest.config.ts (a committed file), so embedding it here is safe.
        env: {
          VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co",
          VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP",
        },
      }
    : undefined,
});
