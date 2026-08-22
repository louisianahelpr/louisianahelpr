// EMPTY-STATE sweep — the gap the seeded sweep structurally cannot see.
//
// WHY
// ---
// visual-audit-sweep.spec.ts reports 0 violations across 80 route instances.
// That is true and it is narrow: the harness SEEDS rows, so it only ever
// photographs POPULATED, resting screens. A brand-new account — which is what
// every real user is on day one — sees a completely different render tree, and
// that tree has never been audited.
//
// The concrete bug this exists to catch already shipped: /messages rendered NO
// title and NO <h1> when the conversation list was empty, because the entire
// header was gated behind `!isEmpty`. Obvious in two seconds on a real device
// with no messages; invisible to a sweep that always has messages.
//
// WHAT IT DOES
// ------------
// Same route catalog as the seeded sweep (imported from ./auditRoutes, so the
// two cannot drift), but `installSupabaseMocks(page, { seed: false })` — every
// table SELECT answers `[]` and every RPC answers `null`. No jobs, no
// messages, no applications, no notifications, no saved helpers, no reviews,
// no earnings, no team members. The authed user's own `profiles` row is still
// returned, because without it ProtectedRoute's "Big 7" gate bounces every
// route to /complete-profile and the sweep would audit one screen 160 times.
//
// Unlike the seeded sweep this one ASSERTS. Per screen:
//   - exactly one <h1>
//   - non-empty document.title
//   - documentElement.scrollWidth <= clientWidth
//   - no visible element wider than the viewport
//   - zero axe violations (wcag2a/2aa/21a/21aa) via @axe-core/playwright
//   - no console errors / warnings / uncaught rejections
//   - <main> renders SOME visible text (an empty state with no message at all
//     is a bug — a blank panel tells the user nothing)
//
// A screen collects ALL of its findings before failing, so one bad screen
// reports everything wrong with it rather than stopping at the first check.
// Deliberately NOT `mode: "serial"` — serial would skip every remaining screen
// after the first failure, which is the opposite of what a findings sweep
// wants.
//
// CONTRAST SAMPLING: do not add one. A hand-rolled getComputedStyle contrast
// check produces four classes of false positive in this codebase (rgba alpha,
// gradient backgrounds, hidden 0x0 nodes, layered translucency). axe already
// computes the real composited ratio; take its numbers.
//
// RUNNING IT
// ----------
//   kill $(lsof -ti:4173) 2>/dev/null; sleep 2
//   RUN_EMPTY_SWEEP=1 PLAYWRIGHT_WEB_SERVER=1 \
//     npx playwright test --project=happy-path empty-state-sweep
//
// The kill is not optional. playwright.config.ts sets
// `reuseExistingServer: !CI`, so a preview server already listening on 4173 is
// reused and `npm run build` never runs — you then measure a STALE dist/ and
// confidently report findings that were fixed hours ago. This trap has
// produced two false reports in this repo. If a result surprises you, kill and
// re-run BEFORE forming a theory.
//
// Opt-in via RUN_EMPTY_SWEEP for now, matching the seeded sweep, because it is
// a NEW gate over a surface that has never been gated — turning it on in CI
// before its findings are fixed would just red main. Flip `sweepDescribe` to
// an unconditional `test.describe` once the findings it reports are closed.
//
// Env knobs:
//   EMPTY_SWEEP_VARIANTS=all  → phone-light + phone-dark + 320 + desktop-1440
//   EMPTY_SWEEP_ROLES=customer → skip the helper pass (halves wall clock)

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  FAKE_CUSTOMER,
  FAKE_HELPER,
  installSupabaseMocks,
  seedAuthedSession,
} from "./fixtures";
import {
  ADMIN_SCREENS,
  ANON_SCREENS,
  AUTHED_SCREENS,
  measureLayout,
  settleAnimations,
  type LayoutReport,
  type ScreenSpec,
} from "./auditRoutes";

const OUTPUT_DIR = "/tmp/ui-review-empty";
const SCREEN_DIR = resolve(OUTPUT_DIR, "screens");
mkdirSync(SCREEN_DIR, { recursive: true });

