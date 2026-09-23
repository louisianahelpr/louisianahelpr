/**
 * Q199 — a visitor on the site DURING a deploy must land on the working page,
 * never on "Helpr couldn't load." / "This page hit a problem.".
 *
 * Runs against the production build (`dist/`, the same one `vite preview`
 * serves), through deploySwap.ts: build A is served, the page is loaded, then
 * build B (every chunk renamed) replaces it, exactly as a Vercel deploy leaves
 * an open tab holding A's chunk names. Both layers are driven:
 *   route  — a lazy route chunk (Support) is gone after client-side nav:
 *            RouteErrorBoundary + recoverFromChunkError (src/lib/chunkReload.ts).
 *   entry  — the HTML in hand is A's, its entry chunk is gone: index.html's
 *            boot watchdog, the only code that can run.
 * and three shapes of deploy:
 *   clean      — the reload gets B: exactly ONE reload, then the real page.
 *   propagating — the reload still gets A's HTML once more (Q199 as seen on
 *            prod: the `?_v=` retry itself failed): no error screen at any
 *            moment, the real page after the next scheduled reload.
 *   broken     — B's own entry is missing for good: the error screen, after
 *            CHUNK_RELOAD_MAX_ATTEMPTS reloads and never another (no loop).
 */
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { existsSync } from "node:fs";

import { makeBuildB, startDeployServer, type DeployServer } from "./deploySwap";
import { CHUNK_RELOAD_MAX_ATTEMPTS } from "../../src/lib/chunkReload";

const DIST = path.resolve("dist");
const ERROR_SCREEN = /Helpr couldn't load\.|This page hit a problem\./;
const SUPPORT_PAGE = /Contact Support[\s\S]*What's this about\?/;
const LEGAL_PAGE = /Legal[\s\S]*Terms[\s\S]*Privacy[\s\S]*The short version/;

let dirB = "";
test.beforeAll(async () => {
  expect(existsSync(path.join(DIST, "index.html")), "needs a production build in dist/ (npm run build)").toBe(true);
  dirB = (await makeBuildB(DIST)).dir;
});

async function bodyText(page: Page): Promise<string> {
  return ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
}

/** Every main-frame document load, and every error screen seen at any poll. */
function watch(page: Page) {
  const docs: string[] = [];
  const errorsSeen: string[] = [];
  page.on("request", (req) => {
    if (req.isNavigationRequest() && req.resourceType() === "document" && req.frame() === page.mainFrame()) {
      const u = new URL(req.url());
      docs.push(u.pathname + u.search);
    }
  });
  const tick = setInterval(async () => {
    const t = await bodyText(page);
    if (ERROR_SCREEN.test(t)) errorsSeen.push(t.slice(0, 120));
  }, 100);
  page.once("close", () => clearInterval(tick));
  return { docs, errorsSeen, stop: () => clearInterval(tick) };
}

