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

/**
 * Layout measurements taken per screen.
 *
 * The sweep used to capture only a screenshot + an axe report, which meant a
 * human had to open 78 PNGs to notice anything. These are the checks that CAN
 * be decided mechanically, so they land in the JSON report as findings rather
 * than as pictures someone has to interpret.
 */
interface LayoutReport {
  /** documentElement.scrollWidth - clientWidth. Must be 0. */
  overflowPx: number;
  /** Elements wider than the viewport — the CAUSE, not just the symptom. */
  overflowOffenders: string[];
  /** Visible text computed below the ds-9 (9px) floor. */
  belowTypeFloor: string[];
  /** Standalone controls under the 44px HIG/WCAG-2.5.5 minimum. */
  smallTapTargets: string[];
  /** Should be exactly 1. */
  h1Count: number;
  /**
   * `document.title`. Captured because a page that never calls usePageMeta
   * shows either index.html's landing title (cold load) or the bare "Helpr"
   * that usePageMeta's cleanup resets to when the PREVIOUS page unmounts —
   * so the tab, history entry and bookmark all fail to name the page, and a
   * screen reader announces nothing useful on an SPA route change. Neither
   * failure is visible on the page itself, which is why a screenshot sweep
   * missed it entirely.
   */
  documentTitle: string;
  /** console.error / warn / unhandled rejection seen while loading. */
  consoleIssues: string[];
}

interface ScreenResult {
  index: number;
  name: string;
  url: string;
  auth: "anon" | "authed";
  /** Viewport + theme this row was captured at. */
  variant?: string;
  status: "ok" | "skipped" | "failed";
  screenshot?: string;
  totalViolations?: number;
  topViolations?: ViolationSummary[];
  layout?: LayoutReport;
  error?: string;
  notes?: string;
}

/**
 * Viewport + theme matrix.
 *
 * The sweep previously ran ONLY at the project's fixed 375x812 in light mode,
 * so nothing desktop-specific and nothing dark-mode-specific was ever seen —
 * which is precisely where this app's known layout bugs live (the desktop rail
 * double-inset, the width-ladder divergence). 320 is included because that is
 * where truncation and wrapping fail first.
 *
 * Controlled by SWEEP_VARIANTS so a quick run stays quick:
 *   (unset)          → phone-light only, the old behaviour, ~3 min
 *   SWEEP_VARIANTS=all → every variant below, ~4x the wall clock
 *
 * Theme is set via the `data-theme` attribute, NOT prefers-color-scheme —
 * this app reads the attribute, so emulating the OS colour scheme tests
 * nothing at all.
 */
interface Variant {
  tag: string;
  width: number;
  height: number;
  theme: "light" | "dark";
}

const ALL_VARIANTS: Variant[] = [
  { tag: "phone-light", width: 375, height: 812, theme: "light" },
  { tag: "phone-dark", width: 375, height: 812, theme: "dark" },
  { tag: "small-light", width: 320, height: 640, theme: "light" },
  { tag: "desktop-light", width: 1440, height: 900, theme: "light" },
];

const VARIANTS: Variant[] =
  process.env.SWEEP_VARIANTS === "all"
    ? ALL_VARIANTS
    : [ALL_VARIANTS[0]];

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

/**
 * Measure the layout rules that can be decided without a human eye.
 *
 * Runs in the page. Every check filters to VISIBLE elements first — a hidden
 * 0x0 desktop-only node measured at 375px was a false-positive class in a
 * previous audit, so absence of that filter is itself a bug.
 */
async function measureLayout(
  page: import("@playwright/test").Page,
): Promise<LayoutReport> {
  return page.evaluate(() => {
    const de = document.documentElement;
    const vis = (e: Element) => {
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(e);
      return cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0.05;
    };

    const overflowOffenders: string[] = [];
    document.querySelectorAll("#root *").forEach((e) => {
      if (!vis(e)) return;
      const r = e.getBoundingClientRect();
      if (r.width > de.clientWidth + 1) {
        overflowOffenders.push(
          `${e.tagName}.${String((e as HTMLElement).className || "").slice(0, 36)} @${Math.round(r.width)}px`,
        );
      }
    });

    const belowTypeFloor: string[] = [];
    const smallTapTargets: string[] = [];
    document.querySelectorAll("#root *").forEach((e) => {
      if (!vis(e)) return;
      if (e.children.length === 0 && (e.textContent ?? "").trim()) {
        const fs = parseFloat(getComputedStyle(e).fontSize);
        if (fs < 9) belowTypeFloor.push(`${fs}px "${(e.textContent ?? "").trim().slice(0, 24)}"`);
      }
    });
    document.querySelectorAll("#root button,#root a[href],#root [role=button]").forEach((e) => {
      if (!vis(e)) return;
      // Skip links inside running prose — an inline link in a sentence is not
      // a standalone control and is not expected to be 44px tall.
      if (e.closest("p") || e.closest("li")) return;
      if (getComputedStyle(e).display === "inline") return;
      // Skip-to-content links are deliberately 1px until focused; they are an
      // accessibility feature, not an undersized control.
      if (/skip to/i.test((e.textContent ?? "").trim())) return;
      const r = e.getBoundingClientRect();
      if (r.height < 44) {
        const label = (e.textContent ?? "").trim().slice(0, 20) || e.getAttribute("aria-label") || e.tagName;
        smallTapTargets.push(`${label} @${Math.round(r.height)}px`);
      }
    });

    return {
      overflowPx: de.scrollWidth - de.clientWidth,
      overflowOffenders: overflowOffenders.slice(0, 5),
      belowTypeFloor: [...new Set(belowTypeFloor)].slice(0, 5),
      smallTapTargets: [...new Set(smallTapTargets)].slice(0, 8),
      h1Count: document.querySelectorAll("#root h1").length,
      documentTitle: document.title,
      consoleIssues: [],
    };
  });
}

