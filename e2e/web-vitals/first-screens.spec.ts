/**
 * EVERY FIRST SCREEN, MEASURED THE WAY SPEED INSIGHTS MEASURES REAL USERS
 * (docs/OPEN.md Q1157, Q1158, Q652; owner 2026-10-03: "all measurements from
 * Vercel need to be great").
 *
 * Vercel Speed Insights reports P75 of real users per route; GOOD is LCP <= 2.5
 * s, FCP <= 1.8 s, CLS <= 0.1. Real users are not an unthrottled CI runner, so
 * this measures under the two device profiles Lighthouse uses
 * (scripts/perf/cwv-lab.mjs: `mobile` = 375, Slow 4G + 4x CPU calibrated to
 * the reference machine; `desktop` = 1440, 40 ms / 10 Mbps), on THIS commit's
 * build served the way Vercel serves it (HTTP/2, brotli, immutable assets),
 * against prod data: public screens as a guest, the rest as the shared poster
 * account. Never mocked.
 *
 * The first screens are the app's own list, never a hand list: the keys of
 * ENTRY_ROUTE_CHUNKS in src/boot/routePreload.ts, the routes a cold load can
 * land on with its page chunk started beside the app.
 *
 * TWO CHECKS, each one a class:
 *
 *  1. FCP AND LCP INSIDE THE GOOD BAND, per route and profile (median of
 *     RUNS cold loads), CLS inside 0.1, or inside the screen's KNOWN ceiling
 *     while it is not there yet. KNOWN is exact and two-way: a screen over its
 *     ceiling has regressed; a screen inside GOOD, or well under its ceiling,
 *     must have its entry deleted or lowered in the same commit. (Content
 *     behind an opacity-0 fade is invisible to FCP/LCP however fast it paints:
 *     Q1158, /home at 375 drew its title bar at 4.4 s and reported FCP at 5.3
 *     s. That class has its own static guard, pageEntranceNotFromZero.test.ts;
 *     here it shows as FCP over the ceiling.)
 *  2. A TAP NEVER LEADS TO A JUMP. Speed Insights reports CLS once, when the
 *     tab is hidden, for the whole session, against the route on screen THEN
 *     (read in /_vercel/speed-insights/script.js: CLS is the worst session
 *     window of every shift since the hard load, pushed on `visibilitychange`
 *     with the current `data-route`). So a jump on any page reached by a tap
 *     is billed to wherever the visitor closed the tab: the 0.33 Speed
 *     Insights billed to /jobs reproduces on the 2026-09-28 build as
 *     Profile -> Earnings -> Jobs, session CLS 0.214 from the Earnings tab's
 *     connect card (fixed 2026-10-01 in 2fd57dce1; 0.0001 now). page-settle
 *     measures cold loads only; this walks the dock / rail as a person does.
 *
 * Proven red: on the 2026-09-28 build the walk fails (Earnings hop 0.214), and
 * on the pre-Q1158 build check 1 fails for /home at 375 (FCP over its ceiling:
 * the page fade started at opacity 0).
 */
// @mutate src/components/profile/EarningsTab.tsx | const pageReady = useArrivalGate(!loading && stripeSettled, streakState.settled); | const pageReady = true;
// @mutate tailwind.config.ts | from: { opacity: "0.01", transform: "translateY(8px)" }, | from: { opacity: "0", transform: "translateY(8px)" },
import { test, expect } from "../prodTest";
import type { Browser, BrowserContext } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSession, AUTH_STORAGE_KEY, type Session } from "../journeys/fixtures";
import {
  PROFILES, GOOD, CWV_INIT, readCwv, settle, sessionInit, cpuBenchmarkMs, calibratedCpuRate,
  applyThrottle, startDistServer, clsOf, type LabProfile, type CwvReading,
} from "../../scripts/perf/cwv-lab.mjs";

