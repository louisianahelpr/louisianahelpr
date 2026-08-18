// ERROR-STATE + LOADING-STATE sweep — the second whole category of screen the
// harness could not see.
//
// WHY
// ---
// Every Supabase mock in ./fixtures answers HTTP 200. The seeded sweep answers
// 200-with-rows, the empty-state sweep answers 200-with-[]. Both are the
// SUCCESS path. So in the entire history of this harness:
//
//   - no "we couldn't load this" screen has ever rendered,
//   - <RouteErrorBoundary> / <SectionBoundary> have never caught anything,
//   - <ErrorState> has never mounted,
//   - no loading skeleton has ever been photographed or measured.
//
// That matters more here than in most codebases, because CLAUDE.md carries a
// standing rule — "Never drop the Supabase `error`" — whose failure mode is
// precisely a BLANK SCREEN: `const { data } = await supabase…` throws the error
// half away, `data` is null, the list renders nothing, and the user is looking
// at a white panel with no explanation. `unwrap()` (src/lib/supabaseResult.ts)
// exists to prevent exactly that. Nothing in CI has ever proven it is used.
//
// WHAT IT DOES
// ------------
// Same route catalog as the other two sweeps (imported from ./auditRoutes, so
// the three cannot drift), run in two MODES:
//
//   error   — every non-exempt table SELECT and every RPC answers HTTP 500
//             with a PostgREST-shaped error body. Asserts each route renders a
//             LEGIBLE failure, not a blank page and not a crash.
//   loading — the same requests are held open past the measurement point, so
//             the PENDING render tree (skeletons, spinners, suspense
//             fallbacks) is what gets measured. Asserts the pending state is
//             itself a real screen: titled, single-h1, non-overflowing,
//             accessible, and not blank.
//
// WHAT IS DELIBERATELY *NOT* FAILED, AND WHY
// ------------------------------------------
// `profiles` and `user_roles` keep answering 200. This is a real coverage gap
// and it is a deliberate trade:
//
//   ProtectedRoute reads the current user's profile to run the "Big 7"
//   completeness gate. Fail that read and every authed route lands on the same
//   recoverable-error screen (ProtectedRoute.tsx: `if (isError && !profile)`),
//   so the sweep would audit ONE screen ~120 times and learn nothing about the
//   other 60 routes. `user_roles` is exempt for the same reason at the admin
//   route — fail it and AdminRoute bounces to /dashboard.
//
// So what this sweep models is: "you are signed in, your account loaded, and
// then THIS PAGE's data failed / is still in flight". The session-level failure
// (profile fetch itself dies) is NOT covered here. Say so rather than claiming
// the sweep covers error handling generally — auditRoutes.ts already carries a
// note about how a flattering coverage number is worse than no number.
//
// CONSOLE FILTERING — the important subtlety
// ------------------------------------------
// A 500 legitimately produces console noise: the browser logs "Failed to load
// resource", and the app's own error paths log the message. Filtering by
// message *shape* would also hide real bugs. Instead the injected error body
// carries a sentinel string (INJECTED_SENTINEL) and only lines containing that
// sentinel — plus the browser's own resource-load line for the mocked origin —
// are treated as deliberate. Anything else (an uncaught TypeError from
// destructuring a null `data`, say) is a genuine finding and fails the screen.
// That is the single highest-value defect this file is built to catch.
//
// RUNNING IT
// ----------
//   kill $(lsof -ti:4173) 2>/dev/null; sleep 2
//   RUN_ERROR_SWEEP=1 PLAYWRIGHT_WEB_SERVER=1 \
//     npx playwright test --project=happy-path error-state-sweep
//
// The kill is not optional — playwright.config.ts sets
// `reuseExistingServer: !CI`, so a preview server already on 4173 is reused and
// `npm run build` never runs; you then measure a STALE dist/. If a result
// surprises you, kill and re-run BEFORE forming a theory.
//
// Env knobs:
//   ERROR_SWEEP_MODES=error        → skip the loading pass (halves wall clock)
//   ERROR_SWEEP_MODES=loading      → skip the error pass
//   ERROR_SWEEP_VARIANTS=all       → phone-light + phone-dark + 320 + desktop
//   ERROR_SWEEP_VARIANTS=desktop-light,small-light  → a comma list
//   ERROR_SWEEP_ROLES=customer     → skip the helper pass
//
// Opt-in via RUN_ERROR_SWEEP, matching the other two sweeps: it is a NEW gate
// over a surface that has never been gated, and turning it on before its
// findings are closed would just red main.

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
  type MockSupabaseOptions,
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