/**
 * One JSON file per screen rather than one shared array.
 *
 * This spec runs in PARALLEL (see the header), which means several Playwright
 * worker PROCESSES. A module-level results array plus a shared writeReport()
 * would give each worker its own copy of the array and each would overwrite the
 * others' file — the report would silently contain only the last worker's
 * screens. Per-screen files are aggregated after the run instead.
 */
function writeScreenReport(r: ScreenResult): void {
  const slug = `${String(r.index).padStart(3, "0")}-${r.name}-${r.variant}`.replace(
    /[^a-z0-9-]+/gi,
    "-",
  );
  writeFileSync(resolve(SCREEN_DIR, `${slug}.json`), JSON.stringify(r, null, 2));
}

interface AxeSummary {
  id: string;
  impact: string | null;
  help: string;
  nodes: number;
  targets: string[];
  /** axe's own measured numbers for contrast failures. */
  detail: string[];
}

interface ScreenResult {
  index: number;
  name: string;
  url: string;
  /** Where the router actually landed — a route that redirects was not audited. */
  landedOn?: string;
  auth: "anon" | "authed";
  role?: string;
  variant: string;
  status: "ok" | "findings" | "error";
  findings: string[];
  layout?: LayoutReport;
  axe?: AxeSummary[];
  screenshot?: string;
  error?: string;
  notes?: string;
}

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
// tags ("desktop-light,small-light"). The comma list matters: 608 tests in one
// process is heavy enough to get the runner killed on a laptop, so the matrix
// is meant to be walked one variant at a time.
const VARIANTS: Variant[] = (() => {
  const want = process.env.EMPTY_SWEEP_VARIANTS;
  if (!want) return [ALL_VARIANTS[0]];
  if (want === "all") return ALL_VARIANTS;
  const tags = want.split(",").map((t) => t.trim());
  const picked = ALL_VARIANTS.filter((v) => tags.includes(v.tag));
  if (!picked.length) throw new Error(`EMPTY_SWEEP_VARIANTS=${want} matched no variant tag`);
  return picked;
})();

/**
 * Minimum visible characters inside <main> for a screen to count as "not
 * blank". 20 is deliberately low: the bar is "this screen says SOMETHING to a
 * user who has no data", not "this screen is well written". A real empty state
 * ("You haven't posted any jobs yet") clears it by a mile; a bare panel with a
 * lone icon does not.
 */
const MIN_MAIN_TEXT = 20;

// Noise the HARNESS causes, not the app. Left unfiltered these appear on every
// screen and drown the real findings.
const HARNESS_NOISE = [
  /Service Worker registration blocked by Playwright/i,
  /Download the React DevTools/i,
  /\[vite\] connect/i,
];

/**
 * Load a screen with EVERY collection empty and collect every invariant it
 * breaks. Never throws for a finding — findings are data; only an
 * infrastructure failure (navigation error) sets status "error".
 */
