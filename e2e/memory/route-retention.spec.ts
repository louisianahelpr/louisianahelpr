import { test, expect, type CDPSession, type Page } from "../prodTest";

/**
 * PD-009: SPA route changes must not keep the previous page alive.
 *
 * Walks the public routes as a guest (this commit's local build, prod
 * Supabase reads), round after round, and after three forced GCs asks Chromium
 * for the DOM trees that are no longer in the document but are still held by
 * JavaScript (CDP `DOM.getDetachedDomNodes`), plus the renderer's own node and
 * listener counters (`Performance.getMetrics`).
 *
 * Measured 2026-09-25 by this spec on 390x844 (lap 3 = 40 navigations),
 * release removed vs in place:
 *   - detached DOM retained:  478 nodes (2 whole /legal pages) -> 12 / 49 (two runs)
 *   - renderer Nodes, lap 3:  1029 (live 482)                   -> 499 / 541 (live 482)
 *   - JSEventListeners:       263 -> 282 across laps            -> 249 / 251, flat
 * The retainer was framer-motion's global `sharedNodes` layout stack keeping
 * the unmounted `legalTabPill` (and through its `parent`, the old page's
 * PageTransition subtree). Fix: src/components/ui/SharedLayoutPill.tsx.
 *
 * Budgets are not zero on purpose: React keeps the last-deleted fibers of a
 * persistent parent (the header) until its next commit, which measured 0-136
 * detached nodes between runs (scratch runs and this spec) and never grew across laps. A retained PAGE is
 * 239+ nodes and a per-navigation leak grows every lap; both fail.
 *
 * Signed-in routes are NOT walked here: this job signs in only for auth.spec.
 * Their `layoutId` pills go through the same primitive, which
 * src/test/sharedLayoutIdGoesThroughPill.test.ts enforces for every file.
 *
 * Shown able to fail (2026-09-25, the @mutate below applied and rebuilt): the
 * two retained /legal pages come back — 478 detached nodes (budget 150),
 * renderer Nodes 756 -> 1029 from lap 1 to lap 3, listeners 263 -> 282.
 * @mutate src/components/ui/SharedLayoutPill.tsx | stacks.delete(layoutId); | void stacks;
 */

const ROUTES = ["/browse", "/jobs", "/how-it-works", "/help", "/legal", "/parishes", "/community", "/for-business", "/impact", "/"];
const LAPS = 3;
/** Detached nodes still retained after GC. A whole retained page is 239+. */
const DETACHED_NODE_BUDGET = 150;
/** Renderer node growth from the first measured lap to the last: a per-nav leak grows every lap. */
const NODE_GROWTH_BUDGET = 60;
/** JSEventListeners growth from the first measured lap to the last. */
const LISTENER_GROWTH_BUDGET = 10;

type Sample = { lap: number; nodes: number; live: number; listeners: number; detachedRoots: number; detachedNodes: number; heapMB: number };

async function spaNavigate(page: Page, path: string) {
  // The router's own popstate listener handles it: no reload, exactly an in-app navigation.
  await page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }, path);
  // Guest-gated routes (/jobs) redirect to /login; that is still a route change.
  await expect.poll(() => page.evaluate(() => location.pathname)).not.toBe("");
  // Enter animation (220 ms) and lazy chunks settle.
  await page.waitForTimeout(700);
}

async function sample(page: Page, cdp: CDPSession, lap: number): Promise<Sample> {
  for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const live = await page.evaluate(() => {
    let n = 1; // the document itself
    const walk = (root: Node) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
      while (w.nextNode()) {
        n++;
        const sr = (w.currentNode as Element).shadowRoot;
        if (sr) {
          n++;
          walk(sr);
        }
      }
    };
    walk(document);
    return n;
  });
  await cdp.send("DOM.enable");
  const { detachedNodes } = await cdp.send("DOM.getDetachedDomNodes");
  await cdp.send("DOM.disable");
  return {
    lap,
    nodes: m.Nodes,
    live,
    listeners: m.JSEventListeners,
    detachedRoots: detachedNodes.length,
    detachedNodes: detachedNodes.reduce((s, d) => s + d.retainedNodeIds.length, 0),
    heapMB: +(m.JSHeapUsedSize / 1e6).toFixed(2),
  };
}

test.describe("PD-009 route retention", () => {
  test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });

  test("route round-trips do not retain old pages, nodes or listeners", async ({ page, context }) => {
    test.setTimeout(4 * 60_000);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
    // A first interaction loads analytics (src/main.tsx: first pointer/key or a
    // 25 s fallback). Its ~33 app-lifetime listeners must land before sampling,
    // or the fallback firing mid-walk reads as listener growth.
    await page.keyboard.press("Shift");
    // Warm lap: first-load chunks, fonts, analytics and caches are not retention.
    for (const r of ROUTES) await spaNavigate(page, r);

    const samples: Sample[] = [];
    for (let lap = 1; lap <= LAPS; lap++) {
      for (const r of ROUTES) await spaNavigate(page, r);
      samples.push(await sample(page, cdp, lap));
    }
    console.log(`[PD-009] ${JSON.stringify(samples)}`);
    await test.info().attach("route-retention.json", { body: JSON.stringify(samples, null, 2), contentType: "application/json" });

    const first = samples[0];
    const last = samples[samples.length - 1];
    // Inventory floor: the walk really rendered pages and really measured.
    expect(samples.length, "one sample per lap").toBeGreaterThan(LAPS - 1);
    expect(last.live, "live DOM node count of the landing page").toBeGreaterThan(200);
    expect(last.listeners).toBeGreaterThan(50);

    expect(last.detachedNodes, `detached DOM still retained after ${LAPS * ROUTES.length + ROUTES.length} navigations`).toBeLessThanOrEqual(DETACHED_NODE_BUDGET);
    expect(last.nodes - first.nodes, "renderer node growth across laps").toBeLessThanOrEqual(NODE_GROWTH_BUDGET);
    expect(last.listeners - first.listeners, "event-listener growth across laps").toBeLessThanOrEqual(LISTENER_GROWTH_BUDGET);
  });
});
