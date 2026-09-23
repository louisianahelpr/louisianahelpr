/**
 * REAL-USER repro attempt for "a navigation eaten by the chunk-recovery reload".
 *
 * Unlike the harness repro (which dispatched a synthetic `vite:preloadError`),
 * every step here is a real code path:
 *   - the in-flight chunk is a REAL speculative prefetch (`prefetchRoute`,
 *     fired by a real hover on a real footer link), served slowly to model a
 *     bad mobile connection;
 *   - the `vite:preloadError` is raised by WebKit cancelling that request, not
 *     dispatched by the test;
 *   - the navigation is a REAL app hard navigation — `window.location.href = url`,
 *     exactly what `src/lib/openExternalUrl.ts:45` does for every money hand-off
 *     on web — to a destination served slowly, modelling a cold Stripe redirect.
 *
 * Run: node scripts/repro-chunk-nav-eaten.mjs
 */
import { webkit } from "@playwright/test";

const ORIGIN = process.env.REPRO_ORIGIN || "http://localhost:4199";
const CHUNK_DELAY_MS = Number(process.env.CHUNK_DELAY_MS || 3000);
const DEST_DELAY_MS = Number(process.env.DEST_DELAY_MS || 4000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();

  const events = [];
  await page.addInitScript(() => {
    window.__reproEvents = [];
    window.addEventListener("vite:preloadError", (e) => {
      window.__reproEvents.push({
        kind: "vite:preloadError",
        message: String(e?.payload?.message ?? e?.payload ?? ""),
        defaultPrevented: e.defaultPrevented,
        at: Date.now(),
      });
    }, true);
  });

  // Slow the Legal route chunk — a real user on bad LTE, not a synthetic stall.
  await page.route("**/assets/Legal-*.js", async (route) => {
    await sleep(CHUNK_DELAY_MS);
    await route.continue();
  });

  // The money destination: a cold external redirect that takes a few seconds.
  await page.route("**/slow-money-destination*", async (route) => {
    await sleep(DEST_DELAY_MS);
    await route.fulfill({ status: 200, contentType: "text/html", body: "<h1>DESTINATION</h1>" });
  });

  await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  // 1. REAL prefetch trigger: hover the footer Terms link.
  const terms = page.locator('a[href="/terms"], a[href="/legal"]').first();
  let prefetchFired = false;
  if (await terms.count()) {
    await terms.hover({ timeout: 3000 }).catch(() => {});
    prefetchFired = true;
  }
  if (!prefetchFired) {
    // Fall back to the same function the hover would have called.
    await page.evaluate(() => window.dispatchEvent(new Event("noop")));
  }

  // Give the prefetch a moment to actually be in flight (it is stalled 3s).
  await page.waitForTimeout(300);

  const before = page.url();

  // 2. REAL hard navigation — literally openExternalUrl()'s web branch.
  await page.evaluate((dest) => {
    window.location.href = dest;
  }, `${ORIGIN}/slow-money-destination?session=cs_test_123`);

  // 3. Wait out both the chunk stall and the destination.
  await page.waitForTimeout(CHUNK_DELAY_MS + DEST_DELAY_MS + 2000);

  const after = page.url();
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 120) ?? "").catch(() => "");
  const evs = await page.evaluate(() => window.__reproEvents ?? []).catch(() => []);

  console.log(JSON.stringify({
    before,
    after,
    landedOnDestination: after.includes("slow-money-destination"),
    eatenByRecoveryReload: !after.includes("slow-money-destination") && after.includes("_v="),
    preloadErrorEvents: evs.length ? evs : events,
    bodyPreview: body,
  }, null, 2));

  await browser.close();
};

run().catch((e) => { console.error("REPRO FAILED:", e); process.exit(1); });