// Playwright runs from the repo root (as every prod-audit spec assumes).
const ROOT = process.cwd();
// WEB_VITALS_DIST: measure another build (the red proofs ran this against the
// pre-fix and the 2026-09-28 builds). CI always measures this commit's dist/.
const DIST = process.env.WEB_VITALS_DIST || join(ROOT, "dist");
const PORT = 4394;
const BASE = `https://127.0.0.1:${PORT}`;
/** Cold loads per screen and profile; the median is judged. */
const RUNS = 3;
/** A tap's own jump (page-settle's cold-load budget) and the session's (Speed Insights' GOOD). */
const WALK_HOP_CLS = 0.02;
const WALK = ["Posts", "Jobs", "Messages", "Profile", "@Earnings", "Jobs", "Home"] as const;

type ProfileName = "mobile" | "desktop";
type Metric = "fcp" | "lcp";

/**
 * `${profile} ${route} ${metric}` -> the lab ceiling (ms) while that screen is
 * not inside the GOOD band yet, with what it measured. Exact, two-way: over
 * the ceiling is a regression; inside GOOD, or under CEILING_STALE of the
 * ceiling, means delete or lower the entry in the same commit.
 *
 * Every desktop first screen is inside GOOD (FCP 0.48-0.75 s, LCP 0.48-1.06 s),
 * so desktop has no entry. No mobile screen is: under Slow 4G + 4x CPU each
 * waits ~3.5-4.4 s for its JavaScript before its first draw (Q1158, Q1170-Q1173
 * name what is left). Ceilings are the measured median x1.08, measured
 * 2026-10-03 on this commit (local build, prod data, calibrated CPU 3.64x;
 * run-to-run spread on unchanged screens was within 4%).
 */
// @two-way e2e/web-vitals/first-screens.spec.ts:KNOWN entries now inside GOOD or far under their ceiling: delete or lower them
const KNOWN: Record<string, { ceiling: number; measured: number }> = {
  "mobile / fcp": { ceiling: 3980, measured: 3684 },
  "mobile / lcp": { ceiling: 3980, measured: 3684 },
  "mobile /browse fcp": { ceiling: 4630, measured: 4280 },
  "mobile /browse lcp": { ceiling: 4650, measured: 4300 },
  "mobile /login fcp": { ceiling: 3960, measured: 3664 },
  "mobile /login lcp": { ceiling: 3960, measured: 3664 },
  "mobile /signup fcp": { ceiling: 4170, measured: 3860 },
  "mobile /signup lcp": { ceiling: 4170, measured: 3860 },
  "mobile /home fcp": { ceiling: 4970, measured: 4600 },
  "mobile /home lcp": { ceiling: 6610, measured: 6120 },
  "mobile /messages fcp": { ceiling: 4830, measured: 4464 },
  "mobile /messages lcp": { ceiling: 4830, measured: 4464 },
  "mobile /jobs fcp": { ceiling: 4230, measured: 3916 },
  "mobile /jobs lcp": { ceiling: 5180, measured: 4796 },
  "mobile /posts fcp": { ceiling: 4220, measured: 3904 },
  "mobile /posts lcp": { ceiling: 5920, measured: 5476 },
  "mobile /post-job fcp": { ceiling: 4770, measured: 4412 },
  "mobile /post-job lcp": { ceiling: 5680, measured: 5252 },
  "mobile /profile fcp": { ceiling: 5380, measured: 4976 },
  "mobile /profile lcp": { ceiling: 6210, measured: 5744 },
};
/** Under this fraction of its ceiling a KNOWN entry is stale (the screen got faster: lower it). */
const CEILING_STALE = 0.8;

interface Screen { path: string; signedIn: boolean }

/** The first screens: ENTRY_ROUTE_CHUNKS' keys; public when its guest list starts a page chunk. */
function firstScreens(): Screen[] {
  const src = readFileSync(join(ROOT, "src/boot/routePreload.ts"), "utf8");
  const block = src.slice(src.indexOf("export const ENTRY_ROUTE_CHUNKS"));
  const out: Screen[] = [];
  for (const m of block.matchAll(/^ {2}"(\/[^"]*)": \{\n\s*guest: \[([^\]]*)\]/gm)) {
    out.push({ path: m[1], signedIn: !/import\(/.test(m[2]) });
  }
  return out;
}

