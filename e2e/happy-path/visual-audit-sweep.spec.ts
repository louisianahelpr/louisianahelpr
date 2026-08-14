// Pre-TestFlight visual + a11y evidence sweep.
//
// Captures screenshots + axe-core violation reports for ~40 key screens at
// the iPhone-13 viewport (375x812), across anon / authed-customer /
// authed-helper roles. Outputs to /tmp/ui-review/:
//   - <N>-<slug>.png       (one per screen)
//   - a11y-report.json     (per-screen violation summary)
//
// Read-only: no app code is modified. Network calls to Supabase are mocked
// with empty arrays via installSupabaseMocks(); authed routes use a
// pre-seeded session via seedAuthedSession() so we don't have to drive the
// multi-step Signup form.
//
// Screens are declared as data (ANON_SCREENS / CUSTOMER_SCREENS /
// HELPER_SCREENS) and registered in a loop, so adding coverage is a
// one-line edit. Indices are assigned sequentially across all groups.
//
// This is an EVIDENCE sweep (screenshots + an a11y JSON report), not a
// gate — it asserts nothing beyond "a screen rendered". So it is SKIPPED
// in normal CI to avoid burning ~1.5 min of Actions minutes per run on
// artifacts nobody reads. Run it on demand with:
//   RUN_VISUAL_SWEEP=1 PLAYWRIGHT_WEB_SERVER=1 \
//     npx playwright test --project=happy-path visual-audit-sweep
//
// Spec lives under e2e/happy-path/ because the playwright.config.ts
// happy-path project already wires the 375x812 viewport, mobile UA, and
// the vite-preview webServer block. (The mission spec said "e2e/visual-audit/"
// but the file MUST be under happy-path/ for the preview server + mobile
// viewport to apply; symlink or move discouraged because the chromium
// project explicitly testIgnore's /happy-path/.)

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  FAKE_CUSTOMER,
  FAKE_HELPER,
  installSupabaseMocks,
  mockTable,
  seedAuthedSession,
  type MockSupabaseOptions,
} from "./fixtures";

type MockRules = NonNullable<MockSupabaseOptions["rules"]>;

const OUTPUT_DIR = "/tmp/ui-review";
mkdirSync(OUTPUT_DIR, { recursive: true });

interface ViolationSummary {
  id: string;
  impact: string | null;
  help: string;
  nodes: number;
  targets: string[];
}

interface ScreenResult {
  index: number;
  name: string;
  url: string;
  auth: "anon" | "authed";
  status: "ok" | "skipped" | "failed";
  screenshot?: string;
  totalViolations?: number;
  topViolations?: ViolationSummary[];
  error?: string;
  notes?: string;
}

const results: ScreenResult[] = [];

function writeReport(): void {
  const reportPath = resolve(OUTPUT_DIR, "a11y-report.json");
  writeFileSync(
    reportPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), screens: results },
      null,
      2,
    ),
  );
}

test.afterAll(() => {
  writeReport();
});

async function captureScreen(
  page: import("@playwright/test").Page,
  index: number,
  name: string,
  url: string,
  auth: "anon" | "authed",
  extraSetup?: () => Promise<void>,
): Promise<void> {
  const result: ScreenResult = { index, name, url, auth, status: "failed" };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Give SPA a chance to settle — first paint + lazy chunks.
    await page
      .waitForLoadState("networkidle", { timeout: 15_000 })
      .catch(() => {
        result.notes = (result.notes ?? "") + "networkidle-timeout;";
      });
    await page
      .evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready ?? Promise.resolve())
      .catch(() => undefined);
    // Small settle for animations.
    await page.waitForTimeout(500);

    if (extraSetup) {
      await extraSetup();
      await page
        .waitForLoadState("networkidle", { timeout: 10_000 })
        .catch(() => undefined);
      await page.waitForTimeout(500);
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const fileName = `${String(index).padStart(2, "0")}-${slug}.png`;
    const screenshotPath = resolve(OUTPUT_DIR, fileName);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    result.screenshot = screenshotPath;

    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    result.totalViolations = axe.violations.length;
    const ranked = [...axe.violations].sort((a, b) => {
      const order = { critical: 0, serious: 1, moderate: 2, minor: 3 } as const;
      const ai = order[(a.impact ?? "minor") as keyof typeof order] ?? 4;
      const bi = order[(b.impact ?? "minor") as keyof typeof order] ?? 4;
      return ai - bi;
    });
    result.topViolations = ranked.slice(0, 5).map((v) => ({
      id: v.id,
      impact: v.impact ?? null,
      help: v.help,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 3).flatMap((n) => n.target.map(String)),
    }));
    result.status = "ok";
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.status = "failed";
  } finally {
    results.push(result);
    writeReport();
  }
}

