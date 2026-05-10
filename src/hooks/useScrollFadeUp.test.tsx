import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useScrollFadeUp } from "./useScrollFadeUp";

// jsdom doesn't ship IntersectionObserver. Stand it up so the hook
// can construct one + we can fire synthetic intersection callbacks.
type IOEntry = { target: Element; isIntersecting: boolean };
type IOCallback = (entries: IOEntry[]) => void;

class FakeIntersectionObserver {
  callback: IOCallback;
  observed: Set<Element> = new Set();
  constructor(cb: IOCallback) {
    this.callback = cb;
    fakeIO.lastInstance = this;
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
    fakeIO.disconnectCount += 1;
  }
  // Test-only helper: fire a synthetic intersection callback for these elements.
  triggerVisible(els: Element[]) {
    this.callback(els.map((target) => ({ target, isIntersecting: true })));
  }
}
const fakeIO = {
  lastInstance: null as FakeIntersectionObserver | null,
  disconnectCount: 0,
};

describe("useScrollFadeUp", () => {
  let originalIO: typeof IntersectionObserver | undefined;
  let originalMatchMedia: typeof window.matchMedia | undefined;
  let mqMatches = false;

  beforeEach(() => {
    document.body.innerHTML = "";
    fakeIO.lastInstance = null;
    fakeIO.disconnectCount = 0;
    originalIO = (window as unknown as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIntersectionObserver;

    originalMatchMedia = window.matchMedia;
    mqMatches = false;
    window.matchMedia = vi.fn((q: string) => ({
      matches: q === "(prefers-reduced-motion: reduce)" ? mqMatches : false,
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as MediaQueryList);
  });

  afterEach(() => {
    if (originalIO) {
      (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = originalIO;
    }
    if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  });

  const addFadeUpElement = (id: string) => {
    const el = document.createElement("div");
    el.classList.add("observe-fade-up");
    el.id = id;
    document.body.appendChild(el);
    return el;
  };

  it("observes existing .observe-fade-up elements on mount", () => {
    const a = addFadeUpElement("a");
    const b = addFadeUpElement("b");
    renderHook(() => useScrollFadeUp());
    expect(fakeIO.lastInstance?.observed.has(a)).toBe(true);
    expect(fakeIO.lastInstance?.observed.has(b)).toBe(true);
  });

  it("ignores elements without the observe-fade-up class", () => {
    addFadeUpElement("a");
    const plain = document.createElement("div");
    document.body.appendChild(plain);
    renderHook(() => useScrollFadeUp());
    expect(fakeIO.lastInstance?.observed.has(plain)).toBe(false);
  });

  it("adds is-visible to an element when it scrolls into view", () => {
    const el = addFadeUpElement("a");
    renderHook(() => useScrollFadeUp());
    fakeIO.lastInstance!.triggerVisible([el]);
    expect(el.classList.contains("is-visible")).toBe(true);
  });

  it("unobserves an element after it becomes visible (fire-once)", () => {
    const el = addFadeUpElement("a");
    renderHook(() => useScrollFadeUp());
    expect(fakeIO.lastInstance!.observed.has(el)).toBe(true);
    fakeIO.lastInstance!.triggerVisible([el]);
    expect(fakeIO.lastInstance!.observed.has(el)).toBe(false);
  });

  it("immediately marks elements visible (no observe) when prefers-reduced-motion", () => {
    mqMatches = true;
    const el = addFadeUpElement("a");
    renderHook(() => useScrollFadeUp());
    expect(el.classList.contains("is-visible")).toBe(true);
    expect(fakeIO.lastInstance?.observed.has(el)).toBe(false);
  });

  it("picks up elements added to the DOM after mount (MutationObserver)", async () => {
    renderHook(() => useScrollFadeUp());
    const el = addFadeUpElement("late");
    // MutationObserver fires asynchronously; wait a tick.
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(fakeIO.lastInstance?.observed.has(el)).toBe(true);
  });

  it("picks up elements nested inside a newly-added subtree", async () => {
    renderHook(() => useScrollFadeUp());
    const wrapper = document.createElement("section");
    const inner = document.createElement("div");
    inner.classList.add("observe-fade-up");
    inner.id = "inner";
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(fakeIO.lastInstance?.observed.has(inner)).toBe(true);
  });

  it("disconnects both observers on unmount", () => {
    const { unmount } = renderHook(() => useScrollFadeUp());
    expect(fakeIO.disconnectCount).toBe(0);
    unmount();
    expect(fakeIO.disconnectCount).toBe(1);
  });
});
