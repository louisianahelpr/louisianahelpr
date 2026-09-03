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
// This produces evidence (screenshots + an a11y JSON report) AND gates on it:
// the final `zz gate` test fails the run if any screen failed to render, if
// axe reported ANY wcag2a/2aa/21a/21aa violation, or if a colour-contrast
// result comes back below AA or undecided. It used to record
// `totalViolations` and assert nothing, which is how a real 1.92:1 contrast
// failure sat green in it — and even after that was fixed, contrast itself was
// still invisible, because axe files every contrast result on a gradient
// canvas under `incomplete` rather than `violations`. Run it on demand with:
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
  settleAnimations,
  type LayoutReport,
} from "./auditRoutes";
// axe REFUSES to decide colour-contrast over a gradient — and this app's page
// canvas is a gradient, so every contrast result landed in `incomplete`, which
// this gate never read. See contrastResolve.ts for the whole story.
import {
  resolveIncompleteContrast,
  contrastFailures,
  contrastUnresolved,
  contrastVanished,
  describeContrast,
  type ResolvedContrast,
} from "./contrastResolve";
// The failures that are already written down. Turning the contrast check on
// reveals more than one change can fix; this is how that is recorded without
// anyone reaching for continue-on-error. See knownContrastFailures.ts.
import { classifyAgainstKnown, type ClassifiedFailure } from "./knownContrastFailures";

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
  /**
   * Colour-contrast results axe left in `incomplete` and we then decided
   * ourselves. `contrastChecked` is the count it declined to judge — if that
   * is non-zero and both buckets below are empty, the check RAN and passed,
   * which is the distinction the old gate could not make.
   */
  contrastChecked?: number;
  contrastFailures?: ResolvedContrast[];
  contrastUnresolved?: ResolvedContrast[];
  /** Elements that disappeared before we could score them (toasts). */
  contrastVanished?: ResolvedContrast[];
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

/**
 * `desktop-dark` was added 2026-09-02. Before it, the matrix ran dark mode at
 * exactly ONE width — 375 — so nothing dark-mode-specific above phone width
 * was ever looked at by anything. That is not a small hole: this app's desktop
 * layout is a different layout (the rail inset, the two-column hero, the wider
 * cards), and the single worst defect the last audit found — 35 screens — was
 * dark-mode-only. A matrix that varies theme at one width and width at one
 * theme cannot see anything that needs both.
 */