type MockRules = NonNullable<MockSupabaseOptions["rules"]>;

const OUTPUT_DIR = "/tmp/ui-review-error";
const SCREEN_DIR = resolve(OUTPUT_DIR, "screens");
mkdirSync(SCREEN_DIR, { recursive: true });

/**
 * Marker carried in the injected PostgREST error body.
 *
 * Everything the app logs about a failure it was TOLD about will contain this
 * string (supabase-js surfaces `error.message` verbatim, and the codebase logs
 * `error.message` / `String(error)`). So "console line contains the sentinel"
 * is a precise test for "this noise is the failure we asked for", and lets
 * every other console error stay a hard finding instead of being pattern-muted.
 */
const INJECTED_SENTINEL = "E2E_INJECTED_FAILURE";

/**
 * Tables that keep answering 200 in BOTH modes. See the header — failing these
 * collapses the whole authed surface onto one gate screen and destroys the
 * sweep's coverage.
 */
const EXEMPT_TABLES = new Set(["profiles", "user_roles"]);

/** Is this REST request one the sweep is allowed to break? */
function isTargetRestCall(pathname: string, method: string): boolean {
  if (!pathname.startsWith("/rest/v1/")) return false;
  const table = pathname.replace("/rest/v1/", "").split("/")[0] ?? "";
  if (table === "rpc") return method === "POST";
  if (EXEMPT_TABLES.has(table)) return false;
  return method === "GET";
}

/**
 * A rule that answers every targetable read with a PostgREST-shaped 500.
 *
 * Shape matters: supabase-js parses the body and hands the app
 * `{ code, message, details, hint }`. A bare `{ error: "boom" }` would come
 * back with an undefined `message`, and half the app's error copy would render
 * "undefined" — a fixture artefact that looks exactly like an app bug.
 */
function injectedFailureRule(): MockRules[number] {
  return {
    match: (url, method) => isTargetRestCall(url.pathname, method),
    handle: () => ({
      status: 500,
      body: {
        code: "XX000",
        message: `${INJECTED_SENTINEL}: simulated query failure`,
        details: null,
        hint: null,
      },
    }),
  };
}

/**
 * Hold every targetable read open so the PENDING tree is what gets measured.
 *
 * Registered AFTER installSupabaseMocks so it runs first (Playwright resolves
 * handlers most-recent-first) and hands off with `route.fallback()` once the
 * measurement is done — the request still completes normally, it is just late.
 *
 * The `release` flag exists so teardown is not hostage to the delay: sleeping a
 * flat 20s in the handler would add 20s of context-close time to every single
 * loading test. The caller flips it the moment the page has been measured.
 */
function installLoadingDelay(page: Page, gate: { released: boolean }, maxMs = 20_000): Promise<void> {
  return page.route(
    (url) => isTargetRestCall(url.pathname, "GET") || isTargetRestCall(url.pathname, "POST"),
    async (route) => {
      const method = route.request().method();
      if (!isTargetRestCall(new URL(route.request().url()).pathname, method)) {
        return route.fallback();
      }
      const deadline = Date.now() + maxMs;
      while (!gate.released && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 120));
      }
      return route.fallback();
    },
  );
}

interface AxeSummary {
  id: string;
  impact: string | null;
  help: string;
  nodes: number;
  targets: string[];
  detail: string[];
}

/** Signals that a screen is showing SOMETHING structural, even with no copy. */
interface RenderProbe {
  /** Visible element count inside #main-content. */
  mainNodeCount: number;
  /** Visible nodes running a shimmer/pulse animation, or marked aria-busy/role=status. */
  skeletonCount: number;
  /** Does the visible main copy name a failure at all? */
  hasErrorVocabulary: boolean;
  /** Is there a visible control offering a way out (retry / reload / go back)? */
  hasRecoveryControl: boolean;
}

