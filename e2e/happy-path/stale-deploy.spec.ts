/**
 * stale-deploy — simulate a deploy that invalidated the lazy chunks, on MANY
 * routes, not just the one `zz-runtime-probe` covers.
 *
 * Why this exists: the removed "Update ready" screen only ever appeared when a
 * lazy route chunk failed to load, and no audit created that condition except
 * on /browse's DashboardGuest chunk. So the screen shipped, and was wrong,
 * for months with nobody seeing it. This spec makes the condition on every
 * route listed below, two ways:
 *
 *   warm  — the SPA is loaded once, then every /assets/*.js NOT already
 *           fetched is aborted (those filenames "no longer exist"), then the
 *           route is reached by client-side navigation. This is the real
 *           post-deploy case: an open tab referencing old chunk hashes.
 *   cold  — a fresh document load of the route with its lazy chunks aborted.
 *           The shell's own module graph (everything a DIFFERENT route
 *           fetched) stays reachable: a fresh HTML always matches its entry
 *           graph, so what goes missing on a real cold load is the route
 *           chunk.
 *   boot  — the HTML itself is stale: the entry file loads but its static
 *           imports 404, so no bundle code runs at all. Only index.html's
 *           inline boot watchdog can act; before it existed the boot mark
 *           spun forever.
 *
 * For each, with the one-shot reload guard (`helpr_chunk_reload_at`, see
 * src/lib/chunkReload.ts) ARMED the boundary must show the honest card and a
 * Try Again button; NOT armed, exactly one reload must happen and then the
 * honest card (no loop). Never blank, never "Update ready"/"newer version".
 * And Try Again, once the chunk is reachable again, must actually recover.
 */
import type { Page, BrowserContext, Route } from "@playwright/test";

import { test, expect, FAKE_CUSTOMER, installSupabaseMocks, seedAuthedSession } from "./fixtures";

const GUARD_KEY = "helpr_chunk_reload_at";
const HONEST = /This page hit a problem\.|You're offline\./;
const FORBIDDEN = /Update ready|newer version/i;

interface RouteCase {
  path: string;
  authed: boolean;
  /** Where the warm scenario first loads the SPA. Must not pre-fetch `path`'s chunk. */
  start: string;
}

const ROUTES: RouteCase[] = [
  { path: "/terms", authed: false, start: "/login" },
  { path: "/rules", authed: false, start: "/login" },
  { path: "/privacy", authed: false, start: "/login" },
  { path: "/login", authed: false, start: "/terms" },
  { path: "/signup", authed: false, start: "/terms" },
  { path: "/browse", authed: false, start: "/terms" },
  { path: "/dashboard", authed: true, start: "/terms" },
  { path: "/profile", authed: true, start: "/terms" },
  { path: "/complete-profile", authed: true, start: "/terms" },
  { path: "/messages", authed: true, start: "/terms" },
];

async function bodyText(page: Page): Promise<string> {
  return ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
}

/** Counts real document loads (reloads / hard navigations) of the main frame. */
function countDocumentLoads(page: Page): { n: number } {
  const counter = { n: 0 };
  page.on("request", (req) => {
    if (req.isNavigationRequest() && req.resourceType() === "document" && req.frame() === page.mainFrame()) {
      counter.n += 1;
    }
  });
  return counter;
}

async function setup(page: Page, context: BrowserContext, rc: RouteCase, baseURL: string) {
  if (rc.authed) {
    await seedAuthedSession(context, FAKE_CUSTOMER, baseURL);
    await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });
  } else {
    await installSupabaseMocks(page, { seed: true });
  }
}

/** Track every /assets/*.js the page has requested so far. */
function trackJs(page: Page): Set<string> {
  const seen = new Set<string>();
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (/^\/assets\/.+\.js$/.test(u.pathname)) seen.add(u.pathname);
  });
  return seen;
}

/** Abort every /assets/*.js not in `allowed`. Returns the abort counter and an unblock fn. */
async function blockChunks(page: Page, allowed: Set<string>) {
  const aborted = new Set<string>();
  const handler = (route: Route) => {
    const p = new URL(route.request().url()).pathname;
    if (allowed.has(p)) return route.continue();
    aborted.add(p);
    return route.abort("failed");
  };
  await page.route("**/assets/*.js", handler);
  return { aborted, unblock: () => page.unroute("**/assets/*.js", handler) };
}