async function clientNav(page: Page, p: string) {
  await page.evaluate((to) => {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, p);
}

async function expectPage(page: Page, re: RegExp, label: string, timeout: number) {
  await expect.poll(async () => re.test(await bodyText(page)), { message: `${label}: the real page`, timeout }).toBe(true);
}

let server: DeployServer;
test.afterEach(async () => {
  await server?.close();
});

test.describe("Q199 stale chunks during a deploy", () => {
  test("route chunk, clean deploy: one reload, then the real /support", async ({ page }) => {
    test.slow();
    server = await startDeployServer(DIST, dirB);
    await page.goto(`${server.url}/`, { waitUntil: "load" });
    await page.waitForTimeout(2000);
    const w = watch(page);
    server.deploy();
    await clientNav(page, "/support");
    await expectPage(page, SUPPORT_PAGE, "/support", 20_000);
    w.stop();
    expect(server.missing.length, "a stale chunk really was requested").toBeGreaterThan(0);
    expect(w.docs, "exactly one recovery reload").toHaveLength(1);
    expect(w.docs[0]).toMatch(/^\/support\?_v=\d+$/);
    expect(w.errorsSeen, "never an error screen").toEqual([]);
    await page.screenshot({ path: test.info().outputPath("route-clean.png") });
  });

  test("entry chunk, clean deploy: one reload, then the real /legal", async ({ page }) => {
    test.slow();
    server = await startDeployServer(DIST, dirB);
    server.deploy({ htmlLag: 1 }); // the HTML in hand is A's
    const w = watch(page);
    await page.goto(`${server.url}/legal`, { waitUntil: "commit" });
    await expectPage(page, LEGAL_PAGE, "/legal", 20_000);
    w.stop();
    expect(server.missing.length).toBeGreaterThan(0);
    expect(w.docs, "the visit plus exactly one recovery reload").toHaveLength(2);
    expect(w.docs[1]).toMatch(/^\/legal\?_v=\d+$/);
    expect(w.errorsSeen).toEqual([]);
    await page.screenshot({ path: test.info().outputPath("entry-clean.png") });
  });

  test("route chunk, deploy still propagating: never the error screen, then the real /support", async ({ page }) => {
    test.slow();
    server = await startDeployServer(DIST, dirB);
    await page.goto(`${server.url}/`, { waitUntil: "load" });
    await page.waitForTimeout(2000);
    const w = watch(page);
    server.deploy({ htmlLag: 1 }); // the `?_v=` reload still gets A's HTML
    await clientNav(page, "/support");
    await expectPage(page, SUPPORT_PAGE, "/support", 40_000);
    w.stop();
    expect(w.docs.length, "a second, scheduled reload").toBe(2);
    expect(w.errorsSeen, "never an error screen while the deploy settles").toEqual([]);
    await page.screenshot({ path: test.info().outputPath("route-propagating.png") });
  });

  test("entry chunk, deploy still propagating: never the error screen, then the real /legal", async ({ page }) => {
    test.slow();
    server = await startDeployServer(DIST, dirB);
    server.deploy({ htmlLag: 2 }); // the visit AND its first reload get A's HTML
    const w = watch(page);
    await page.goto(`${server.url}/legal`, { waitUntil: "commit" });
    await expectPage(page, LEGAL_PAGE, "/legal", 40_000);
    w.stop();
    expect(w.docs.length, "the visit plus two reloads").toBe(3);
    expect(w.errorsSeen).toEqual([]);
    await page.screenshot({ path: test.info().outputPath("entry-propagating.png") });
  });

  test("genuinely broken build: the error screen after the capped reloads, and no loop", async ({ page }) => {
    test.setTimeout(180_000);
    server = await startDeployServer(DIST, dirB);
    server.deploy();
    server.breakEntry();
    const w = watch(page);
    await page.goto(`${server.url}/legal`, { waitUntil: "commit" });
    await expect
      .poll(async () => /Helpr couldn't load\./.test(await bodyText(page)), { message: "error screen", timeout: 120_000 })
      .toBe(true);
    const reloadsAtError = w.docs.length - 1;
    await page.waitForTimeout(8_000);
    w.stop();
    expect(reloadsAtError, "exactly the capped number of reloads").toBe(CHUNK_RELOAD_MAX_ATTEMPTS);
    expect(w.docs.length - 1, "no reload after giving up").toBe(CHUNK_RELOAD_MAX_ATTEMPTS);
    expect(await bodyText(page)).toMatch(/Helpr couldn't load\./);
    await expect(page.getByRole("button", { name: /Try Again/i })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("broken-build.png") });
  });
});

// Shown able to fail (each turns this spec red; measured 2026-09-23):
// The boot watchdog giving up on any failure within 10s of a reload was Q199 itself.
// @mutate index.html | var wait = decide(st.count, st.last, Date.now(), offline); | var wait = st.last > 0 && Date.now() - st.last <= 10000 ? -1 : 0;
// The route layer showing the error card while its retry waits.
// @mutate src/lib/chunkReload.ts | export const CHUNK_RELOAD_SCHEDULE_MS: readonly number[] = [0, 5_000, 15_000, 40_000]; | export const CHUNK_RELOAD_SCHEDULE_MS: readonly number[] = [0, 30_000, 30_000, 30_000];
// The cap: a broken build must end on the error screen, not reload forever.
// @mutate index.html | if (count >= SCHEDULE.length) return -1; | if (count >= 99) return -1;
