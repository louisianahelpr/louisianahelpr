// @vitest-environment jsdom
/*
 * GUARD (2026-10-03, Q1158 lab work): a placeholder nobody can see does not hold
 * a page "unsettled".
 *
 * scripts/audit/measure-page-settle.mjs reported /home at 1440 as never settled
 * (settled = its 15 s cap) on a local build of 5de98ea2b. A probe found the one
 * "visible placeholder": BrowseMap's loader (`lucide-loader-circle
 * animate-spin`, src/components/BrowseMap.tsx:1050) inside an overlay that had
 * faded to opacity 0 and stayed mounted. The page had painted at ~0.5 s. Every
 * desktop page that shows the map read the same false 15 s.
 *
 * The settle sampler now counts a placeholder only when it and every ancestor
 * are displayed, not visibility:hidden, and above opacity 0.01.
 */
// @mutate scripts/audit/measure-page-settle.mjs |       if (!onScreen(el)) continue; |       if (false) continue;
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// @ts-expect-error — plain .mjs script, no declaration file
import { SETTLE_INIT } from "../../scripts/audit/measure-page-settle.mjs";
// @ts-expect-error — plain .mjs script, no declaration file
import { PLACEHOLDER_SEL } from "../../scripts/audit/measure-loading-states.mjs";

type Settle = { ph: number[] };
const settle = () => (window as unknown as { __settle: Settle }).__settle;

function mount(html: string) {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  // jsdom lays nothing out: give every element a real-looking box.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 28, bottom: 28, width: 28, height: 28, toJSON: () => ({}),
  } as DOMRect);
  const sel = Array.isArray(PLACEHOLDER_SEL) ? PLACEHOLDER_SEL.join(",") : PLACEHOLDER_SEL;
  SETTLE_INIT(sel);
}

describe("the settle sampler ignores placeholders nobody can see", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

  it("RED before: BrowseMap's faded-out loader (opacity 0 parent) is not a visible placeholder", () => {
    mount(`<div style="opacity: 0"><svg class="lucide lucide-loader-circle animate-spin"></svg></div><p>Nothing today, Perry.</p>`);
    expect(settle().ph).toEqual([]);
  });

  it("a hidden or display:none ancestor hides it too", () => {
    mount(`<div style="visibility: hidden"><div class="animate-pulse h-8 w-8"></div></div><div style="display: none"><div class="skeleton"></div></div>`);
    expect(settle().ph).toEqual([]);
  });

  it("a loader that IS on screen still holds the page", () => {
    mount(`<div><svg class="lucide lucide-loader-circle animate-spin"></svg></div>`);
    expect(settle().ph.length).toBe(1);
  });
});
