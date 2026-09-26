/**
 * The route-retention measure (PD-009), shared by the guest walk
 * (e2e/memory/route-retention.spec.ts) and the signed-in walk
 * (e2e/prod-audit/route-retention-signed-in.spec.ts, Q440) so the two can
 * never measure different things.
 *
 * After three forced GCs: the DOM trees no longer in the document but still
 * held by JavaScript (CDP `DOM.getDetachedDomNodes`), and the renderer's own
 * node and listener counters (`Performance.getMetrics`). Chromium only.
 */
import { expect, type CDPSession, type Page } from "@playwright/test";

export type RetentionSample = {
  lap: number;
  nodes: number;
  live: number;
  listeners: number;
  detachedRoots: number;
  detachedNodes: number;
  heapMB: number;
};

/** An in-app route change: the router's own popstate listener handles it, no reload. */
export async function spaNavigate(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }, path);
  // Gated routes redirect (/jobs -> /login for a guest); that is still a route change.
  await expect.poll(() => page.evaluate(() => location.pathname)).not.toBe("");
  // Enter animation (220 ms) and lazy chunks settle.
  await page.waitForTimeout(700);
}

export async function sampleRetention(page: Page, cdp: CDPSession, lap: number): Promise<RetentionSample> {
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