interface ScreenResult {
  index: number;
  name: string;
  url: string;
  landedOn?: string;
  auth: "anon" | "authed";
  role?: string;
  variant: string;
  mode: SweepMode;
  status: "ok" | "findings" | "error";
  findings: string[];
  /** How many injected 500s this screen actually received. 0 ⇒ nothing to fail. */
  injectedFailures: number;
  layout?: LayoutReport;
  probe?: RenderProbe;
  axe?: AxeSummary[];
  screenshot?: string;
  error?: string;
  notes?: string;
}

type SweepMode = "error" | "loading";

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

const VARIANTS: Variant[] = (() => {
  const want = process.env.ERROR_SWEEP_VARIANTS;
  if (!want) return [ALL_VARIANTS[0]];
  if (want === "all") return ALL_VARIANTS;
  const tags = want.split(",").map((t) => t.trim());
  const picked = ALL_VARIANTS.filter((v) => tags.includes(v.tag));
  if (!picked.length) throw new Error(`ERROR_SWEEP_VARIANTS=${want} matched no variant tag`);
  return picked;
})();

const MODES: SweepMode[] = (() => {
  const want = process.env.ERROR_SWEEP_MODES;
  if (!want) return ["error", "loading"];
  const picked = want
    .split(",")
    .map((m) => m.trim())
    .filter((m): m is SweepMode => m === "error" || m === "loading");
  if (!picked.length) throw new Error(`ERROR_SWEEP_MODES=${want} matched no mode`);
  return picked;
})();

/** See empty-state-sweep: the bar is "says SOMETHING", not "is well written". */
const MIN_MAIN_TEXT = 20;

const HARNESS_NOISE = [
  /Service Worker registration blocked by Playwright/i,
  /Download the React DevTools/i,
  /\[vite\] connect/i,
];

/**
 * Console lines that the INJECTED failure is entitled to produce.
 *
 * Only two shapes qualify: the browser's own resource-load line for a request
 * we deliberately 500'd, and anything echoing the sentinel. Everything else —
 * including a React "Cannot read properties of null" — stays a finding.
 */
function isDeliberateFailureNoise(text: string): boolean {
  if (text.includes(INJECTED_SENTINEL)) return true;
  // Chromium logs the network failure itself; it names the URL, not our body.
  if (/Failed to load resource.*status of 500/i.test(text)) return true;
  // Loading mode tears down with requests still in flight.
  if (/net::ERR_ABORTED|net::ERR_FAILED/i.test(text)) return true;
  return false;
}

// NOTE: the error/recovery vocabularies are written INLINE inside
// probeRender's page.evaluate below. They cannot be hoisted to a module const
// — evaluate() serialises the function and runs it in the browser, where a
// closed-over module binding does not exist.
async function probeRender(page: Page): Promise<RenderProbe> {
  return page.evaluate(() => {
    const vis = (e: Element) => {
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(e);
      return cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0.05;
    };
    const main = document.querySelector<HTMLElement>("#main-content");
    const scope: ParentNode = main ?? document.body;
    const all = Array.from(scope.querySelectorAll("*")).filter(vis);

    // The Skeleton primitive (src/components/ui/skeleton.tsx) animates its
    // ::after pseudo-element with `shimmer`, so the animation is invisible to a
    // plain getComputedStyle(el) read — it has to be sampled on the pseudo.
    const isSkeleton = (e: Element) => {
      if (e.getAttribute("aria-busy") === "true") return true;
      if (e.getAttribute("role") === "status") return true;
      const own = getComputedStyle(e).animationName;
      if (/shimmer|pulse|spin/i.test(own)) return true;
      const after = getComputedStyle(e, "::after").animationName;
      return /shimmer|pulse/i.test(after);
    };

    const text = (main?.innerText ?? "").replace(/\s+/g, " ").trim();
    const controls = Array.from(
      scope.querySelectorAll("button, a[href], [role=button]"),
    ).filter(vis);

    return {
      mainNodeCount: all.length,
      skeletonCount: all.filter(isSkeleton).length,
      hasErrorVocabulary:
        /(couldn'?t|could not|unable to|failed to|went wrong|try again|retry|problem|error|unavailable|not available|offline|refresh)/i.test(
          text,
        ),
      hasRecoveryControl: controls.some((c) =>
        /(try again|retry|reload|refresh|go home|go back|start over)/i.test(
          `${(c.textContent ?? "").trim()} ${c.getAttribute("aria-label") ?? ""}`,
        ),
      ),
    };
  });
}

