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
import { gateClientNav } from "../requestMeter.mjs";

export type RetentionSample = {
  lap: number;
  nodes: number;
  live: number;
  listeners: number;
  detachedRoots: number;
  detachedNodes: number;
  heapMB: number;
  /**
   * What each retained detached root IS (tag, id, classes, data-/aria- names,
   * opening text, unfinished images), so a red run names the page it kept
   * instead of only a count. Empty when nothing is retained.
   */
  detached: string[];
};

/** One line per detached root: enough to name the screen and the likely holder. */
async function describeDetached(cdp: CDPSession, roots: Array<{ treeNode: { backendNodeId: number; nodeName: string }; retainedNodeIds: number[] }>): Promise<string[]> {
  const out: string[] = [];
  for (const d of roots.slice(0, 8)) {
    const n = d.retainedNodeIds.length;
    let what = d.treeNode.nodeName;
    try {
      const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: d.treeNode.backendNodeId });
      if (object.objectId) {
        const { result } = await cdp.send("Runtime.callFunctionOn", {
          objectId: object.objectId,
          returnByValue: true,
          functionDeclaration: `function () {
            const el = this.nodeType === 1 ? this : this.parentElement || this.firstElementChild;
            const tag = (this.nodeName || "").toLowerCase();
            if (!el) return tag;
            const attrs = Array.from(el.attributes || [])
              .filter((a) => a.name === "id" || a.name.startsWith("data-") || a.name.startsWith("aria-") || a.name === "role")
              .map((a) => a.name + "=" + String(a.value).slice(0, 40)).join(" ");
            const cls = String(el.getAttribute && el.getAttribute("class") || "").split(/\\s+/).filter(Boolean).slice(0, 4).join(".");
            const imgs = el.querySelectorAll ? Array.from(el.querySelectorAll("img")) : [];
            const pending = imgs.filter((i) => !i.complete).length;
            const heading = el.querySelector ? el.querySelector("h1,h2,[data-page-title]") : null;
            const text = (heading ? heading.textContent : el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60);
            return tag + (cls ? "." + cls : "") + (attrs ? " [" + attrs + "]" : "") + " imgs=" + imgs.length + (pending ? " pending=" + pending : "") + ' "' + text + '"';
          }`,
        });
        if (typeof result.value === "string") what = result.value;
        await cdp.send("Runtime.releaseObject", { objectId: object.objectId });
      }
    } catch (e) {
      // A root that cannot be resolved still counts; say why instead of hiding it.
      what += ` (unresolved: ${(e as Error).message.slice(0, 60)})`;
    }
    out.push(`${n} nodes: ${what}`);
  }
  return out;
}

/** An in-app route change: the router's own popstate listener handles it, no reload. */
export async function spaNavigate(page: Page, path: string): Promise<void> {
  await gateClientNav(page, path);
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
  const detached = await describeDetached(cdp, detachedNodes);
  await cdp.send("DOM.disable");
  return {
    lap,
    nodes: m.Nodes,
    live,
    listeners: m.JSEventListeners,
    detachedRoots: detachedNodes.length,
    detachedNodes: detachedNodes.reduce((s, d) => s + d.retainedNodeIds.length, 0),
    heapMB: +(m.JSHeapUsedSize / 1e6).toFixed(2),
    detached,
  };
}