async function captureScreen(
  page: import("@playwright/test").Page,
  index: number,
  name: string,
  url: string,
  auth: "anon" | "authed",
  extraSetup?: () => Promise<void>,
  variant: Variant = VARIANTS[0],
): Promise<void> {
  const result: ScreenResult = { index, name, url, auth, variant: variant.tag, status: "failed" };
  // Console noise is a per-screen finding, so listen BEFORE navigating —
  // attaching after goto() misses everything logged during first paint.
  const consoleIssues: string[] = [];
  // Noise the HARNESS causes, not the app. Left unfiltered these appear on
  // every screen and drown the real findings.
  const HARNESS_NOISE = [
    /Service Worker registration blocked by Playwright/i,
    /Download the React DevTools/i,
    /\[vite\] connect/i,
  ];
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const text = m.text();
    if (HARNESS_NOISE.some((rx) => rx.test(text))) return;
    consoleIssues.push(`${m.type()}: ${text.slice(0, 110)}`);
  });
  page.on("pageerror", (e) => consoleIssues.push(`uncaught: ${String(e.message).slice(0, 110)}`));
  try {
    await page.setViewportSize({ width: variant.width, height: variant.height });
    // Set the theme BEFORE any app JS runs, so the first paint is already in
    // the right mode — flipping it after load can leave transition styles
    // mid-flight in the screenshot.
    // documentElement does not exist yet at addInitScript time on a fresh
    // document, so guard it and fall back to DOMContentLoaded. Without the
    // guard this threw "Cannot read properties of null" on EVERY screen and
    // polluted the console findings for all 75 of them.
    await page.addInitScript((theme) => {
      const set = () => document.documentElement?.setAttribute("data-theme", theme);
      if (document.documentElement) set();
      else document.addEventListener("DOMContentLoaded", set, { once: true });
    }, variant.theme);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.evaluate((theme) => {
      document.documentElement.setAttribute("data-theme", theme);
    }, variant.theme);
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
    const fileName = `${String(index).padStart(3, "0")}-${slug}-${variant.tag}.png`;
    const screenshotPath = resolve(OUTPUT_DIR, fileName);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    result.screenshot = screenshotPath;

    result.layout = await measureLayout(page);
    result.layout.consoleIssues = [...new Set(consoleIssues)].slice(0, 5);

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

  for (const v of VARIANTS) {
    for (const screen of ANON_SCREENS) {
      const i = ++index;
      test(`${String(i).padStart(3, "0")} ${screen.name} (anon/${v.tag})`, async ({ page }) => {
        await installSupabaseMocks(page, { seed: true, rules: screen.rules });
        await captureScreen(page, i, screen.name, screen.url, "anon", screen.extraSetup ? () => screen.extraSetup!(page) : undefined, v);
      });
    }
  }

  // The exhaustive matrix: every authed screen under BOTH roles.
  const ROLES = [
    { tag: "customer", user: FAKE_CUSTOMER },
    { tag: "helper", user: FAKE_HELPER },
  ] as const;

  for (const v of VARIANTS) {
    for (const role of ROLES) {
      for (const screen of AUTHED_SCREENS) {
        const i = ++index;
        const name = `${role.tag}-${screen.name}`;
        test(`${String(i).padStart(3, "0")} ${name} (${role.tag}/${v.tag})`, async ({ context, page, baseURL }) => {
          await seedAuthedSession(context, role.user, baseURL ?? "");
          await installSupabaseMocks(page, { user: role.user, rules: screen.rules, seed: true });
          await captureScreen(page, i, name, screen.url, "authed", screen.extraSetup ? () => screen.extraSetup!(page) : undefined, v);
        });
      }
    }
  }

  // Admin (role-elevated customer).
  for (const v of VARIANTS) {
    for (const screen of ADMIN_SCREENS) {
      const i = ++index;
      test(`${String(i).padStart(3, "0")} ${screen.name} (admin/${v.tag})`, async ({ context, page, baseURL }) => {
        await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
        await installSupabaseMocks(page, { user: FAKE_CUSTOMER, rules: screen.rules, seed: true });
        await captureScreen(page, i, screen.name, screen.url, "authed", screen.extraSetup ? () => screen.extraSetup!(page) : undefined, v);
      });
    }
  }

  // Sanity: at least one screen succeeded; otherwise something fundamental
  // (preview server, route) is broken and we want a loud failure.
  test("zz sanity report exists", () => {
    expect(results.some((r) => r.status === "ok")).toBe(true);
  });
});
