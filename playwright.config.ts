import { defineConfig, devices } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Playwright config for the e2e/ suites.
//
// REAL BACKEND, LOCAL FRONTEND (2026-09-14). Every project's default baseURL is
// the local `vite preview` of THIS checkout (HAPPY_PATH_BASE_URL below), never
// the deployed site. Vercel paused the project on Hobby limits (3.1M of 1M edge
// requests) with test suites as the main load: one page load of this SPA is
// ~110-215 edge requests. The real-backend projects (journeys, prod-audit,
// a11y-prod, chromium) still talk to prod Supabase with the shared test
// accounts; only the HTML/JS host is local. Start the server with
// PLAYWRIGHT_WEB_SERVER=1 (the webServer block below builds and serves), or in
// CI with .github/actions/local-preview. PLAYWRIGHT_BASE_URL still overrides
// every project that does not pin its own. Guarded by
// src/test/noTestTrafficOnVercel.test.ts.
//
//   - chromium     — the real-backend specs outside a project dir (auth,
//                    payment-lifecycle, prod-lifecycle, mobile-viewports).
//   - happy-path   — Supabase calls fully mocked via route(); always local.

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

// The happy-path preview server's port, in ONE place.
//
// It used to be the literal 4173 in three places (the project's baseURL, the
// webServer command, the webServer url) plus a fourth in
// e2e/happy-path/fixtures.ts. With `reuseExistingServer: !CI`, two local
// sessions running this suite at once share one server on one port — and the
// documented way to get a fresh build is `kill $(lsof -ti:4173)`, so whichever
// session starts second kills the first one's server mid-run. That surfaces as
// `net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173/…` on whatever specs
// happened to be in flight — a different, arbitrary set every time, with
// nothing wrong in the app or the spec. Set HAPPY_PATH_PORT (or the full
// HAPPY_PATH_BASE_URL, which fixtures.ts already reads) to give a session its
// own server. CI runs one job per machine and needs neither.
//
// DEFAULT PER CHECKOUT (owner, 2026-09-12). The main checkout keeps 4173; any
// other checkout (agent worktrees under .claude/worktrees/, ~/.lh-* trees) gets
// a stable port derived from its path, so parallel copies never adopt each
// other's preview. Written back to process.env so workers and fixtures.ts,
// which read HAPPY_PATH_PORT, agree with the config.
function defaultHappyPathPort(): string {
  const root = process.cwd();
  if (root.endsWith("/louisianahelpr")) return "4173";
  let h = 0;
  for (const ch of root) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return String(4200 + (h % 700));
}
const HAPPY_PATH_PORT = process.env.HAPPY_PATH_PORT || defaultHappyPathPort();
process.env.HAPPY_PATH_PORT = HAPPY_PATH_PORT;
const HAPPY_PATH_BASE_URL =
  process.env.HAPPY_PATH_BASE_URL || `http://127.0.0.1:${HAPPY_PATH_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // One browser run at a time on this machine; see e2e/browserLock.ts.
  globalSetup: "./e2e/globalSetup.ts",
  globalTeardown: "./e2e/globalTeardown.ts",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Locally 1 worker: Playwright's default (half the cores = 4 browsers) swaps
  // the owner's 8 GB Mac when agent lanes run alongside. Override with --workers.
  workers: process.env.CI ? 2 : 1,
  // skipReporter: a skip is reported, and an unjustified one fails the run
  // (e2e/skipAllowlist.ts, docs/OPEN.md Q52). A CLI `--reporter` REPLACES this
  // list, so CI invocations name it explicitly too.
  reporter: process.env.CI
    ? [["list"], ["./e2e/reporters/skipReporter.ts"]]
    : [["list"], ["html", { open: "never" }], ["./e2e/reporters/skipReporter.ts"]],
  use: {
    // Local build by default — never the deployed site (see the header).
    baseURL: process.env.PLAYWRIGHT_BASE_URL || HAPPY_PATH_BASE_URL,
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
    // Real-user journeys against this commit's local build + REAL backend (prod
    // Supabase, the two shared E2E accounts). Serial: they share accounts.
    // Run with `npm run test:journeys`; CI: .github/workflows/e2e-journeys.yml.
    {
      name: "journeys",
      testDir: "./e2e/journeys",
      fullyParallel: false,
      timeout: 6 * 60_000,
      retries: 0,
      use: { ...devices["Desktop Chrome"], screenshot: "only-on-failure", trace: "retain-on-failure", actionTimeout: 20_000 },
    },
    // The same journeys in real WebKit: the app ships in a WKWebView.
    {
      name: "journeys-webkit",
      testDir: "./e2e/journeys",
      fullyParallel: false,
      timeout: 6 * 60_000,
      retries: 0,
      use: { ...devices["iPhone 13"], screenshot: "only-on-failure", trace: "retain-on-failure", actionTimeout: 20_000 },
    },
    // PROD audits (owner, 2026-09-12: no mock mode ever): messy input on every
    // form and the deep-link / interruption journeys, against this commit's
    // local build (default baseURL) and prod Supabase as the shared test accounts.
    // Phone-sized: 375 is the primary surface. Serial: the specs share two
    // accounts. Nightly: .github/workflows/prod-audit.yml.
    //
    // The block opens with `name:` on purpose: src/test/e2eSpecsReachableInCi
    // parses this file literally, and a comment before `name:` makes the whole
    // project invisible to it — i.e. its specs silently report as run by no CI
    // job.
    {
      name: "prod-audit",
      testDir: "./e2e/prod-audit",
      fullyParallel: false,
      workers: 1,
      timeout: 8 * 60_000,
      retries: 0,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        isMobile: false,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        serviceWorkers: "block",
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
        actionTimeout: 20_000,
      },
    },
    {
      name: "canary",
      // docs/OPEN.md Q61: the HOURLY core-loop canary on prod, one serial test
      // on the shared accounts. CI: .github/workflows/core-loop-canary.yml.
      testDir: "./e2e/canary",
      fullyParallel: false,
      workers: 1,
      timeout: 30 * 60_000,
      retries: 0,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        isMobile: false,
        hasTouch: true,
        serviceWorkers: "block",
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
        actionTimeout: 20_000,
      },
    },
    {
      name: "chromium",
      // The real-backend specs outside a project dir — excludes happy-path/*
      // (mocked) and the dirs that have their own project.
      testIgnore: /(happy-path|journeys|a11y-prod|prod-audit|canary)\//,
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
        baseURL: HAPPY_PATH_BASE_URL,
        // Block service worker registration so the Workbox SW (bundled in the
        // production build) cannot intercept Supabase fetches before
        // page.route() mocks can handle them. Without this the SW's
        // NetworkFirst handler calls the real Supabase URL with our fake test
        // tokens, gets 401s, and the /my-posts job list never renders.
        serviceWorkers: "block",
      },
    },
    {
      // The SAME happy-path suite in real WebKit (owner, 2026-09-12: nightly
      // WebKit run). The app ships in a WKWebView, and every other project is
      // Chromium, which cannot see WebKit-only defects (CLAUDE.md, WebKit rule).
      // Run only by name: .github/workflows/nightly-webkit.yml.
      name: "happy-path-webkit",
      testDir: "./e2e/happy-path",
      use: {
        ...devices["iPhone 13"],
        viewport: { width: 375, height: 812 },
        baseURL: HAPPY_PATH_BASE_URL,
        serviceWorkers: "block",
      },
    },
    {
      name: "a11y-prod",
      // The UI audit evidence sweep against PROD data (e2e/a11y-prod): the same
      // capture + gate as the mocked sweep, on this commit's local build with
      // the real backend and the shared test accounts. Chromium at the phone viewport,
      // so its report is the baseline the WebKit run below is diffed against.
      // Read-only; CI: .github/workflows/a11y-webkit-prod.yml. (`name:` is
      // first so src/test/e2eSpecsReachableInCi.test.ts can read this block.)
      testDir: "./e2e/a11y-prod",
      fullyParallel: false,
      timeout: 90_000,
      retries: 0,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        isMobile: false,
        hasTouch: true,
        serviceWorkers: "block",
      },
    },
    {
      name: "a11y-prod-webkit",
      // The same prod sweep in REAL WebKit on an iPhone 13 profile — what an
      // iPhone user's WKWebView actually renders. Every other axe run in this
      // repo is Chromium; a WebKit-only violation is invisible to all of them.
      testDir: "./e2e/a11y-prod",
      fullyParallel: false,
      timeout: 90_000,
      retries: 0,
      use: {
        ...devices["iPhone 13"],
        viewport: { width: 375, height: 812 },
        serviceWorkers: "block",
      },
    },
  ],
  // Auto-start `vite preview` of this checkout. Gated behind
  // PLAYWRIGHT_WEB_SERVER=1 because Playwright's webServer block runs for EVERY
  // project, and a CI job that already serves the build
  // (.github/actions/local-preview) must not build twice.
  //
  // The CI workflow at .github/workflows/e2e-happy-path.yml sets the
  // env var; locally, run `PLAYWRIGHT_WEB_SERVER=1 npm run test:e2e:happy`
  // (or use the test:e2e:happy npm script which sets it for you).
  webServer: process.env.PLAYWRIGHT_WEB_SERVER
    ? {
        command: `npm run build && npx vite preview --port ${HAPPY_PATH_PORT} --strictPort --host 127.0.0.1`,
        url: HAPPY_PATH_BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
        // The REAL project and its publishable (anon) key — what the real-
        // backend projects need, and harmless for happy-path, which mocks every
        // Supabase call. A value must be present or supabase-js throws
        // "supabaseUrl is required" and React never mounts. The publishable key
        // is already in vitest.config.ts (a committed file), so this is safe.
        env: {
          VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "https://fncmgoasalhdgfwzhsqa.supabase.co",
          VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_iYs06Xj5G6Q_ezqzrSncTw_J1EiENRP",
        },
      }
    : undefined,
});
