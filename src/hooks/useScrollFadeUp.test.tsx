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

  /* ── THE FAILURE MODE THIS HOOK CAN ACTUALLY CAUSE ────────────────────────
   * Everything above is about the fade ARRIVING. The defect worth guarding is
   * the fade never arriving: `js-fade-hidden` is what makes an element
   * invisible, and if it is applied to something that is then never revealed,
   * a section of the page is simply blank. Until now nothing in this file
   * asserted that class at all — the hook could have hidden every element
   * unconditionally and all eight tests above stayed green, because they only
   * ever asked about `is-visible`. The hook's own 2s reveal-all failsafe, the
   * thing standing between a lost observer callback and a blank page, was
   * likewise never executed.
   */
  it("hides ONLY what it is going to animate in", () => {
    const el = addFadeUpElement("a");
    renderHook(() => useScrollFadeUp());
    // jsdom gives every element a zero rect, so `isInViewport` is false and
    // this element takes the animate branch — the one that hides first.
    expect(el.classList.contains("js-fade-hidden")).toBe(true);
    expect(el.classList.contains("is-visible")).toBe(false);
  });

  it("never hides an element it is revealing immediately (reduced motion)", () => {
    // The inverse, and the one that would ship a blank page to the users least
    // able to tolerate it: a reduced-motion visitor gets no observer at all, so
    // `js-fade-hidden` on them would be permanent.
    mqMatches = true;
    const el = addFadeUpElement("a");
    renderHook(() => useScrollFadeUp());
    expect(el.classList.contains("js-fade-hidden")).toBe(false);
    expect(el.classList.contains("is-visible")).toBe(true);
  });

  it("reveals everything after 2s even if the observer never fires at all", () => {
    vi.useFakeTimers();
    try {
      const el = addFadeUpElement("a");
      renderHook(() => useScrollFadeUp());
      // No triggerVisible() call anywhere: this is the headless-renderer /
      // lost-callback case the failsafe exists for.
      expect(el.classList.contains("is-visible")).toBe(false);
      vi.advanceTimersByTime(2000);
      expect(el.classList.contains("is-visible")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire the failsafe against a torn-down page", () => {
    vi.useFakeTimers();
    try {
      const el = addFadeUpElement("a");
      const { unmount } = renderHook(() => useScrollFadeUp());
      unmount();
      vi.advanceTimersByTime(5000);
      // The element is still in the document (the hook does not own it); a
      // leaked timer would have reached in and revealed it after unmount.
      expect(el.classList.contains("is-visible")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* BLIND SPOTS, stated rather than implied. jsdom computes no layout, so
 * `isInViewport` can only ever be exercised on its false branch here — the
 * "already above the fold, skip the fade" path is unproven by this file. And
 * `is-visible` / `js-fade-hidden` are asserted as CLASS NAMES: whether those
 * classes actually change opacity is a question for src/index.css and a
 * rendered browser, not for jsdom. */

// @mutate src/hooks/useScrollFadeUp.ts | if (reduceMotion \|\| isInViewport(el)) { | if (false) {
// @mutate src/hooks/useScrollFadeUp.ts | ".observe-fade-up:not(.is-visible)" | ".observe-fade-up.never-matches"
// @mutate src/hooks/useScrollFadeUp.ts | window.clearTimeout(revealAllTimer); | void revealAllTimer;
