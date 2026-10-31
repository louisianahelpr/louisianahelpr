// Owner 10-31: she was ONLINE, Chrome reported navigator.onLine=false, and the
// app showed a full-page "You're offline." on /jobs?tab=posted plus the banner.
// On the web a false onLine is only a hint: the app confirms it with a backend
// probe (src/lib/connectivity.ts) before the banner, a feed's offline card, an
// error boundary's offline copy or TanStack's query pausing say "offline".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { onlineManager } from "@tanstack/react-query";
import {
  OFFLINE_REPROBE_MS,
  getConnectivity,
  noteReachable,
  noteReachableFetch,
  resetConnectivityForTests,
} from "./connectivity";
import "./queryClient";
import OfflineBanner from "@/components/OfflineBanner";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
import ErrorBoundary from "@/components/ErrorBoundary";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn(), installGlobalErrorHandlers: vi.fn() }));

const BANNER = /You're offline\. Reconnect to load anything new\./;

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
}

async function goOfflineEvent() {
  await act(async () => {
    setNavigatorOnline(false);
    window.dispatchEvent(new Event("offline"));
    await new Promise((r) => setTimeout(r, 0));
  });
}

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

let probe: ReturnType<typeof vi.fn<() => Promise<boolean>>>;

beforeEach(() => {
  setNavigatorOnline(true);
  probe = vi.fn(async () => true);
  resetConnectivityForTests(probe);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setNavigatorOnline(true);
});

describe("a false navigator.onLine is a hint, confirmed by a probe (owner 10-31)", () => {
  it("onLine=false with the probe OK: no banner, still online, TanStack not paused", async () => {
    render(<OfflineBanner />);
    await goOfflineEvent();
    await tick();
    expect(probe).toHaveBeenCalled();
    expect(screen.queryByText(BANNER)).toBeNull();
    expect(getConnectivity().online).toBe(true);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it("onLine=false with the probe failing: the banner shows and TanStack pauses", async () => {
    probe.mockResolvedValue(false);
    render(<OfflineBanner />);
    await goOfflineEvent();
    expect(await screen.findByText(BANNER)).toBeTruthy();
    expect(onlineManager.isOnline()).toBe(false);
  });

  it("onLine already false at mount with no event: confirmed by the probe, no banner when it answers", async () => {
    setNavigatorOnline(false);
    render(<OfflineBanner />);
    await tick();
    expect(probe).toHaveBeenCalled();
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it("a probe that throws counts as offline", async () => {
    probe.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<OfflineBanner />);
    await goOfflineEvent();
    expect(await screen.findByText(BANNER)).toBeTruthy();
  });
});

describe("while marked offline it asks again", () => {
  async function confirmedOffline() {
    probe.mockResolvedValue(false);
    render(<OfflineBanner />);
    await goOfflineEvent();
    await screen.findByText(BANNER);
    probe.mockClear();
    probe.mockResolvedValue(true);
  }

  it("on window focus", async () => {
    await confirmedOffline();
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(screen.queryByText(BANNER)).toBeNull());
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("on the 'online' event", async () => {
    await confirmedOffline();
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(screen.queryByText(BANNER)).toBeNull());
  });

  it(`every ${OFFLINE_REPROBE_MS / 1000} s, and stops once back online`, async () => {
    // Fake timers first, so the re-probe interval is created on them.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await confirmedOffline();
      probe.mockResolvedValue(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(OFFLINE_REPROBE_MS); });
      expect(probe).toHaveBeenCalledTimes(1);
      probe.mockResolvedValue(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(OFFLINE_REPROBE_MS); });
      expect(probe).toHaveBeenCalledTimes(2);
      expect(getConnectivity().online).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(OFFLINE_REPROBE_MS * 3); });
      expect(probe).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("any answered request flips it back to online at once", async () => {
    await confirmedOffline();
    act(() => noteReachable());
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it("the Supabase client's fetch wrapper notes an answered request (any status)", async () => {
    await confirmedOffline();
    const wrapped = noteReachableFetch(async () => new Response("", { status: 500 }));
    await act(async () => { await wrapped("https://x/rest/v1/jobs"); });
    expect(getConnectivity().online).toBe(true);
  });

  it("a request that fails on the network does not flip it", async () => {
    await confirmedOffline();
    const wrapped = noteReachableFetch(async () => { throw new TypeError("Failed to fetch"); });
    await act(async () => { await wrapped("https://x/rest/v1/jobs").catch(() => {}); });
    expect(getConnectivity().online).toBe(false);
  });
});

describe("full-page error screens say offline only when it is confirmed", () => {
  const Boom = (): never => {
    throw new Error("render failed");
  };

  it("RouteErrorBoundary: onLine=false, probe OK -> the problem card, not 'You're offline.'", async () => {
    render(<OfflineBanner />);
    await goOfflineEvent();
    await tick();
    render(
      <MemoryRouter>
        <RouteErrorBoundary><Boom /></RouteErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText("This page hit a problem.")).toBeTruthy();
    expect(screen.queryByText("You're offline.")).toBeNull();
  });

  it("RouteErrorBoundary: offline confirmed -> 'You're offline.'", async () => {
    probe.mockResolvedValue(false);
    render(<OfflineBanner />);
    await goOfflineEvent();
    await screen.findByText(BANNER);
    render(
      <MemoryRouter>
        <RouteErrorBoundary><Boom /></RouteErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText("You're offline.")).toBeTruthy();
  });

  it("ErrorBoundary: onLine=false, probe OK -> not 'You're offline.'", async () => {
    render(<OfflineBanner />);
    await goOfflineEvent();
    await tick();
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.queryByText("You're offline.")).toBeNull();
    expect(screen.getByText("Something went sideways.")).toBeTruthy();
  });

  it("ErrorBoundary: offline confirmed -> 'You're offline.'", async () => {
    probe.mockResolvedValue(false);
    render(<OfflineBanner />);
    await goOfflineEvent();
    await screen.findByText(BANNER);
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText("You're offline.")).toBeTruthy();
  });
});

// Each line plants the old defect; a test above must go red.
// @mutate src/lib/connectivity.ts | window.addEventListener("offline", () => void confirmConnectivity()); | window.addEventListener("offline", () => setConnectivity(false));
// @mutate src/lib/connectivity.ts |     setConnectivity(ok);\n  })().finally | setConnectivity(false);\n  })().finally
// @mutate src/lib/connectivity.ts |   window.addEventListener("focus", () => { | window.addEventListener("blur", () => {
// @mutate src/lib/connectivity.ts | reprobeTimer = setInterval(() => void confirmConnectivity(), OFFLINE_REPROBE_MS); | reprobeTimer = setInterval(() => undefined, OFFLINE_REPROBE_MS);
// @mutate src/lib/connectivity.ts |     const res = await fetchImpl(input, init);\n    noteReachable(); |     const res = await fetchImpl(input, init);
// @mutate src/lib/queryClient.ts |     setOnline(getConnectivity().online);\n    return subscribeConnectivity(() => setOnline(getConnectivity().online)); |     return () => {};
// @mutate src/components/RouteErrorBoundary.tsx |     const offline = isConfirmedOffline(); |     const offline = navigator.onLine === false;
// @mutate src/components/ErrorBoundary.tsx |       const offline = isConfirmedOffline(); |       const offline = navigator.onLine === false;