/**
 * Load a screen with its data broken (or held), and collect every invariant it
 * breaks. Never throws for a finding — findings are data; only an
 * infrastructure failure sets status "error".
 */
async function auditFailingScreen(
  page: Page,
  meta: Omit<ScreenResult, "status" | "findings" | "injectedFailures">,
  variant: Variant,
  mode: SweepMode,
  gate: { released: boolean },
  extraSetup?: (page: Page) => Promise<void>,
): Promise<ScreenResult> {
  const result: ScreenResult = { ...meta, status: "ok", findings: [], injectedFailures: 0 };

  const consoleIssues: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const text = m.text();
    if (HARNESS_NOISE.some((rx) => rx.test(text))) return;
    if (isDeliberateFailureNoise(text)) return;
    consoleIssues.push(`${m.type()}: ${text.slice(0, 140)}`);
  });
  page.on("pageerror", (e) => {
    const msg = String(e.message);
    if (isDeliberateFailureNoise(msg)) return;
    consoleIssues.push(`uncaught: ${msg.slice(0, 140)}`);
  });
  page.on("response", (r) => {
    if (r.status() === 500 && r.url().includes("/rest/v1/")) result.injectedFailures += 1;
  });
  // In loading mode nothing ever 500s, so count what is still in flight
  // instead — a screen with zero pending requests is not actually testing a
  // pending state and should not be credited as if it were.
  const pending = new Set<string>();
  page.on("request", (r) => {
    if (r.url().includes("/rest/v1/")) pending.add(r.url());
  });
  page.on("requestfinished", (r) => pending.delete(r.url()));
  page.on("requestfailed", (r) => pending.delete(r.url()));

  try {
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await page.addInitScript((theme) => {
      const set = () => document.documentElement?.setAttribute("data-theme", theme);
      if (document.documentElement) set();
      else document.addEventListener("DOMContentLoaded", set, { once: true });
    }, variant.theme);

    await page.goto(meta.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.evaluate((theme) => {
      document.documentElement.setAttribute("data-theme", theme);
    }, variant.theme);

    if (mode === "error") {
      await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {
        result.notes = (result.notes ?? "") + "networkidle-timeout;";
      });
    } else {
      // networkidle can never arrive while requests are deliberately held, so
      // wait a fixed beat for the shell + lazy chunk instead.
      await page.waitForTimeout(1_200);
    }
    await page
      .evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready ?? Promise.resolve())
      .catch(() => undefined);
    await page.waitForTimeout(600);

    if (extraSetup) {
      await extraSetup(page).catch(() => undefined);
      if (mode === "error") {
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      }
      await page.waitForTimeout(400);
    }

    const landed = new URL(page.url());
    result.landedOn = `${landed.pathname}${landed.search}`;

    // Deferred overlays fade in on a 1.5s timer; axe sampling mid-fade invents
    // contrast failures (see settleAnimations). Infinite shimmer/pulse
    // animations are excluded there, so a skeleton screen does not hang here.
    await settleAnimations(page);

    if (mode === "loading") result.notes = (result.notes ?? "") + `pending=${pending.size};`;

    const layout = await measureLayout(page);
    layout.consoleIssues = [...new Set(consoleIssues)].slice(0, 8);
    result.layout = layout;
    result.probe = await probeRender(page);

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
        // Take axe's own composited numbers — re-deriving contrast by hand is
        // where these audits invent failures that do not exist.
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
    const probe = result.probe;

    if (layout.h1Count !== 1) {
      f.push(
        `H1_COUNT: expected exactly 1 <h1>, found ${layout.h1Count}` +
          (layout.h1Texts.length ? ` [${layout.h1Texts.join(" | ")}]` : ""),
      );
    }
    if (!layout.documentTitle.trim()) f.push("DOC_TITLE: document.title is empty");
    if (layout.overflowPx > 0) {
      f.push(`H_OVERFLOW: documentElement.scrollWidth - clientWidth = ${layout.overflowPx}px`);
    }
    if (layout.overflowOffenders.length) {
      f.push(
        `WIDE_ELEMENT: wider than the ${variant.width}px viewport — ${layout.overflowOffenders.join("; ")}`,
      );
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

    if (mode === "error") {
      // The headline check. A failed query must not leave a white panel.
      // `skeletonCount` is reported alongside because the two ways a screen
      // fails this check need different fixes: 0 skeletons is a genuinely
      // empty panel, while a non-zero count means the page is STUCK in its
      // pending render — the query has permanently failed and the user is
      // watching a shimmer that will never resolve.
      if (layout.mainTextLength < MIN_MAIN_TEXT) {
        f.push(
          `BLANK_SCREEN: <main> renders ${layout.mainTextLength} visible chars ` +
            `(min ${MIN_MAIN_TEXT}) after ${result.injectedFailures} failed request(s)` +
            (probe.skeletonCount
              ? ` — STUCK IN LOADING: ${probe.skeletonCount} skeleton node(s) still shimmering`
              : "") +
            ` — sample: "${layout.mainTextSample}"`,
        );
      } else if (result.injectedFailures > 0 && !probe.hasErrorVocabulary && !probe.hasRecoveryControl) {
        // Content rendered, but nothing on it names the failure and there is no
        // way out. That is the "silent empty state" case: the screen quietly
        // claims the user has no data when in truth the fetch died.
        f.push(
          `SILENT_FAILURE: ${result.injectedFailures} request(s) failed but <main> shows no ` +
            `failure wording and no retry/reload control` +
            (probe.skeletonCount ? ` (${probe.skeletonCount} skeleton node(s) still shimmering)` : "") +
            ` — sample: "${layout.mainTextSample}"`,
        );
      }
    } else {
      // Loading: the pending tree must be a real screen, not a void. Text OR
      // skeletons count — a well-built skeleton has no copy at all, so
      // requiring text here would be wrong.
      if (layout.mainTextLength < MIN_MAIN_TEXT && probe.skeletonCount === 0 && probe.mainNodeCount < 3) {
        f.push(
          `BLANK_LOADING: <main> renders ${layout.mainTextLength} visible chars, ` +
            `${probe.skeletonCount} skeleton node(s), ${probe.mainNodeCount} visible node(s) ` +
            `while ${pending.size} request(s) are still in flight`,
        );
      }
    }

    if (f.length) {
      result.status = "findings";
      const slug = `${String(meta.index).padStart(3, "0")}-${meta.name}-${mode}-${variant.tag}`.replace(
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
  } finally {
    // Let every held request through so teardown is instant.
    gate.released = true;
  }

  writeScreenReport(result);
  return result;
}

/**
 * One JSON file per screen rather than one shared array — this spec runs in
 * PARALLEL worker PROCESSES, and a module-level array would give each worker
 * its own copy, with the last writer silently winning. See empty-state-sweep.
 */
function writeScreenReport(r: ScreenResult): void {
  const slug = `${String(r.index).padStart(3, "0")}-${r.name}-${r.mode}-${r.variant}`.replace(
    /[^a-z0-9-]+/gi,
    "-",
  );
  writeFileSync(resolve(SCREEN_DIR, `${slug}.json`), JSON.stringify(r, null, 2));
}

function assertClean(r: ScreenResult): void {
  if (r.status === "error") {
    throw new Error(`${r.name} (${r.mode}/${r.variant}) failed to load: ${r.error}`);
  }
  expect(
    r.findings,
    `${r.name} @ ${r.url} (landed ${r.landedOn}, ${r.mode}/${r.variant}, ` +
      `${r.injectedFailures} injected failure(s)) — findings:\n  - ${r.findings.join("\n  - ")}`,
  ).toEqual([]);
}

const sweepDescribe = process.env.RUN_ERROR_SWEEP ? test.describe : test.describe.skip;

const ROLES = (
  [
    { tag: "customer", user: FAKE_CUSTOMER },
    { tag: "helper", user: FAKE_HELPER },
  ] as const
).filter((r) => !process.env.ERROR_SWEEP_ROLES || process.env.ERROR_SWEEP_ROLES.includes(r.tag));

/**
 * Collapse rows that render identically once their data is broken.
 *
 * `seededOnly` rows exist to exercise six different `job_status` branches; with
 * every read failing they are one screen, six times. Likewise the catalog holds
 * several entries that differ ONLY by their per-screen `rules` (the
 * `business-*-owned` / `-unverified` pairs) — those rules feed tables this
 * sweep is breaking, so both members of each pair render the same failure. The
 * de-dup key is url + whether the row drives the page after load, which is the
 * only remaining thing that can make two rows differ here.
 *
 * This is a coverage REDUCTION and it is stated plainly: /business/team is
 * audited once in this sweep, not three times.
 */
function distinctScreens(list: ScreenSpec[]): ScreenSpec[] {
  const seen = new Set<string>();
  return list
    .filter((s) => !s.seededOnly)
    .filter((s) => {
      const key = `${s.url}::${s.extraSetup ? "setup" : ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Rules handed to the mock, injected-failure rule FIRST so it wins. */
function rulesFor(mode: SweepMode, screen: ScreenSpec): MockRules {
  const own = screen.rules ?? [];
  // In loading mode nothing is rewritten — the delay handler does the work —
  // so per-screen rules keep their normal meaning.
  return mode === "error" ? [injectedFailureRule(), ...own] : own;
}

sweepDescribe("error + loading state sweep", () => {
  // Full SPA boot + settle + axe per screen; loading mode adds its hold time.
  test.setTimeout(90_000);

  let index = 0;

  for (const mode of MODES) {
    for (const v of VARIANTS) {
      for (const screen of distinctScreens(ANON_SCREENS)) {
        const i = ++index;
        test(`${String(i).padStart(3, "0")} ${screen.name} (anon/${v.tag}) [${mode}]`, async ({ page }) => {
          const gate = { released: false };
          await installSupabaseMocks(page, { seed: mode === "loading", rules: rulesFor(mode, screen) });
          if (mode === "loading") await installLoadingDelay(page, gate);
          const r = await auditFailingScreen(
            page,
            { index: i, name: screen.name, url: screen.url, auth: "anon", variant: v.tag, mode },
            v,
            mode,
            gate,
            screen.extraSetup,
          );
          assertClean(r);
        });
      }

      for (const role of ROLES) {
        for (const screen of distinctScreens(AUTHED_SCREENS)) {
          const i = ++index;
          const name = `${role.tag}-${screen.name}`;
          test(`${String(i).padStart(3, "0")} ${name} (${role.tag}/${v.tag}) [${mode}]`, async ({
            context,
            page,
            baseURL,
          }) => {
            const gate = { released: false };
            await seedAuthedSession(context, role.user, baseURL ?? "");
            await installSupabaseMocks(page, {
              user: role.user,
              seed: mode === "loading",
              rules: rulesFor(mode, screen),
            });
            if (mode === "loading") await installLoadingDelay(page, gate);
            const r = await auditFailingScreen(
              page,
              {
                index: i,
                name,
                url: screen.url,
                auth: "authed",
                role: role.tag,
                variant: v.tag,
                mode,
              },
              v,
              mode,
              gate,
              screen.extraSetup,
            );
            assertClean(r);
          });
        }
      }

      for (const screen of ADMIN_SCREENS) {
        const i = ++index;
        test(`${String(i).padStart(3, "0")} ${screen.name} (admin/${v.tag}) [${mode}]`, async ({
          context,
          page,
          baseURL,
        }) => {
          const gate = { released: false };
          await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
          await installSupabaseMocks(page, {
            user: FAKE_CUSTOMER,
            seed: mode === "loading",
            rules: rulesFor(mode, screen),
          });
          if (mode === "loading") await installLoadingDelay(page, gate);
          const r = await auditFailingScreen(
            page,
            {
              index: i,
              name: screen.name,
              url: screen.url,
              auth: "authed",
              role: "admin",
              variant: v.tag,
              mode,
            },
            v,
            mode,
            gate,
            screen.extraSetup,
          );
          assertClean(r);
        });
      }
    }
  }
});
