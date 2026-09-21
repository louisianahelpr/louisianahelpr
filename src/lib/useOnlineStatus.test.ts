// useOnlineStatus is the single source of truth for connectivity state
// across the app (OfflineBanner + future gates). Bugs here either show
// the wrong banner state or fail to refresh queries when connectivity
// returns. Tests cover the contract: initial value from `navigator.onLine`,
// flips on window `online` / `offline` events, and `lastChangedAt` updates
// on every transition.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useOnlineStatus } from "./useOnlineStatus";

/*
 * The NATIVE layer, which had no coverage at all until 2026-09-21.
 *
 * Every case in this file ran with `isNativePlatform` false — its real jsdom
 * value — so the whole `@capacitor/network` effect returned on its first line
 * and never executed. That effect is the REASON the module is more than a
 * two-line `navigator.onLine` wrapper: WKWebView reports `navigator.onLine`
 * true on a captive portal or a "connected, but no internet" network, and the
 * Network plugin reports the real transport. Deleting the entire native block
 * left this file green.
 */
const networkListeners: ((s: { connected: boolean }) => void)[] = [];
const removeSpy = vi.fn();
let pluginStatus = { connected: true };
let pluginAvailable = true;

vi.mock("@capacitor/network", () => ({
  Network: {
    getStatus: async () => {
      if (!pluginAvailable) throw new Error("plugin unavailable");
      return pluginStatus;
    },
    addListener: async (_e: string, cb: (s: { connected: boolean }) => void) => {
      networkListeners.push(cb);
      return { remove: removeSpy };
    },
  },
}));

const nativeFlag = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/nativeInit", () => ({
  get isNativePlatform() {
    return nativeFlag.value;
  },
}));

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}

beforeEach(() => {
  setNavigatorOnline(true);
  networkListeners.length = 0;
  removeSpy.mockClear();
  pluginStatus = { connected: true };
  pluginAvailable = true;
  nativeFlag.value = false;
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

describe("useOnlineStatus — native (@capacitor/network) layer", () => {
  it("believes the Network plugin over navigator.onLine (the captive-portal case)", async () => {
    // This is the defect the native layer exists for: the WebView insists it
    // is online, the OS says there is no transport. Showing "online" here is
    // how a user gets a spinner instead of the offline banner.
    nativeFlag.value = true;
    setNavigatorOnline(true);
    pluginStatus = { connected: false };

    const { result } = renderHook(() => useOnlineStatus());
    await waitFor(() => expect(result.current.online).toBe(false));
  });

  it("follows later networkStatusChange events", async () => {
    nativeFlag.value = true;
    setNavigatorOnline(true);
    pluginStatus = { connected: false };

    const { result } = renderHook(() => useOnlineStatus());
    await waitFor(() => expect(result.current.online).toBe(false));

    await act(async () => {
      networkListeners.forEach((cb) => cb({ connected: true }));
    });
    expect(result.current.online).toBe(true);
  });

  it("does not restamp lastChangedAt when the plugin repeats the current state", async () => {
    // The hook compares before setting. Without that, a plugin that re-emits
    // its state would keep resetting the timestamp that drives the short-lived
    // "back online — refreshing" banner, so the banner would never go away.
    nativeFlag.value = true;
    pluginStatus = { connected: true };

    const { result } = renderHook(() => useOnlineStatus());
    await waitFor(() => expect(networkListeners.length).toBeGreaterThan(0));
    const stamp = result.current.lastChangedAt;

    await act(async () => {
      networkListeners.forEach((cb) => cb({ connected: true }));
    });
    expect(result.current.lastChangedAt).toBe(stamp);
  });

  it("removes the plugin listener on unmount", async () => {
    nativeFlag.value = true;
    const { unmount } = renderHook(() => useOnlineStatus());
    await waitFor(() => expect(networkListeners.length).toBeGreaterThan(0));
    unmount();
    await waitFor(() => expect(removeSpy).toHaveBeenCalled());
  });

  it("falls back to the web path when the plugin throws", async () => {
    nativeFlag.value = true;
    pluginAvailable = false;
    setNavigatorOnline(true);

    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.online).toBe(true);
    await act(async () => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.online).toBe(false);
  });

  it("does not touch the plugin at all on web", async () => {
    nativeFlag.value = false;
    renderHook(() => useOnlineStatus());
    await new Promise((r) => setTimeout(r, 0));
    expect(networkListeners).toHaveLength(0);
  });
});

// The native branch is the whole reason this module is more than a
// navigator.onLine wrapper. Neutering the gate makes the web path run on
// native too, so a captive portal reads as "online" and the user gets a
// spinner instead of the offline banner.
// @mutate src/lib/useOnlineStatus.ts | if (!isNativePlatform) return; | if (true) return;
