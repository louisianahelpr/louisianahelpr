// usePrefetchUserData warms caches for likely-next-tapped screens after
// the Dashboard mounts. Bugs here either fire prefetches before the
// dashboard finishes loading (slows initial paint) or never fire (next-
// nav feels sluggish).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const fetchReferralMock = vi.fn();
const prefetchActivityCoresMock = vi.fn();
const prefetchRouteMock = vi.fn();

vi.mock("@/hooks/useReferralData", () => ({
  fetchReferralData: (...args: unknown[]) => fetchReferralMock(...args),
}));
vi.mock("@/hooks/useActivityData", () => ({
  prefetchActivityCores: (...args: unknown[]) => prefetchActivityCoresMock(...args),
}));
vi.mock("@/lib/routePrefetch", () => ({
  prefetchRoute: (...args: unknown[]) => prefetchRouteMock(...args),
}));

import { usePrefetchUserData } from "./usePrefetchUserData";

let originalRIC: typeof window.requestIdleCallback | undefined;

beforeEach(() => {
  fetchReferralMock.mockReset().mockResolvedValue({});
  prefetchActivityCoresMock.mockReset();
  prefetchRouteMock.mockReset();
  // Default: requestIdleCallback present and runs synchronously
  originalRIC = window.requestIdleCallback;
  Object.defineProperty(window, "requestIdleCallback", {
    configurable: true,
    writable: true,
    value: (cb: () => void) => {
      cb();
      return 0;
    },
  });
});

afterEach(() => {
  if (originalRIC) {
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      writable: true,
      value: originalRIC,
    });
  } else {
    Reflect.deleteProperty(window, "requestIdleCallback");
  }
});

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, client };
}

describe("usePrefetchUserData", () => {
  it("does NOT prefetch when userId is undefined", () => {
    const { wrapper } = makeWrapper();
    renderHook(() => usePrefetchUserData(undefined), { wrapper });
    expect(fetchReferralMock).not.toHaveBeenCalled();
    expect(prefetchActivityCoresMock).not.toHaveBeenCalled();
    expect(prefetchRouteMock).not.toHaveBeenCalled();
  });

  it("prefetches referral + activity data with the userId when provided", () => {
    const { wrapper } = makeWrapper();
    renderHook(() => usePrefetchUserData("user-1"), { wrapper });

    expect(fetchReferralMock).toHaveBeenCalledWith("user-1");
    expect(prefetchActivityCoresMock).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("prefetches all 4 likely-next-nav routes (my-posts, my-jobs, jobs, profile)", () => {
    const { wrapper } = makeWrapper();
    renderHook(() => usePrefetchUserData("user-1"), { wrapper });

    const routes = prefetchRouteMock.mock.calls.map((c) => c[0]);
    expect(routes).toContain("/my-posts");
    expect(routes).toContain("/my-jobs");
    expect(routes).toContain("/jobs");
    expect(routes).toContain("/profile");
  });

  it("falls back to setTimeout when requestIdleCallback unavailable", () => {
    Reflect.deleteProperty(window, "requestIdleCallback");
    vi.useFakeTimers();
    const { wrapper } = makeWrapper();
    renderHook(() => usePrefetchUserData("user-1"), { wrapper });

    // Before timeout: nothing fired
    expect(fetchReferralMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    // After 400ms timeout: fired
    expect(fetchReferralMock).toHaveBeenCalledWith("user-1");
    vi.useRealTimers();
  });

  it("re-prefetches when userId changes (account swap)", () => {
    const { wrapper } = makeWrapper();
    const { rerender } = renderHook(
      ({ uid }) => usePrefetchUserData(uid),
      { wrapper, initialProps: { uid: "user-1" as string | undefined } },
    );

    expect(fetchReferralMock).toHaveBeenCalledWith("user-1");

    rerender({ uid: "user-2" });
    expect(fetchReferralMock).toHaveBeenCalledWith("user-2");
    expect(fetchReferralMock).toHaveBeenCalledTimes(2);
  });
});
