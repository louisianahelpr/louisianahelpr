// cppRouting handles App Store Connect Custom Product Page (CPP)
// attribution + redirects on first launch. The pure helper
// getActiveCppVariant is the read side that downstream analytics
// events use to tag funnel-arm conversions. Bugs here either drop
// the attribution (Apple's CPP loop never closes) or return wrong
// variant strings (downstream tracking lies about which arm a user
// came in on).
//
// useCppVariantRouter is a hook that depends on react-router-dom,
// analytics, and PPO attribution. Test through behavior in a
// MemoryRouter — the heavy lifting (PPID lookup, redirect to
// variant-specific route, sessionStorage persistence) all runs
// inside the useEffect.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useCppVariantRouter, getActiveCppVariant } from "./cppRouting";

const trackMock = vi.fn();
vi.mock("@/lib/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
  AhaEvent: { AppOpenedFromDeepLink: "AppOpenedFromDeepLink" },
}));

const recordPpoMock = vi.fn();
vi.mock("@/lib/ppoAttribution", () => ({
  recordPpoAttribution: (...args: unknown[]) => recordPpoMock(...args),
}));

beforeEach(() => {
  sessionStorage.clear();
  trackMock.mockReset();
  recordPpoMock.mockReset();
});

describe("getActiveCppVariant", () => {
  it("returns null when nothing persisted", () => {
    expect(getActiveCppVariant()).toBeNull();
  });

  it("returns 'poster' when poster is persisted", () => {
    sessionStorage.setItem("helpr_cpp_variant", "poster");
    expect(getActiveCppVariant()).toBe("poster");
  });

  it("returns 'helper' when helper is persisted", () => {
    sessionStorage.setItem("helpr_cpp_variant", "helper");
    expect(getActiveCppVariant()).toBe("helper");
  });

  it("returns null for any other persisted value (defensive — old keys, corruption)", () => {
    sessionStorage.setItem("helpr_cpp_variant", "garbage");
    expect(getActiveCppVariant()).toBeNull();
  });

  it("returns null when sessionStorage throws (private mode / SSR)", () => {
    const originalGet = sessionStorage.getItem.bind(sessionStorage);
    Object.defineProperty(window.sessionStorage, "getItem", {
      configurable: true,
      value: () => {
        throw new Error("sessionStorage unavailable");
      },
    });
    try {
      expect(getActiveCppVariant()).toBeNull();
    } finally {
      Object.defineProperty(window.sessionStorage, "getItem", {
        configurable: true,
        value: originalGet,
      });
    }
  });
});

// Helper to render the hook inside a MemoryRouter at a specific URL.
function renderWithRouter(initialUrl: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route path="*" element={<TestHarness>{children}</TestHarness>} />
      </Routes>
    </MemoryRouter>
  );
  return renderHook(() => useCppVariantRouter(), { wrapper });
}

// Inner harness that exposes the current location to assertions
let locationSnapshot: ReturnType<typeof useLocation> | null = null;
function TestHarness({ children }: { children: ReactNode }) {
  locationSnapshot = useLocation();
  return <>{children}</>;
}

describe("useCppVariantRouter — query parsing", () => {
  it("does nothing on empty query (no track, no PPO recording, no redirect)", () => {
    renderWithRouter("/");
    // recordPpoAttribution always runs (it's separate from cpp logic)
    expect(recordPpoMock).toHaveBeenCalledOnce();
    // No CPP track event because no variant in query
    expect(trackMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBeNull();
  });

  it("?cpp=poster persists variant + fires track", () => {
    renderWithRouter("/?cpp=poster");
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBe("poster");
    expect(trackMock).toHaveBeenCalledOnce();
    expect(trackMock).toHaveBeenCalledWith("AppOpenedFromDeepLink", {
      source: "cpp",
      variant: "poster",
    });
  });

  it("?cpp=helper persists variant + fires track", () => {
    renderWithRouter("/?cpp=helper");
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBe("helper");
    expect(trackMock).toHaveBeenCalledWith("AppOpenedFromDeepLink", {
      source: "cpp",
      variant: "helper",
    });
  });

  it("?cpp=invalid does NOT persist or track", () => {
    renderWithRouter("/?cpp=garbage");
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBeNull();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("unknown ?ppid= does NOT persist or track (no PPID_TO_VARIANT entries wired yet)", () => {
    renderWithRouter("/?ppid=POSTER_PPID_PLACEHOLDER");
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBeNull();
    expect(trackMock).not.toHaveBeenCalled();
  });
});

describe("useCppVariantRouter — redirect behavior", () => {
  it("redirects from bare landing route to variant-specific route", async () => {
    renderWithRouter("/?cpp=poster");
    // After useEffect, the router should have replaced /?cpp=poster with /post-job
    expect(locationSnapshot?.pathname).toBe("/post-job");
  });

  it("does NOT redirect from a deep-linked route (only from /)", () => {
    renderWithRouter("/job/abc-123?cpp=helper");
    // Variant still gets persisted + tracked
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBe("helper");
    expect(trackMock).toHaveBeenCalled();
    // But the user stays on their deep link — no redirect
    expect(locationSnapshot?.pathname).toBe("/job/abc-123");
  });

  it("redirects helper variant to /signup?intent=helper", () => {
    renderWithRouter("/?cpp=helper");
    expect(locationSnapshot?.pathname).toBe("/signup");
    expect(locationSnapshot?.search).toBe("?intent=helper");
  });
});

describe("useCppVariantRouter — PPO recording", () => {
  it("always calls recordPpoAttribution with the search string (CPP and PPO are independent funnels)", () => {
    renderWithRouter("/?utm_source=fb");
    expect(recordPpoMock).toHaveBeenCalledOnce();
    expect(recordPpoMock).toHaveBeenCalledWith("?utm_source=fb");
  });

  it("recordPpoAttribution still runs when ?cpp= is present (both can coexist)", () => {
    renderWithRouter("/?cpp=poster&ppo_test=trust&ppo_arm=treatment");
    expect(recordPpoMock).toHaveBeenCalledOnce();
    expect(trackMock).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBe("poster");
  });
});
