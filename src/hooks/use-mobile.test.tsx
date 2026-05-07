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
});
