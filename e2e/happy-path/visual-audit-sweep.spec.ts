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
  seedAuthedSession,
} from "./fixtures";
// Route catalog + the mechanical layout probe are shared with
// empty-state-sweep.spec.ts — see the header of ./auditRoutes for why.
import {
  ADMIN_SCREENS,
  ANON_SCREENS,
  AUTHED_SCREENS,
  measureLayout,
  type LayoutReport,
} from "./auditRoutes";

const OUTPUT_DIR = "/tmp/ui-review";
mkdirSync(OUTPUT_DIR, { recursive: true });

interface ViolationSummary {
  id: string;
  impact: string | null;
  help: string;
  nodes: number;
  targets: string[];
  /** axe's own measured numbers, e.g. "#aaa on #fff = 2.3:1 (needs 4.5, 11px)". */
  detail: string[];
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

// (unset) → phone-light only · "all" → the whole matrix · or a comma list of
// tags ("phone-dark,desktop-light"). The comma list exists so a finding from
// the empty-state sweep can be re-run SEEDED at the same variant — that is the
// only way to tell "this breaks when the user has no data" apart from "this is
// broken everywhere and nobody had looked at this viewport before".
const VARIANTS: Variant[] = (() => {
  const want = process.env.SWEEP_VARIANTS;
  if (!want) return [ALL_VARIANTS[0]];
  if (want === "all") return ALL_VARIANTS;
  const tags = want.split(",").map((t) => t.trim());
  const picked = ALL_VARIANTS.filter((v) => tags.includes(v.tag));
  if (!picked.length) throw new Error(`SWEEP_VARIANTS=${want} matched no variant tag`);
  return picked;
})();

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
      /**
       * axe already computed the exact foreground, background and ratio for
       * a colour-contrast failure — surfacing it here saves re-deriving those
       * numbers by hand, which is where contrast audits go wrong: a naive
       * getComputedStyle read misses rgba alpha and gradient backgrounds and
       * invents failures that do not exist. Take axe's numbers.
       */
      detail: v.nodes.slice(0, 3).flatMap((n) =>
        [...(n.any ?? []), ...(n.all ?? []), ...(n.none ?? [])]
          .filter((c) => c.data && typeof c.data === "object")
          .map((c) => {
            const d = c.data as Record<string, unknown>;
            return d.contrastRatio
              ? `${String(d.fgColor)} on ${String(d.bgColor)} = ${String(d.contrastRatio)}:1 (needs ${String(d.expectedContrastRatio ?? "?")}, ${String(d.fontSize ?? "?")})`
              : "";
          })
          .filter(Boolean),
      ),
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
