import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

import {
  prefersReducedMotion,
  useReducedMotion,
  useDynamicTypeSync,
} from "./accessibility";

// Helper: fake matchMedia that lets each test seed a query → matches map
// and capture/release listeners. The real DOM matchMedia fires on real
// OS preference changes; this stand-in lets us trigger them by hand.
type Listener = (e: MediaQueryListEvent) => void;
function makeFakeMatchMedia(initial: Record<string, boolean>) {
  const state: Record<string, boolean> = { ...initial };
  const listeners = new Map<string, Set<Listener>>();

  const matchMedia = vi.fn((query: string) => {
    const get = () => state[query] ?? false;
    return {
      get matches() {
        return get();
      },
      media: query,
      onchange: null,
      addEventListener: vi.fn((_evt: string, fn: Listener) => {
        if (!listeners.has(query)) listeners.set(query, new Set());
        listeners.get(query)!.add(fn);
      }),
      removeEventListener: vi.fn((_evt: string, fn: Listener) => {
        listeners.get(query)?.delete(fn);
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as MediaQueryList;
  });

  // Test-only helper: simulate the OS toggling a preference.
  const toggle = (query: string, value: boolean) => {
    state[query] = value;
    const fns = listeners.get(query);
    if (!fns) return;
    fns.forEach((fn) => fn({ matches: value, media: query } as MediaQueryListEvent));
  };

  return { matchMedia, toggle, listeners };
}

describe("prefersReducedMotion", () => {
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  });

  it("returns false when matchMedia is unavailable", () => {
    // jsdom has matchMedia by default; force-unset it for this case
    (window as unknown as { matchMedia?: typeof window.matchMedia }).matchMedia = undefined;
    expect(prefersReducedMotion()).toBe(false);
  });

  it("returns false when the user has NOT enabled reduce motion", () => {
    const fake = makeFakeMatchMedia({ "(prefers-reduced-motion: reduce)": false });
    window.matchMedia = fake.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });

  it("returns true when the OS reports reduce-motion = on", () => {
    const fake = makeFakeMatchMedia({ "(prefers-reduced-motion: reduce)": true });
    window.matchMedia = fake.matchMedia;
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe("useReducedMotion", () => {
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  });

  it("seeds initial value from the current OS preference", () => {
    const fake = makeFakeMatchMedia({ "(prefers-reduced-motion: reduce)": true });
    window.matchMedia = fake.matchMedia;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("updates when the OS preference changes mid-session", () => {
    const fake = makeFakeMatchMedia({ "(prefers-reduced-motion: reduce)": false });
    window.matchMedia = fake.matchMedia;
    const { result, rerender } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    fake.toggle("(prefers-reduced-motion: reduce)", true);
    rerender();
    expect(result.current).toBe(true);

    fake.toggle("(prefers-reduced-motion: reduce)", false);
    rerender();
    expect(result.current).toBe(false);
  });

  it("removes its listener on unmount (no leak)", () => {
    const fake = makeFakeMatchMedia({ "(prefers-reduced-motion: reduce)": false });
    window.matchMedia = fake.matchMedia;
    const { unmount } = renderHook(() => useReducedMotion());

    expect(fake.listeners.get("(prefers-reduced-motion: reduce)")?.size).toBe(1);
    unmount();
    expect(fake.listeners.get("(prefers-reduced-motion: reduce)")?.size).toBe(0);
  });
});

describe("useDynamicTypeSync", () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty("--user-text-scale");
  });

  it("writes 1 (no scaling) when the computed font size is the default 16px", () => {
    // jsdom defaults to 16px font-size; no override needed
    renderHook(() => useDynamicTypeSync());
    expect(document.documentElement.style.getPropertyValue("--user-text-scale")).toBe("1");
  });

  it("clamps small text scale to 0.85 minimum", () => {
    document.documentElement.style.fontSize = "10px"; // would compute to 0.625
    renderHook(() => useDynamicTypeSync());
    const written = document.documentElement.style.getPropertyValue("--user-text-scale");
    expect(parseFloat(written)).toBeCloseTo(0.85, 2);
    document.documentElement.style.removeProperty("font-size");
  });

  it("clamps large text scale to 1.5 maximum", () => {
    document.documentElement.style.fontSize = "32px"; // would compute to 2.0
    renderHook(() => useDynamicTypeSync());
    const written = document.documentElement.style.getPropertyValue("--user-text-scale");
    expect(parseFloat(written)).toBeCloseTo(1.5, 2);
    document.documentElement.style.removeProperty("font-size");
  });

  it("writes a sane in-range scale when the OS reports moderate text scaling", () => {
    document.documentElement.style.fontSize = "20px"; // 1.25× the default
    renderHook(() => useDynamicTypeSync());
    const written = document.documentElement.style.getPropertyValue("--user-text-scale");
    expect(parseFloat(written)).toBeCloseTo(1.25, 2);
    document.documentElement.style.removeProperty("font-size");
  });
});
