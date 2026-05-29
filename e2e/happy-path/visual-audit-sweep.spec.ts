// Pre-TestFlight visual + a11y evidence sweep.
//
// Captures screenshots + axe-core violation reports for 10 key screens at
// the iPhone-13 viewport (375x812). Outputs to /tmp/ui-review/:
//   - <N>-<slug>.png       (one per screen)
//   - a11y-report.json     (per-screen violation summary)
//
// Read-only: no app code is modified. Network calls to Supabase are mocked
// with empty arrays via installSupabaseMocks(); authed routes use a
// pre-seeded session via seedAuthedSession() so we don't have to drive the
// multi-step Signup form.
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
  installSupabaseMocks,
  seedAuthedSession,
} from "./fixtures";

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

test.describe.configure({ mode: "serial" });

test.describe("UI audit evidence sweep", () => {
  // Each test owns one screen — Playwright's per-test timeout = 30s
  // from the global config (sweep should never approach it; if it does
  // the catch above flags the screen failed and the next one runs).

  test("01 landing (anon)", async ({ page }) => {
    await installSupabaseMocks(page);
    await captureScreen(page, 1, "landing", "/", "anon");
  });

  test("02 jobs (anon)", async ({ page }) => {
    await installSupabaseMocks(page);
    await captureScreen(page, 2, "jobs", "/jobs", "anon");
  });

  test("03 signup (anon)", async ({ page }) => {
    await installSupabaseMocks(page);
    await captureScreen(page, 3, "signup", "/signup", "anon");
  });

  test("04 login (anon)", async ({ page }) => {
    await installSupabaseMocks(page);
    await captureScreen(page, 4, "login", "/login", "anon");
  });

  test("05 dashboard (authed)", async ({ context, page, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER });
    await captureScreen(page, 5, "dashboard", "/dashboard", "authed");
  });

  test("06 my-jobs (authed)", async ({ context, page, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER });
    await captureScreen(page, 6, "my-jobs", "/my-jobs", "authed");
  });

  test("07 messages (authed)", async ({ context, page, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER });
    await captureScreen(page, 7, "messages", "/messages", "authed");
  });

  test("08 profile (authed)", async ({ context, page, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER });
    await captureScreen(page, 8, "profile", "/profile", "authed");
  });

  test("09 post-job (authed)", async ({ context, page, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER });
    await captureScreen(page, 9, "post-job", "/post-job", "authed");
  });

  test("10 dashboard map (authed)", async ({ context, page, baseURL }) => {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER });
    await captureScreen(page, 10, "dashboard-map", "/dashboard", "authed", async () => {
      // Toggle the dashboard map view. We try several selector variants
      // because the toggle is a Tabs/Switch/Button across iterations.
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
      // If no map toggle exists, record the note via expect().toPass-style
      // soft fallback — we still capture the dashboard screenshot.
      const last = results[results.length - 1];
      if (last) last.notes = (last.notes ?? "") + "map-toggle-not-found;";
    });
  });

  // Sanity: at least one screen succeeded; otherwise something fundamental
  // (preview server, route) is broken and we want a loud failure.
  test("zz sanity report exists", () => {
    expect(results.some((r) => r.status === "ok")).toBe(true);
  });
});