// Toggle the dashboard map view. The control has been a Tabs/Switch/Button
// across iterations, so we probe several selector variants.
async function toggleDashboardMap(page: import("@playwright/test").Page): Promise<void> {
  const candidates = [
    page.getByRole("tab", { name: /map/i }).first(),
    page.getByRole("button", { name: /map/i }).first(),
    page.getByRole("switch", { name: /map/i }).first(),
    page.locator("[data-testid='map-toggle']").first(),
    page.getByLabel(/map view/i).first(),
  ];
  for (const c of candidates) {
    try {
      if (await c.count()) {
        await c.click({ timeout: 2_000 });
        return;
      }
    } catch {
      /* try next */
    }
  }
  const last = results[results.length - 1];
  if (last) last.notes = (last.notes ?? "") + "map-toggle-not-found;";
}

interface ScreenSpec {
  name: string;
  url: string;
  extraSetup?: (page: import("@playwright/test").Page) => Promise<void>;
  // Extra REST/RPC overrides layered on top of the per-role defaults.
  // Used for screens that need a different mock shape (e.g. admin needs
  // user_roles to report role=admin so AdminRoute doesn't redirect).
  rules?: MockRules;
}

// Public / unauthenticated surfaces. Every non-redirect anon route in
// src/App.tsx, plus the catch-all NotFound.
const ANON_SCREENS: ScreenSpec[] = [
  { name: "landing", url: "/" },
  { name: "signup", url: "/signup" },
  { name: "login", url: "/login" },
  { name: "forgot-password", url: "/forgot-password" },
  { name: "reset-password", url: "/reset-password" },
  { name: "signup-pending", url: "/signup-pending" },
  { name: "account-pending", url: "/account-pending" },
  { name: "account-denied", url: "/account-denied" },
  { name: "account-banned", url: "/account-banned" },
  { name: "for-business", url: "/for-business" },
  { name: "legal-terms", url: "/legal?tab=terms" },
  { name: "legal-privacy", url: "/legal?tab=privacy" },
  { name: "legal-community", url: "/legal?tab=community" },
  { name: "data-rights", url: "/data-rights" },
  { name: "browse-guest", url: "/browse" },
  { name: "not-found", url: "/this-route-does-not-exist" },
];