async function auditEmptyScreen(
  page: Page,
  meta: Omit<ScreenResult, "status" | "findings">,
  variant: Variant,
  extraSetup?: (page: Page) => Promise<void>,
): Promise<ScreenResult> {
  const result: ScreenResult = { ...meta, status: "ok", findings: [] };

  // Listen BEFORE navigating — attaching after goto() misses everything logged
  // during first paint, which is exactly when an empty-data render crashes.
  const consoleIssues: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const text = m.text();
    if (HARNESS_NOISE.some((rx) => rx.test(text))) return;
    consoleIssues.push(`${m.type()}: ${text.slice(0, 140)}`);
  });
  page.on("pageerror", (e) => consoleIssues.push(`uncaught: ${String(e.message).slice(0, 140)}`));

  try {
    await page.setViewportSize({ width: variant.width, height: variant.height });
    // Theme is read from the `data-theme` attribute, NOT prefers-color-scheme,
    // so emulating the OS colour scheme would test nothing. documentElement
    // may not exist yet at addInitScript time, hence the guard.
    await page.addInitScript((theme) => {
      const set = () => document.documentElement?.setAttribute("data-theme", theme);
      if (document.documentElement) set();
      else document.addEventListener("DOMContentLoaded", set, { once: true });
    }, variant.theme);

    // Suppress the onboarding tour, as home-chrome and overlay-sweep already
    // do. Not cosmetic — it is what makes this sweep's axe results mean
    // anything.
    //
    // The tour opens on a 1.5s timer AFTER load and then fades in.
    // settleAnimations counts `minMs` from navigation start and gives its
    // opacity-stabilisation wait a 6s budget that ends in `.catch(() => {})`,
    // so on a loaded worker it silently gives up and axe samples the overlay
    // MID-FADE — near-transparent text over near-transparent background, which
    // axe faithfully reports as a 1.03:1 contrast failure that does not exist.
    //
    // The symptom is the giveaway: run the sweep three times at --workers=4
    // and it fails on a DIFFERENT set of screens each time (5, then 2, then a
    // third set), while every one of them passes alone. A required check that
    // reports a different answer each run teaches everyone to ignore it, which
    // is worse than not having it.
    //
    // This does not lose tour coverage: the tour is not what an "empty state"
    // sweep is measuring, and it has its own specs.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          "helpr_onboarding",
          JSON.stringify({ completed: true, currentStep: 0, completedSteps: [], seen: true }),
        );
        localStorage.setItem("helpr.onboarding_tour_dismissed_at", new Date().toISOString());
      } catch { /* storage unavailable */ }
    });

    await page.goto(meta.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.evaluate((theme) => {
      document.documentElement.setAttribute("data-theme", theme);
    }, variant.theme);
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {
      result.notes = (result.notes ?? "") + "networkidle-timeout;";
    });
    await page
      .evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready ?? Promise.resolve())
      .catch(() => undefined);
    await page.waitForTimeout(600);

    if (extraSetup) {
      await extraSetup(page);
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(400);
    }

    const landed = new URL(page.url());
    result.landedOn = `${landed.pathname}${landed.search}`;

    // Deferred overlays (the onboarding tour opens on a 1.5s timer and fades
    // in) must be fully settled BEFORE axe runs, or axe samples them mid-fade
    // and invents contrast failures. See settleAnimations' note.
    await settleAnimations(page);

    const layout = await measureLayout(page);
    layout.consoleIssues = [...new Set(consoleIssues)].slice(0, 8);
    result.layout = layout;

    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 } as const;
    result.axe = [...axe.violations]
      .sort(
        (a, b) =>
          (order[(a.impact ?? "minor") as keyof typeof order] ?? 4) -
          (order[(b.impact ?? "minor") as keyof typeof order] ?? 4),
      )
      .map((v) => ({
        id: v.id,
        impact: v.impact ?? null,
        help: v.help,
        nodes: v.nodes.length,
        targets: v.nodes.slice(0, 3).flatMap((n) => n.target.map(String)),
        // axe already computed the exact composited fg/bg and ratio. Take its
        // numbers — re-deriving them by hand is where contrast audits invent
        // failures that do not exist.
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

    // ── Invariants ────────────────────────────────────────────────────────
    const f = result.findings;

    if (layout.h1Count !== 1) {
      f.push(
        `H1_COUNT: expected exactly 1 <h1>, found ${layout.h1Count}` +
          (layout.h1Texts.length ? ` [${layout.h1Texts.join(" | ")}]` : ""),
      );
    }
    if (!layout.documentTitle.trim()) {
      f.push("DOC_TITLE: document.title is empty");
    }
    if (layout.overflowPx > 0) {
      f.push(`H_OVERFLOW: documentElement.scrollWidth - clientWidth = ${layout.overflowPx}px`);
    }
    if (layout.overflowOffenders.length) {
      f.push(`WIDE_ELEMENT: wider than the ${variant.width}px viewport — ${layout.overflowOffenders.join("; ")}`);
    }
    if (result.axe.length) {
      f.push(
        `AXE: ${result.axe.length} violation(s) — ` +
          result.axe
            .map((v) => `${v.id}(${v.impact ?? "?"}, ${v.nodes} node(s), ${v.targets[0] ?? "?"})`)
            .join("; "),
      );
    }
    if (layout.consoleIssues.length) {
      f.push(`CONSOLE: ${layout.consoleIssues.join(" || ")}`);
    }
    if (layout.mainTextLength < MIN_MAIN_TEXT) {
      f.push(
        `BLANK_SCREEN: <main> renders ${layout.mainTextLength} visible chars ` +
          `(min ${MIN_MAIN_TEXT}) — sample: "${layout.mainTextSample}"`,
      );
    }

    if (f.length) {
      result.status = "findings";
      // Screenshot only the screens that failed something: 160 PNGs nobody
      // opens is how the previous sweep buried its own findings.
      const slug = `${String(meta.index).padStart(3, "0")}-${meta.name}-${variant.tag}`.replace(
        /[^a-z0-9-]+/gi,
        "-",
      );
      const shot = resolve(OUTPUT_DIR, `${slug}.png`);
      await page.screenshot({ path: shot, fullPage: false }).catch(() => undefined);
      result.screenshot = shot;
    }
  } catch (err) {
    result.status = "error";
    result.error = err instanceof Error ? err.message : String(err);
  }

  writeScreenReport(result);
  return result;
}

function assertClean(r: ScreenResult): void {
  if (r.status === "error") {
    throw new Error(`${r.name} (${r.variant}) failed to load: ${r.error}`);
  }
  expect(
    r.findings,
    `${r.name} @ ${r.url} (landed ${r.landedOn}, ${r.variant}) — empty-state findings:\n  - ${r.findings.join("\n  - ")}`,
  ).toEqual([]);
}

// Opt-in (see header). Flip to an unconditional test.describe once the
// findings this reports are fixed.
const sweepDescribe = process.env.RUN_EMPTY_SWEEP ? test.describe : test.describe.skip;

const ROLES = (
  [
    { tag: "customer", user: FAKE_CUSTOMER },
    { tag: "helper", user: FAKE_HELPER },
  ] as const
).filter((r) => !process.env.EMPTY_SWEEP_ROLES || process.env.EMPTY_SWEEP_ROLES.includes(r.tag));

// Screens whose whole point is the seeded fixture data collapse onto one
// identical render when every table is empty — auditing them all would report
// the same finding six times. See ScreenSpec.seededOnly.
const emptyStateScreens = (list: ScreenSpec[]) => list.filter((s) => !s.seededOnly);

sweepDescribe("empty-state sweep (every collection returns [])", () => {
  // Each screen does a full SPA boot + networkidle wait + axe scan; the global
  // 30s budget is not enough for the slower routes on a cold preview server.
  test.setTimeout(90_000);

  let index = 0;

  for (const v of VARIANTS) {
    for (const screen of emptyStateScreens(ANON_SCREENS)) {
      const i = ++index;
      test(`${String(i).padStart(3, "0")} ${screen.name} (anon/${v.tag}) [empty]`, async ({ page }) => {
        await installSupabaseMocks(page, { seed: false, rules: screen.rules });
        const r = await auditEmptyScreen(
          page,
          { index: i, name: screen.name, url: screen.url, auth: "anon", variant: v.tag },
          v,
          screen.extraSetup,
        );
        assertClean(r);
      });
    }
  }

  for (const v of VARIANTS) {
    for (const role of ROLES) {
      for (const screen of emptyStateScreens(AUTHED_SCREENS)) {
        const i = ++index;
        const name = `${role.tag}-${screen.name}`;
        test(`${String(i).padStart(3, "0")} ${name} (${role.tag}/${v.tag}) [empty]`, async ({
          context,
          page,
          baseURL,
        }) => {
          await seedAuthedSession(context, role.user, baseURL ?? "");
          await installSupabaseMocks(page, { user: role.user, seed: false, rules: screen.rules });
          const r = await auditEmptyScreen(
            page,
            { index: i, name, url: screen.url, auth: "authed", role: role.tag, variant: v.tag },
            v,
            screen.extraSetup,
          );
          assertClean(r);
        });
      }
    }
  }

  for (const v of VARIANTS) {
    for (const screen of ADMIN_SCREENS) {
      const i = ++index;
      test(`${String(i).padStart(3, "0")} ${screen.name} (admin/${v.tag}) [empty]`, async ({
        context,
        page,
        baseURL,
      }) => {
        await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
        await installSupabaseMocks(page, {
          user: FAKE_CUSTOMER,
          seed: false,
          rules: screen.rules,
        });
        const r = await auditEmptyScreen(
          page,
          { index: i, name: screen.name, url: screen.url, auth: "authed", role: "admin", variant: v.tag },
          v,
          screen.extraSetup,
        );
        assertClean(r);
      });
    }
  }
});
