// accessibility helpers — Reduced Motion + Dynamic Type. These guard
// real iOS/Android accessibility features. Bugs here either ignore the
// user's OS preference (animations they explicitly disabled keep playing)
// or blow up text scales beyond the clamped sane range.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { prefersReducedMotion, useReducedMotion, useDynamicTypeSync } from "./accessibility";

// Helper to install a controllable matchMedia mock
function installMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    matches: initialMatches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_evt: string, fn: (e: { matches: boolean }) => void) => listeners.add(fn),
    removeEventListener: (_evt: string, fn: (e: { matches: boolean }) => void) => listeners.delete(fn),
  };
  const matchMediaMock = vi.fn(() => mql);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: matchMediaMock,
  });
  return {
    matchMediaMock,
    fireChange: (matches: boolean) => {
      mql.matches = matches;
      listeners.forEach((l) => l({ matches }));
    },
  };
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: originalMatchMedia,
  });
});

describe("prefersReducedMotion (snapshot)", () => {
  it("returns true when the OS reports reduced-motion preference", () => {
    installMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it("returns false when the OS does not request reduced-motion", () => {
    installMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("returns false when matchMedia is unavailable (older browser / SSR)", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: undefined,
    });
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("useReducedMotion (live hook)", () => {
  it("returns the initial preference", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("updates when the OS preference changes (user toggles in Settings)", () => {
    const { fireChange } = installMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      fireChange(true);
    });
    expect(result.current).toBe(true);

    act(() => {
      fireChange(false);
    });
    expect(result.current).toBe(false);
  });
});

describe("useDynamicTypeSync", () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty("--user-text-scale");
  });

  it("writes --user-text-scale to :root", () => {
    renderHook(() => useDynamicTypeSync());
    const value = document.documentElement.style.getPropertyValue("--user-text-scale");
    expect(value).toBeTruthy();
  });

  it("clamps scale to >=0.85 (no shrinking text into illegibility)", () => {
    // Force computed font-size to something tiny
    Object.defineProperty(document.documentElement, "style", {
      configurable: true,
      writable: true,
      value: document.documentElement.style,
    });
    const originalGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = (() => ({
      fontSize: "8px", // would compute to scale=0.5, must clamp up
    })) as unknown as typeof window.getComputedStyle;

    try {
      renderHook(() => useDynamicTypeSync());
      const value = parseFloat(
        document.documentElement.style.getPropertyValue("--user-text-scale"),
      );
      expect(value).toBeGreaterThanOrEqual(0.85);
    } finally {
      window.getComputedStyle = originalGetComputedStyle;
    }
  });

  it("clamps scale to <=1.5 (no blowing up CTAs to fill the screen)", () => {
    const originalGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = (() => ({
      fontSize: "32px", // would compute to scale=2.0, must clamp down
    })) as unknown as typeof window.getComputedStyle;

    try {
      renderHook(() => useDynamicTypeSync());
      const value = parseFloat(
        document.documentElement.style.getPropertyValue("--user-text-scale"),
      );
      expect(value).toBeLessThanOrEqual(1.5);
    } finally {
      window.getComputedStyle = originalGetComputedStyle;
    }
  });
});