async function clientNav(page: Page, path: string) {
  await page.evaluate((p) => {
    window.history.pushState({}, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

async function armGuard(page: Page) {
  await page.evaluate((k) => sessionStorage.setItem(k, String(Date.now())), GUARD_KEY);
}

async function expectHonestCard(page: Page, label: string) {
  // Poll card AND non-blank together, then re-read once the document has
  // settled. A single read right after the poll could land mid-reload and see
  // an empty body (seen once under full-suite load on /dashboard cold, never in
  // 10 isolated repeats).
  await expect
    .poll(async () => {
      const t = await bodyText(page);
      return HONEST.test(t) && t.length > 20;
    }, { message: `${label}: honest error card`, timeout: 15_000 })
    .toBe(true);
  await page.waitForLoadState("load").catch(() => {});
  const body = await bodyText(page);
  expect(body.length, `${label}: never blank`).toBeGreaterThan(20);
  expect(body, `${label}: no "Update ready" disguise`).not.toMatch(FORBIDDEN);
  await expect(page.getByRole("button", { name: /Try Again/i }).first(), `${label}: Try Again`).toBeVisible();
}

/** Watches the body the whole time so a transient blank or forbidden screen is caught too. */
function watchForbidden(page: Page): { hits: string[] } {
  const state = { hits: [] as string[] };
  const tick = setInterval(async () => {
    const b = await bodyText(page);
    if (FORBIDDEN.test(b)) state.hits.push(b.slice(0, 160));
  }, 150);
  page.once("close", () => clearInterval(tick));
  return state;
}

for (const rc of ROUTES) {
  test.describe(`stale deploy · ${rc.path}`, () => {
    test.describe.configure({ mode: "parallel" });

    test("warm, guard armed: honest card, then Try Again recovers once unblocked", async ({ page, context, baseURL }) => {
      test.slow();
      await setup(page, context, rc, baseURL ?? "");
      const seen = trackJs(page);
      const forbidden = watchForbidden(page);
      await page.goto(rc.start, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      const docs = countDocumentLoads(page);
      const block = await blockChunks(page, new Set(seen));
      await armGuard(page);
      await clientNav(page, rc.path);
      await expectHonestCard(page, `${rc.path} warm armed`);
      expect(block.aborted.size, "the route really needed an unfetched chunk").toBeGreaterThan(0);
      expect(docs.n, "armed guard: no reload").toBe(0);
      await page.screenshot({ path: test.info().outputPath("honest-card.png") });

      // The deploy "finishes propagating": chunks reachable again.
      await block.unblock();
      await page.getByRole("button", { name: /Try Again/i }).first().click();
      await expect
        .poll(async () => {
          const b = await bodyText(page);
          return !HONEST.test(b) && b.length > 40;
        }, { message: `${rc.path}: Try Again recovers`, timeout: 20_000 })
        .toBe(true);
      expect(forbidden.hits, "never showed Update ready").toEqual([]);
      await page.screenshot({ path: test.info().outputPath("recovered.png") });
    });

    test("warm, guard NOT armed: exactly one reload, no loop, then honest card", async ({ page, context, baseURL }) => {
      test.slow();
      await setup(page, context, rc, baseURL ?? "");
      const seen = trackJs(page);
      const forbidden = watchForbidden(page);
      await page.goto(rc.start, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      await page.evaluate((k) => sessionStorage.removeItem(k), GUARD_KEY);
      const docs = countDocumentLoads(page);
      const block = await blockChunks(page, new Set(seen));
      await clientNav(page, rc.path);
      await expectHonestCard(page, `${rc.path} warm unarmed`);
      // Give a would-be loop time to show itself (guard window is 10s; a loop
      // would reload again immediately after the first).
      await page.waitForTimeout(4000);
      expect(block.aborted.size).toBeGreaterThan(0);
      expect(docs.n, "exactly one automatic reload").toBe(1);
      await expectHonestCard(page, `${rc.path} warm unarmed (settled)`);
      await page.screenshot({ path: test.info().outputPath("one-reload.png") });
      expect(forbidden.hits).toEqual([]);
    });

    test("cold load with route chunk aborted: one reload, no loop, honest card", async ({ page, context, baseURL }) => {
      test.slow();
      await setup(page, context, rc, baseURL ?? "");
      const seen = trackJs(page);
      const forbidden = watchForbidden(page);
      await page.goto(rc.start, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      await page.evaluate((k) => sessionStorage.removeItem(k), GUARD_KEY);
      const block = await blockChunks(page, new Set(seen));
      const docs = countDocumentLoads(page);
      await page.goto(rc.path, { waitUntil: "domcontentloaded" });
      await expectHonestCard(page, `${rc.path} cold`);
      await page.waitForTimeout(4000);
      expect(block.aborted.size).toBeGreaterThan(0);
      // The cold goto + exactly one recovery reload.
      expect(docs.n, "cold load + exactly one reload").toBe(2);
      await expectHonestCard(page, `${rc.path} cold (settled)`);
      await page.screenshot({ path: test.info().outputPath("cold.png") });
      expect(forbidden.hits).toEqual([]);
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────
// boot — stale HTML whose entry module graph is gone (index.html watchdog)
// ───────────────────────────────────────────────────────────────────────────

const BOOT_FAIL = /Helpr couldn't load\.|You're offline\./;

/** Allow only the entry file itself; every static import it needs 404s. */
async function breakEntryGraph(page: Page) {
  const aborted = new Set<string>();
  const handler = (route: Route) => {
    const p = new URL(route.request().url()).pathname;
    if (/^\/assets\/index-[^/]+\.js$/.test(p)) return route.continue();
    aborted.add(p);
    return route.abort("failed");
  };
  await page.route("**/assets/*.js", handler);
  return { aborted, unblock: () => page.unroute("**/assets/*.js", handler) };
}

for (const rc of [ROUTES[3], ROUTES[6]]) {
  test.describe(`stale deploy · boot · ${rc.path}`, () => {
    test("stale HTML, guard NOT armed: one reload, then an honest message, never an endless spinner", async ({ page, context, baseURL }) => {
      test.slow();
      await setup(page, context, rc, baseURL ?? "");
      const forbidden = watchForbidden(page);
      const block = await breakEntryGraph(page);
      const docs = countDocumentLoads(page);
      await page.goto(rc.path, { waitUntil: "domcontentloaded" });
      await expect
        .poll(async () => BOOT_FAIL.test(await bodyText(page)), { message: "boot failure message", timeout: 15_000 })
        .toBe(true);
      await page.waitForTimeout(4000);
      expect(block.aborted.size).toBeGreaterThan(0);
      expect(docs.n, "cold load + exactly one reload").toBe(2);
      await expect(page.getByRole("button", { name: /Try Again/i })).toBeVisible();
      expect(await bodyText(page)).not.toMatch(FORBIDDEN);
      expect(forbidden.hits).toEqual([]);
      await page.screenshot({ path: test.info().outputPath("boot-failure.png") });
    });

    test("stale HTML, guard armed: honest message, then Try Again boots the app and the failure is reported", async ({ page, context, baseURL }) => {
      test.slow();
      await setup(page, context, rc, baseURL ?? "");
      await page.goto(rc.start, { waitUntil: "load" });
      await armGuard(page);
      const block = await breakEntryGraph(page);
      const docs = countDocumentLoads(page);
      await page.goto(rc.path, { waitUntil: "domcontentloaded" });
      await expect
        .poll(async () => BOOT_FAIL.test(await bodyText(page)), { message: "boot failure message", timeout: 15_000 })
        .toBe(true);
      expect(docs.n, "armed guard: no automatic reload").toBe(1);
      expect(await page.evaluate(() => localStorage.getItem("helpr_boot_failure"))).toBeTruthy();

      await block.unblock();
      await page.getByRole("button", { name: /Try Again/i }).click();
      await expect
        .poll(async () => {
          const gone = await page.evaluate(() => !document.getElementById("boot-loader")).catch(() => false);
          const b = await bodyText(page);
          return gone && !BOOT_FAIL.test(b) && b.length > 40;
        }, { message: "Try Again boots the app", timeout: 20_000 })
        .toBe(true);
      // main.tsx picked the record up and reported it.
      expect(await page.evaluate(() => localStorage.getItem("helpr_boot_failure"))).toBeNull();
      await page.screenshot({ path: test.info().outputPath("boot-recovered.png") });
    });
  });
}