const ALL_VARIANTS: Variant[] = [
  { tag: "phone-light", width: 375, height: 812, theme: "light" },
  { tag: "phone-dark", width: 375, height: 812, theme: "dark" },
  { tag: "small-light", width: 320, height: 640, theme: "light" },
  { tag: "desktop-light", width: 1440, height: 900, theme: "light" },
  { tag: "desktop-dark", width: 1440, height: 900, theme: "dark" },
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

    // Suppress the onboarding tour, as home-chrome, overlay-sweep and
    // empty-state-sweep do. It mounts ONLY in Dashboard.tsx, on a 1.5s
    // post-load timer, and then fades in — and this sweep visits /dashboard as
    // an authed user (it is in the shared SCREENS list), so without this axe
    // can scan the overlay MID-FADE and report near-transparent text over
    // near-transparent background as a ~1.01:1 contrast failure that does not
    // exist. settleAnimations cannot save it: it counts from navigation start
    // and ends its opacity wait in `.catch(() => {})`, so under parallel load
    // it silently gives up. The tour is not what this sweep measures.
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          "helpr_onboarding",
          JSON.stringify({ completed: true, currentStep: 0, completedSteps: [], seen: true }),
        );
        localStorage.setItem("helpr.onboarding_tour_dismissed_at", new Date().toISOString());
      } catch { /* storage unavailable */ }
    });


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

    // Settle deferred overlays + fades before the screenshot and the axe scan,
    // so neither captures a half-faded dialog. See settleAnimations' note.
    await settleAnimations(page);

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

    // Decide what axe would not. `incomplete` is where a colour-contrast
    // result goes when axe cannot resolve the backdrop, and over a gradient
    // canvas that is EVERY result — so reading only `violations` reported
    // green on a check that never ran. resolveIncompleteContrast composites
    // the backdrop the text's own ancestors paint, scoring a gradient at its
    // worst stop; anything it still cannot decide comes back as unresolved and
    // fails the gate rather than vanishing.
    const contrast = await resolveIncompleteContrast(page, axe);
    result.contrastChecked = contrast.length;
    result.contrastFailures = contrastFailures(contrast);
    result.contrastUnresolved = contrastUnresolved(contrast);
    // Self-dismissing overlays vanish between axe's scan and ours. Recorded,
    // not failed — see contrastVanished.
    result.contrastVanished = contrastVanished(contrast);

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

  /**
   * THE GATE. Until 2026-08-17 this sweep recorded `totalViolations` and moved
   * on, so a real 1.92:1 contrast failure sat green in it for weeks — the run
   * was evidence dressed up as a check. It now fails.
   *
   * Why the assertion lives HERE rather than inside each screen's own test:
   * this describe is `mode: "serial"` (see the configure call above), and under
   * serial a failing test SKIPS every test after it. A per-screen `expect`
   * would therefore stop the sweep at the first bad screen, and the
   * a11y-report.json evidence — the whole reason this file exists — would be
   * truncated to whatever ran before it. Collecting every screen first and
   * asserting once at the end gives BOTH: a complete report on disk and a red
   * run that names every offending screen in one message.
   *
   * FOUR things fail the run:
   *   - any axe wcag2a/2aa/21a/21aa violation on any screen;
   *   - any screen that did not render at all. A screen that threw has
   *     `totalViolations: undefined`, which would otherwise slip past the
   *     violation check and count as clean — a hole big enough to hide a
   *     white-screening route in.
   *   - any NEW WCAG AA colour-contrast failure in the composited backdrop;
   *   - any RECORDED contrast failure that got worse, or that is recorded and
   *     no longer happens (see knownContrastFailures.ts — the list is only
   *     allowed to shrink);
   *   - any colour-contrast result nothing could decide.
   *
   * The last two were added 2026-09-02 and are not a refinement — they are the
   * check itself. axe never put a single colour-contrast result in
   * `violations` on this app: its page canvas is a gradient, so axe declines
   * and files EVERY contrast result under `incomplete`, which this gate did
   * not read. Measured on the built bundle: `/` reported 0 violations and 25
   * incomplete colour-contrast nodes. So for the whole life of this gate, the
   * one check its own workflow file is named after had never run, and reported
   * green. See contrastResolve.ts.
   *
   * If this is red, FIX THE SCREENS. Do not narrow the tag set or filter by
   * impact to get it green — a muted gate is the state this change was made to
   * get out of.
   */
  test("zz gate: every screen rendered and axe is clean", () => {
    // Sanity first: an empty/all-failed run means something fundamental
    // (preview server, route table) is broken, not that the app is clean.
    expect(results.some((r) => r.status === "ok"), "no screen rendered at all").toBe(true);

    const failedToRender = results
      .filter((r) => r.status !== "ok")
      .map((r) => `${r.index} ${r.name} (${r.variant}) — ${r.status}: ${r.error ?? "no error recorded"}`);

    const violating = results
      .filter((r) => (r.totalViolations ?? 0) > 0)
      .map((r) => {
        const detail = (r.topViolations ?? [])
          .map(
            (v) =>
              `${v.id}(${v.impact ?? "?"}, ${v.nodes} node(s), ${v.targets[0] ?? "?"})` +
              (v.detail.length ? ` [${v.detail[0]}]` : ""),
          )
          .join("; ");
        return `${r.index} ${r.name} (${r.variant}) @ ${r.url} — ${r.totalViolations} violation(s): ${detail}`;
      });

    expect(
      failedToRender,
      `screens that never rendered (so their axe result is meaningless):\n  - ${failedToRender.join("\n  - ")}`,
    ).toEqual([]);
    expect(
      violating,
      `axe wcag2a/2aa/21a/21aa violations (full report: /tmp/ui-review/a11y-report.json):\n  - ${violating.join("\n  - ")}`,
    ).toEqual([]);

    // Colour-contrast, which axe itself declined to judge on every screen with
    // a gradient behind it. These assertions are the difference between a gate
    // that checked contrast and a gate that skipped it and said nothing.
    const allContrast: ClassifiedFailure[] = results.flatMap((r) =>
      (r.contrastFailures ?? []).map((c) => ({
        screen: r.name,
        variant: r.variant ?? "?",
        text: c.text ?? "",
        ratio: c.ratio ?? 0,
        line: `${r.index} ${r.name} (${r.variant}) @ ${r.url} — ${describeContrast(c)}`,
      })),
    );
    const contrastUndecided = results.flatMap((r) =>
      (r.contrastUnresolved ?? []).map(
        (c) => `${r.index} ${r.name} (${r.variant}) @ ${r.url} — ${describeContrast(c)}`,
      ),
    );

    // Staleness is only judgeable for what this leg actually visited — the CI
    // matrix runs one variant per job, so every entry for the other variants
    // would otherwise read as stale on every leg.
    const swept = new Set(results.filter((r) => r.status === "ok").map((r) => `${r.name}|${r.variant}`));
    const contrast = classifyAgainstKnown(allContrast, swept);

    const vanished = results.flatMap((r) =>
      (r.contrastVanished ?? []).map(
        (c) => `${r.index} ${r.name} (${r.variant}) — ${describeContrast(c)}`,
      ),
    );
    if (vanished.length) {
      test.info().annotations.push({
        type: "contrast-not-measured",
        description:
          `${vanished.length} element(s) disappeared between axe's scan and ours — a ` +
          "self-dismissing overlay, most often a toast. NOT failed: there is no screen to " +
          "fix, the thing being scored no longer exists. It IS an acknowledged coverage " +
          `gap — short-lived text is not contrast-checked here:\n  - ${vanished.join("\n  - ")}`,
      });
    }

    if (contrast.allowed.length) {
      test.info().annotations.push({
        type: "known-contrast-failures",
        description:
          `${contrast.allowed.length} recorded, unfixed colour-contrast failure(s) — not new, ` +
          `not worse:\n  - ${contrast.allowed.join("\n  - ")}`,
      });
    }

    const contrastBroken = contrast.fresh.map((f) => f.line);

    expect(
      contrastBroken,
      "NEW WCAG AA colour-contrast failures, measured from the composited backdrop. " +
        "These are not in knownContrastFailures.ts, which means this change introduced them — " +
        `fix them, do not list them:\n  - ${contrastBroken.join("\n  - ")}`,
    ).toEqual([]);
    expect(
      contrast.regressed,
      "Recorded colour-contrast failures that got WORSE. The number in " +
        `knownContrastFailures.ts is a ceiling, not a pass:\n  - ${contrast.regressed.join("\n  - ")}`,
    ).toEqual([]);
    expect(
      contrast.stale,
      "Stale entries in knownContrastFailures.ts — recorded but not seen on a screen this run " +
        "DID sweep. The list is only allowed to shrink, so a fixed entry has to be deleted:\n  - " +
        contrast.stale.join("\n  - "),
    ).toEqual([]);
    expect(
      contrastUndecided,
      "colour-contrast results NOTHING could decide — neither axe nor the pixel/ancestor " +
        "resolver. An undecided check is not a passing check; look at each of these by hand " +
        `and either fix the screen or make the backdrop measurable:\n  - ${contrastUndecided.join("\n  - ")}`,
    ).toEqual([]);
  });
});
