import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCountUp } from "./useCountUp";

describe("useCountUp", () => {
  beforeEach(() => {
    // matchMedia default for these tests: motion not reduced.
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when target is null", () => {
    const { result } = renderHook(() => useCountUp(null));
    expect(result.current).toBe(null);
  });

  it("snaps to the first non-null target without animating", () => {
    const { result } = renderHook(() => useCountUp(7));
    // Starts at the target value, no zero-frame flash.
    expect(result.current).toBe(7);
  });

  it("returns to null when target flips back to null", () => {
    const { result, rerender } = renderHook(({ t }) => useCountUp(t), {
      initialProps: { t: 5 as number | null },
    });
    expect(result.current).toBe(5);
    rerender({ t: null });
    expect(result.current).toBe(null);
  });

  it("snaps when prefers-reduced-motion is on", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("reduce"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    const { result, rerender } = renderHook(({ t }) => useCountUp(t), {
      initialProps: { t: 3 as number | null },
    });
    expect(result.current).toBe(3);
    rerender({ t: 99 });
    // With reduced motion, second target snaps too — no in-between frame.
    expect(result.current).toBe(99);
  });

  it("eventually reaches the target after animating", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ t }) => useCountUp(t, { durationMs: 100 }), {
      initialProps: { t: 0 as number | null },
    });
    expect(result.current).toBe(0);
    rerender({ t: 50 });
    // Run all pending RAF + timers far past the duration.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    // The target should have been reached.
    expect(result.current).toBe(50);
  });
});
