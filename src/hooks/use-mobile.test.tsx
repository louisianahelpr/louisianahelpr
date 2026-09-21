// useIsMobile gates mobile-only UI (bottom nav, FAB, simplified
// layouts). Bugs here either render the desktop UI on phones (broken
// thumb-zone) or render the mobile UI on desktops (wasted screen).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile } from "./use-mobile";

let listeners: Array<(e: { matches: boolean }) => void> = [];

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      matches: width < 768,
      media: "(max-width: 767px)",
      addEventListener: (_evt: string, fn: (e: { matches: boolean }) => void) => {
        listeners.push(fn);
      },
      removeEventListener: (_evt: string, fn: (e: { matches: boolean }) => void) => {
        listeners = listeners.filter((l) => l !== fn);
      },
    })),
  });
}

beforeEach(() => {
  listeners = [];
});

afterEach(() => {
  listeners = [];
});

describe("useIsMobile", () => {
  it("returns true at viewport width 320 (small phone)", () => {
    setViewport(320);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("returns true at viewport width 767 (right at breakpoint - 1)", () => {
    setViewport(767);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("returns false at viewport width 768 (breakpoint, tablet+)", () => {
    setViewport(768);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("returns false at viewport width 1440 (desktop)", () => {
    setViewport(1440);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("updates on window resize past the breakpoint", () => {
    setViewport(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    // Resize to mobile
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 600,
    });
    act(() => {
      listeners.forEach((l) => l({ matches: true }));
    });
    expect(result.current).toBe(true);
  });

  it("removes its media-query listener on unmount", () => {
    // Without the cleanup every mount leaks a listener onto the MediaQueryList
    // and a setState fires on an unmounted component on the next resize. This
    // hook is mounted by the bottom nav, the FAB and a dozen layouts, so the
    // leak compounds across every route change.
    setViewport(1024);
    const { unmount } = renderHook(() => useIsMobile());
    expect(listeners).toHaveLength(1);
    unmount();
    expect(listeners, "listener still attached after unmount").toHaveLength(0);
  });
});

// The breakpoint itself. Move it and phones get the desktop layout, or
// tablets get the phone one — the two defects named at the top of this file.
// @mutate src/hooks/use-mobile.tsx | const MOBILE_BREAKPOINT = 768; | const MOBILE_BREAKPOINT = 1024;
// The listener cleanup: one leaked subscription per mount, on a hook mounted
// by the bottom nav, the FAB and a dozen layouts.
// @mutate src/hooks/use-mobile.tsx | return () => mql.removeEventListener("change", onChange); | return;
