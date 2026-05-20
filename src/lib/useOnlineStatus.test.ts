// useOnlineStatus is the single source of truth for connectivity state
// across the app (OfflineBanner + future gates). Bugs here either show
// the wrong banner state or fail to refresh queries when connectivity
// returns. Tests cover the contract: initial value from `navigator.onLine`,
// flips on window `online` / `offline` events, and `lastChangedAt` updates
// on every transition.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useOnlineStatus } from "./useOnlineStatus";

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}

beforeEach(() => {
  setNavigatorOnline(true);
});

describe("useOnlineStatus", () => {
  it("initial value reflects navigator.onLine when online", () => {
    setNavigatorOnline(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.online).toBe(true);
    expect(typeof result.current.lastChangedAt).toBe("number");
  });

  it("initial value reflects navigator.onLine when offline", () => {
    setNavigatorOnline(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.online).toBe(false);
  });

  it("flips to offline when window dispatches an 'offline' event", () => {
    setNavigatorOnline(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.online).toBe(true);

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current.online).toBe(false);
  });

  it("flips to online when window dispatches an 'online' event", () => {
    setNavigatorOnline(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.online).toBe(false);

    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current.online).toBe(true);
  });

  it("updates lastChangedAt on every transition", async () => {
    setNavigatorOnline(true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    try {
      const { result } = renderHook(() => useOnlineStatus());
      const initial = result.current.lastChangedAt;

      vi.setSystemTime(new Date("2026-01-01T00:00:05Z"));
      act(() => {
        setNavigatorOnline(false);
        window.dispatchEvent(new Event("offline"));
      });
      expect(result.current.lastChangedAt).toBeGreaterThan(initial);
      const afterOffline = result.current.lastChangedAt;

      vi.setSystemTime(new Date("2026-01-01T00:00:10Z"));
      act(() => {
        setNavigatorOnline(true);
        window.dispatchEvent(new Event("online"));
      });
      expect(result.current.lastChangedAt).toBeGreaterThan(afterOffline);
    } finally {
      vi.useRealTimers();
    }
  });
});
