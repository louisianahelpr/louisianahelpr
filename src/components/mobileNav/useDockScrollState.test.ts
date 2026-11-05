/**
 * The dock's reveal invariant, driven through the real hook (Q1035).
 *
 * The browser proof used to be nav-hide-on-scroll's "switching Jobs > Browse to map view cannot strand the dock"
 * case, on a mocked feed. On prod the feed has no open jobs to scroll (open_jobs_browse held 0 rows, read-only,
 * 2026-11-05 ~04:25Z), so that case cannot run there. What it pinned is this hook's one non-scroll path: when the
 * surface whose scroll hid the dock stops being able to scroll (display:none on a view swap, or unmounted), the
 * ResizeObserver reveals the dock, because no further scroll event will ever fire to do it.
 *
 * @mutate src/components/mobileNav/useDockScrollState.ts | if (!scrollable) setNavHidden(false); |
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDockScrollState } from "@/components/mobileNav/useDockScrollState";

type ROCallback = () => void;
let observers: { cb: ROCallback; targets: Element[] }[] = [];
const RealRO = globalThis.ResizeObserver;

class FakeResizeObserver {
  private entry: { cb: ROCallback; targets: Element[] };
  constructor(cb: ROCallback) {
    this.entry = { cb, targets: [] };
    observers.push(this.entry);
  }
  observe(el: Element) {
    this.entry.targets.push(el);
  }
  unobserve() {}
  disconnect() {
    this.entry.targets = [];
  }
}

/** A scroll container with a settable box: jsdom does no layout, so the sizes are defined on the element. */
function scroller(box: { scrollHeight: number; clientHeight: number }) {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { get: () => box.scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { get: () => box.clientHeight, configurable: true });
  document.body.appendChild(el);
  return el;
}

function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
}

/** Fire every observer watching `el`, as the browser does when its box changes. */
function resized(el: Element) {
  for (const o of observers) if (o.targets.includes(el)) o.cb();
}

describe("useDockScrollState: a surface that stops scrolling reveals the dock", () => {
  beforeEach(() => {
    observers = [];
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  });
  afterEach(() => {
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = RealRO;
    document.body.innerHTML = "";
  });

  it("hides on a scroll down, then comes back when the scrolled surface goes display:none", () => {
    const box = { scrollHeight: 3000, clientHeight: 700 };
    const el = scroller(box);
    const { result } = renderHook(() => useDockScrollState("/jobs"));
    expect(result.current.navHidden).toBe(false);

    act(() => scrollTo(el, 400));
    expect(result.current.navHidden, "a scroll down past 64px hides the dock").toBe(true);
    expect(
      observers.some((o) => o.targets.includes(el)),
      "the surface that hid the dock is the one observed",
    ).toBe(true);

    // The map view swap: the list's container is display:none, so its box is 0x0 and no scroll event follows.
    box.clientHeight = 0;
    act(() => resized(el));
    expect(result.current.navHidden, "no surface is scrolled down any more, so the dock must be back").toBe(false);
  });

  it("stays hidden while the observed surface can still scroll (the observer only ever reveals)", () => {
    const box = { scrollHeight: 3000, clientHeight: 700 };
    const el = scroller(box);
    const { result } = renderHook(() => useDockScrollState("/jobs"));
    act(() => scrollTo(el, 400));
    expect(result.current.navHidden).toBe(true);
    box.clientHeight = 650; // a resize that leaves it scrollable
    act(() => resized(el));
    expect(result.current.navHidden).toBe(true);
  });
});