// Authenticated surfaces. EVERY protected route in src/App.tsx + EVERY one
// of the 18 Profile tabs (see Tab union in src/pages/Profile.tsx). Each of
// these is captured under BOTH the customer and helper roles, since the
// same route renders different content per role (earnings/schedule/
// availability/credentials are helper-rich; payment/subscription/saved-
// helpers are customer-rich) — so this is the exhaustive matrix.
const AUTHED_SCREENS: ScreenSpec[] = [
  { name: "dashboard", url: "/dashboard" },
  { name: "dashboard-map", url: "/dashboard", extraSetup: toggleDashboardMap },
  { name: "my-posts", url: "/my-posts" },
  { name: "my-jobs", url: "/my-jobs" },
  { name: "jobs", url: "/jobs" },
  { name: "messages", url: "/messages" },
  { name: "post-job", url: "/post-job" },
  { name: "payment-success", url: "/payment-success" },
  { name: "complete-profile", url: "/complete-profile" },
  { name: "business-team", url: "/business/team" },
  { name: "user-profile", url: `/user/${FAKE_HELPER.id}` },
  // All 18 Profile tabs.
  { name: "profile-landing", url: "/profile" },
  { name: "profile-edit", url: "/profile?tab=profile" },
  { name: "profile-earnings", url: "/profile?tab=earnings" },
  { name: "profile-schedule", url: "/profile?tab=schedule" },
  { name: "profile-availability", url: "/profile?tab=availability" },
  { name: "profile-payment", url: "/profile?tab=payment" },
  { name: "profile-security", url: "/profile?tab=security" },
  { name: "profile-legal", url: "/profile?tab=legal" },
  { name: "profile-reviews", url: "/profile?tab=reviews" },
  { name: "profile-referral", url: "/profile?tab=referral" },
  { name: "profile-subscription", url: "/profile?tab=subscription" },
  { name: "profile-support", url: "/profile?tab=support" },
  { name: "profile-notifications", url: "/profile?tab=notifications" },
  { name: "profile-posted-jobs", url: "/profile?tab=posted_jobs" },
  { name: "profile-completed-jobs", url: "/profile?tab=completed_jobs" },
  { name: "profile-warnings", url: "/profile?tab=warnings" },
  { name: "profile-credentials", url: "/profile?tab=credentials" },
  { name: "profile-saved-helpers", url: "/profile?tab=saved_helpers" },
];

// Admin surface — gated by AdminRoute, which redirects to /dashboard unless
// user_roles reports role=admin. Override that one table so the real Admin
// page renders. Captured once (admin is a single role-elevated customer).
const ADMIN_SCREENS: ScreenSpec[] = [
  {
    name: "admin",
    url: "/admin",
    rules: [mockTable("user_roles", [{ role: "admin" }])],
  },
];

test.describe.configure({ mode: "serial" });

// Evidence sweep: opt-in only (see header). CI skips it; run locally with
// RUN_VISUAL_SWEEP=1.
const sweepDescribe = process.env.RUN_VISUAL_SWEEP ? test.describe : test.describe.skip;

sweepDescribe("UI audit evidence sweep", () => {
  // Each test owns one screen — Playwright's per-test timeout from the
  // global config applies; the catch in captureScreen flags a screen
  // failed and the next one still runs.

  let index = 0;

  for (const screen of ANON_SCREENS) {
    const i = ++index;
    test(`${String(i).padStart(3, "0")} ${screen.name} (anon)`, async ({ page }) => {
      await installSupabaseMocks(page, { seed: true, rules: screen.rules });
      await captureScreen(page, i, screen.name, screen.url, "anon", screen.extraSetup ? () => screen.extraSetup!(page) : undefined);
    });
  }

  // The exhaustive matrix: every authed screen under BOTH roles.
  const ROLES = [
    { tag: "customer", user: FAKE_CUSTOMER },
    { tag: "helper", user: FAKE_HELPER },
  ] as const;

  for (const role of ROLES) {
    for (const screen of AUTHED_SCREENS) {
      const i = ++index;
      const name = `${role.tag}-${screen.name}`;
      test(`${String(i).padStart(3, "0")} ${name} (${role.tag})`, async ({ context, page, baseURL }) => {
        await seedAuthedSession(context, role.user, baseURL ?? "");
        await installSupabaseMocks(page, { user: role.user, rules: screen.rules, seed: true });
        await captureScreen(page, i, name, screen.url, "authed", screen.extraSetup ? () => screen.extraSetup!(page) : undefined);
      });
    }
  }

  // Admin (role-elevated customer).
  for (const screen of ADMIN_SCREENS) {
    const i = ++index;
    test(`${String(i).padStart(3, "0")} ${screen.name} (admin)`, async ({ context, page, baseURL }) => {
      await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
      await installSupabaseMocks(page, { user: FAKE_CUSTOMER, rules: screen.rules, seed: true });
      await captureScreen(page, i, screen.name, screen.url, "authed", screen.extraSetup ? () => screen.extraSetup!(page) : undefined);
    });
  }

  // Sanity: at least one screen succeeded; otherwise something fundamental
  // (preview server, route) is broken and we want a loud failure.
  test("zz sanity report exists", () => {
    expect(results.some((r) => r.status === "ok")).toBe(true);
  });
});
