// usePrefetchOnTouch fires a prefetch in the ~80ms touchstart→click gap
// on mobile. Bugs here either silently fail to prefetch (UX regression —
// the tap feels slow again) or fire repeatedly (defeats the "warm once"
// invariant and pressures the network).
//
// Tests focus on:
//  - calls prefetch exactly once across hover + touch on the same instance
//  - no-ops on repeat events after the first
//  - swallows a rejected promise so the tap path is never aborted
//  - swallows a synchronous throw for the same reason
//  - each useRef-backed instance primes independently (no cross-talk)

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePrefetchOnTouch } from "./usePrefetchOnTouch";

describe("usePrefetchOnTouch", () => {
  it("fires the prefetcher exactly once on first onTouchStart", () => {
    const prefetch = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => usePrefetchOnTouch(prefetch));

    act(() => result.current.onTouchStart());
    act(() => result.current.onTouchStart());
    act(() => result.current.onTouchStart());

    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it("fires the prefetcher exactly once on first onMouseEnter", () => {
    const prefetch = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => usePrefetchOnTouch(prefetch));

    act(() => result.current.onMouseEnter());
    act(() => result.current.onMouseEnter());

    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it("treats touch and mouse as the same primed channel (mixed events still fire once)", () => {
    // An iPad with a trackpad can deliver mouseenter THEN touchstart on
    // the same press. The hook must dedupe across both, not per-channel.
    const prefetch = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => usePrefetchOnTouch(prefetch));

    act(() => result.current.onMouseEnter());
    act(() => result.current.onTouchStart());
    act(() => result.current.onMouseEnter());

    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it("does NOT throw when the prefetcher returns a rejected promise", () => {
    const prefetch = vi.fn(() => Promise.reject(new Error("offline")));
    const { result } = renderHook(() => usePrefetchOnTouch(prefetch));

    expect(() => act(() => result.current.onTouchStart())).not.toThrow();
    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it("ATTACHES a rejection handler to the returned promise — the .catch() is load-bearing", () => {
    // HOLLOW UNTIL 2026-09-21: the test above passes with the hook's
    // `.catch(() => {})` deleted, because a rejected promise never throws
    // SYNCHRONOUSLY — `expect(...).not.toThrow()` returns before the microtask
    // that rejects. Without the catch, what a user gets is not an exception in
    // this test, it is an unhandled rejection on every tap of a card whose
    // prefetch 401s (a WKWebView console error and a Sentry
    // `unhandledrejection` report per tap). `process.on("unhandledRejection")`
    // does not observe that under vitest, so assert the mechanism itself: the
    // hook must call `.catch` on whatever the prefetcher handed back.
    const catchSpy = vi.fn((_onRejected: (reason: unknown) => void) => Promise.resolve());
    const thenable = { then: () => Promise.resolve(), catch: catchSpy };
    const prefetch = vi.fn(() => thenable as unknown as Promise<unknown>);
    const { result } = renderHook(() => usePrefetchOnTouch(prefetch));

    expect(() => act(() => result.current.onTouchStart())).not.toThrow();

    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(catchSpy).toHaveBeenCalledTimes(1);
    expect(typeof catchSpy.mock.calls[0][0]).toBe("function");
  });

  it("does NOT throw when the prefetcher throws synchronously", () => {
    const prefetch = vi.fn(() => {
      throw new Error("boom");
    });
    const { result } = renderHook(() => usePrefetchOnTouch(prefetch));

    expect(() => act(() => result.current.onTouchStart())).not.toThrow();
    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it("each hook instance primes independently — one card's tap does not block another", () => {
    // Crucial for a job-card feed: if these shared module state the
    // first card you touch would mark every other card as primed and
    // silently disable their prefetch.
    const prefetchA = vi.fn(() => Promise.resolve());
    const prefetchB = vi.fn(() => Promise.resolve());
    const { result: a } = renderHook(() => usePrefetchOnTouch(prefetchA));
    const { result: b } = renderHook(() => usePrefetchOnTouch(prefetchB));

    act(() => a.current.onTouchStart());
    act(() => b.current.onTouchStart());

    expect(prefetchA).toHaveBeenCalledTimes(1);
    expect(prefetchB).toHaveBeenCalledTimes(1);
  });

  it("supports a sync-returning prefetcher (the hook does not require a promise)", () => {
    const prefetch = vi.fn(() => undefined);
    const { result } = renderHook(() => usePrefetchOnTouch(prefetch));

    expect(() => act(() => result.current.onTouchStart())).not.toThrow();
    expect(prefetch).toHaveBeenCalledTimes(1);
  });
});

// @mutate src/lib/usePrefetchOnTouch.ts | if (primedRef.current) return; | if (false) return;
// @mutate src/lib/usePrefetchOnTouch.ts | (result as Promise<unknown>).catch(() => { | void 0 && (result as Promise<unknown>).catch(() => {