const median = (xs: (number | null)[]) => {
  const s = xs.filter((x): x is number => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

async function labContext(browser: Browser, profile: LabProfile, session: Session | null): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    colorScheme: "light",
    serviceWorkers: "block",
    // The lab server's certificate is self-signed. HTTP/2 needs TLS, and HTTP/1.1
    // queues 26+ chunks six at a time, a cost prod (HTTP/2 on Vercel) never pays.
    ignoreHTTPSErrors: true,
  });
  await ctx.addInitScript(CWV_INIT);
  if (session) await ctx.addInitScript(...sessionInit({ key: AUTH_STORAGE_KEY, value: JSON.stringify(session) }));
  return ctx;
}

let server: { close: () => void } | null = null;

test.beforeAll(async () => {
  if (!existsSync(join(DIST, "index.html"))) {
    throw new Error(`no ${DIST}/index.html: this measures THIS commit's build, so build it first (npm run build)`);
  }
  server = await startDistServer(DIST, PORT);
});

test.afterAll(() => {
  server?.close();
});

test("every first screen: FCP/LCP in the GOOD band (or its KNOWN ceiling), CLS <= 0.1", async ({ browser, request }) => {
  test.setTimeout(45 * 60_000);
  const screens = firstScreens();
  // Floor: ten entries when this landed. Far fewer means the parser broke.
  expect(screens.length).toBeGreaterThan(7);
  expect(screens.filter((s) => !s.signedIn).map((s) => s.path)).toEqual(expect.arrayContaining(["/", "/login"]));

  const session = await getSession(request, "poster");
  const rate = calibratedCpuRate(PROFILES.mobile.cpu, await cpuBenchmarkMs(browser));
  console.log(`[web-vitals] mobile CPU throttle ${rate}x (calibrated to the reference machine)`);

  const results: Record<string, { fcp: number | null; lcp: number | null; cls: number; lcpEl: string | null; landed: string[]; runs: string[] }> = {};
  for (const profileName of ["mobile", "desktop"] as ProfileName[]) {
    const profile = PROFILES[profileName];
    for (const screen of screens) {
      const runs: (CwvReading & { landed: string })[] = [];
      for (let i = 0; i < RUNS; i++) {
        const ctx = await labContext(browser, profile, screen.signedIn ? session : null);
        const page = await ctx.newPage();
        await applyThrottle(ctx, page, profile, "chromium", profileName === "mobile" ? rate : 1);
        await page.goto(BASE + screen.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await settle(page, profileName === "mobile" ? { quietMs: 4000, maxMs: 45_000 } : { quietMs: 2500, maxMs: 20_000 });
        runs.push({ ...(await readCwv(page)), landed: new URL(page.url()).pathname });
        await ctx.close();
      }
      const key = `${profileName} ${screen.path}`;
      results[key] = {
        fcp: median(runs.map((r) => r.fcp)),
        lcp: median(runs.map((r) => r.lcp)),
        cls: Math.max(...runs.map((r) => r.cls)),
        lcpEl: runs[runs.length - 1].lcpEl,
        landed: [...new Set(runs.map((r) => r.landed))],
        runs: runs.map((r) => `FCP ${r.fcp} LCP ${r.lcp} drawn ${r.marks.appDrawn}`),
      };
      const r = results[key];
      console.log(`[web-vitals] ${key.padEnd(18)} FCP ${r.fcp} LCP ${r.lcp} CLS ${r.cls}  ${(r.lcpEl ?? "").slice(0, 70)}  [${r.runs.join(" | ")}]`);
    }
  }
  await test.info().attach("web-vitals.json", { body: JSON.stringify(results, null, 2), contentType: "application/json" });

  const fails: string[] = [];
  const stale: string[] = [];
  for (const [key, r] of Object.entries(results)) {
    const path = key.split(" ")[1];
    // A load that landed elsewhere measured a different page.
    if (r.landed.length !== 1 || r.landed[0] !== path) fails.push(`${key}: landed on ${r.landed.join(", ")}, not ${path}`);
    if (r.cls > GOOD.cls) fails.push(`${key}: CLS ${r.cls} > ${GOOD.cls}`);
    const bars: Record<Metric, number> = { fcp: GOOD.fcp, lcp: GOOD.lcp };
    for (const metric of ["fcp", "lcp"] as Metric[]) {
      const v = r[metric];
      if (v == null) { fails.push(`${key}: no ${metric} recorded`); continue; }
      const known = KNOWN[`${key} ${metric}`];
      if (!known) {
        if (v > bars[metric]) fails.push(`${key} ${metric}: ${v} ms > ${bars[metric]} (GOOD band)`);
      } else if (v > known.ceiling) {
        fails.push(`${key} ${metric}: ${v} ms > its KNOWN ceiling ${known.ceiling} (measured ${known.measured} when set): REGRESSION`);
      } else if (v <= bars[metric]) {
        stale.push(`${key} ${metric}: ${v} ms is inside GOOD (${bars[metric]}): delete its KNOWN entry`);
      } else if (v < known.ceiling * CEILING_STALE) {
        stale.push(`${key} ${metric}: ${v} ms is far under its KNOWN ceiling ${known.ceiling}: lower it to ~${Math.round(v * 1.08)}`);
      }
    }
  }
  for (const k of Object.keys(KNOWN)) {
    if (!results[k.split(" ").slice(0, 2).join(" ")]) stale.push(`KNOWN ${k}: no such first screen any more: delete it`);
  }
  expect(fails, "first screens outside their lab budget").toEqual([]);
  expect(stale, "KNOWN entries now inside GOOD or far under their ceiling: delete or lower them").toEqual([]);
});

test("a tap never leads to a jump: walk the dock / rail, per-tap CLS < 0.02, session CLS <= 0.1", async ({ browser, request }) => {
  test.setTimeout(15 * 60_000);
  const session = await getSession(request, "poster");
  const fails: string[] = [];
  for (const width of [375, 1440]) {
    // Desktop network and an unthrottled CPU at both widths: a jump is a
    // layout fact, not a speed, and this keeps the walk short.
    const profile: LabProfile = { ...PROFILES.desktop, ...(width < 900 ? { viewport: PROFILES.mobile.viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}) };
    const ctx = await labContext(browser, profile, session);
    const page = await ctx.newPage();
    await applyThrottle(ctx, page, profile, "chromium", 1);
    await page.goto(`${BASE}/home`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await settle(page, { quietMs: 2500, maxMs: 20_000 });
    const nav = width < 900 ? 'nav[aria-label="Bottom navigation"]' : 'nav[aria-label="Primary"]';
    for (const label of WALK) {
      const before = await page.evaluate(() => (window as unknown as { __cwv: { shifts: unknown[] } }).__cwv.shifts.length);
      const ctl = label.startsWith("@")
        ? page.locator('button:visible, a:visible, [role="tab"]:visible').filter({ hasText: label.slice(1) }).first()
        : page.locator(`${nav} [aria-label="${label}"], ${nav} button:has-text("${label}")`).first();
      await ctl.click({ timeout: 15_000 });
      await settle(page, { quietMs: 2500, maxMs: 20_000 });
      const after = await page.evaluate((n) => (window as unknown as { __cwv: { shifts: Parameters<typeof clsOf>[0] } }).__cwv.shifts.slice(n), before);
      const { cls, window: win } = clsOf(after);
      const at = new URL(page.url()).pathname + new URL(page.url()).search;
      console.log(`[web-vitals] walk ${width} ${label} -> ${at}: CLS ${cls}`);
      if (cls >= WALK_HOP_CLS) fails.push(`${width} tap ${label} -> ${at}: CLS ${cls} (${win.map((s) => s.srcs[0]).join(" | ").slice(0, 300)})`);
    }
    const all = await page.evaluate(() => (window as unknown as { __cwv: { shifts: Parameters<typeof clsOf>[0] } }).__cwv.shifts);
    const sessionCls = clsOf(all).cls;
    console.log(`[web-vitals] walk ${width}: session CLS ${sessionCls} (billed to ${new URL(page.url()).pathname})`);
    if (sessionCls > GOOD.cls) fails.push(`${width}: session CLS ${sessionCls} > ${GOOD.cls}`);
    await ctx.close();
  }
  expect(fails, "taps that lead to a jump").toEqual([]);
});
