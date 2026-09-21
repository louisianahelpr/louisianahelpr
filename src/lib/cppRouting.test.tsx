/*
 * cppRouting handles App Store Connect Custom Product Page (CPP) attribution
 * and the first-launch redirect. Bugs here either drop the attribution
 * (Apple's CPP loop never closes) or return the wrong variant string
 * (downstream tracking lies about which funnel arm a user arrived on).
 *
 * MERGED 2026-09-21 from `cppRouting.test.ts` + `cppRouting.test.tsx`. One
 * 3.4 KB module had grown two near-duplicate suites — ~90% of the cases were
 * the same behaviours written twice, and each registered a DIFFERENT mutation,
 * which is the only reason neither could simply be deleted. Both mutations now
 * live here, so the merge loses no proof.
 *
 * The surviving style is the .tsx one: render inside a real MemoryRouter and
 * assert the RESULTING LOCATION. The deleted .ts twin mocked `useNavigate` and
 * asserted the arguments it was called with, which proves the hook made a call,
 * not that the user ended up anywhere. The one thing that style could see and a
 * plain location check cannot — `replace` vs `push` — is preserved below via
 * `useNavigationType()`, which reads the history effect itself rather than the
 * call: a strictly stronger assertion than the mock-argument one it replaces.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from "react-router-dom";
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
  locationSnapshot = null;
  navTypeSnapshot = null;
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

  it("returns null when sessionStorage READ throws (private mode / SSR)", () => {
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

// Current location and the navigation type that produced it, captured from
// inside the router on every render.
let locationSnapshot: ReturnType<typeof useLocation> | null = null;
let navTypeSnapshot: ReturnType<typeof useNavigationType> | null = null;

function TestHarness({ children }: { children: ReactNode }) {
  locationSnapshot = useLocation();
  navTypeSnapshot = useNavigationType();
  return <>{children}</>;
}

/** Render the hook inside a MemoryRouter at a specific URL. */
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

describe("useCppVariantRouter — query parsing", () => {
  it("does nothing on empty query (no track, no persist, no redirect)", () => {
    renderWithRouter("/");
    // recordPpoAttribution always runs — it is a separate funnel from cpp.
    expect(recordPpoMock).toHaveBeenCalledOnce();
    expect(trackMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBeNull();
    expect(locationSnapshot?.pathname).toBe("/");
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

  it("?cpp=invalid does NOT persist, track, or redirect", () => {
    renderWithRouter("/?cpp=garbage");
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBeNull();
    expect(trackMock).not.toHaveBeenCalled();
    expect(locationSnapshot?.pathname).toBe("/");
  });

  it("unknown ?ppid= does NOT persist, track, or redirect (no PPID_TO_VARIANT entries wired yet)", () => {
    renderWithRouter("/?ppid=UNMAPPED_ID_FROM_ASC");
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBeNull();
    expect(trackMock).not.toHaveBeenCalled();
    expect(locationSnapshot?.pathname).toBe("/");
  });
});

describe("useCppVariantRouter — redirect behavior", () => {
  it("redirects from the bare landing route to the variant route", () => {
    renderWithRouter("/?cpp=poster");
    expect(locationSnapshot?.pathname).toBe("/post-job");
  });

  it("redirects helper variant to /signup?intent=helper", () => {
    renderWithRouter("/?cpp=helper");
    expect(locationSnapshot?.pathname).toBe("/signup");
    expect(locationSnapshot?.search).toBe("?intent=helper");
  });

  it("does NOT redirect from a deep-linked route (only from /)", () => {
    renderWithRouter("/job/abc-123?cpp=helper");
    // The variant is still persisted and tracked — landing deep must not cost
    // us the attribution.
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBe("helper");
    expect(trackMock).toHaveBeenCalled();
    // But the user stays where they meant to go.
    expect(locationSnapshot?.pathname).toBe("/job/abc-123");
  });

  it("REPLACES rather than pushes, so Back does not re-fire the redirect", () => {
    /*
     * The CPP landing must not survive in history. With a push, Back from
     * /post-job returns to /?cpp=poster, the effect runs again and throws the
     * user forward — a trap they cannot leave with the Back button.
     *
     * `useNavigationType()` reports the history action that produced the
     * current entry, so this observes the REPLACE itself. The deleted .ts twin
     * asserted `navigate` was CALLED with `{ replace: true }`; this asserts the
     * history actually got replaced.
     */
    renderWithRouter("/?cpp=poster");
    expect(locationSnapshot?.pathname).toBe("/post-job");
    expect(navTypeSnapshot).toBe("REPLACE");
  });
});

describe("useCppVariantRouter — storage failure", () => {
  it("still redirects when sessionStorage WRITE throws (private mode)", () => {
    // Persistence is best-effort; routing the user is not.
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private mode disables storage");
    });
    try {
      expect(() => renderWithRouter("/?cpp=helper")).not.toThrow();
      expect(locationSnapshot?.pathname).toBe("/signup");
      expect(locationSnapshot?.search).toBe("?intent=helper");
      expect(trackMock).toHaveBeenCalledOnce();
    } finally {
      setItemSpy.mockRestore();
    }
  });
});

describe("useCppVariantRouter — PPO recording", () => {
  it("always calls recordPpoAttribution with the search string (CPP and PPO are independent funnels)", () => {
    renderWithRouter("/?utm_source=fb");
    expect(recordPpoMock).toHaveBeenCalledOnce();
    expect(recordPpoMock).toHaveBeenCalledWith("?utm_source=fb");
  });

  it("records PPO even when ?cpp= is present (both can coexist)", () => {
    renderWithRouter("/?cpp=poster&ppo_test=trust&ppo_arm=treatment");
    expect(recordPpoMock).toHaveBeenCalledOnce();
    expect(trackMock).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBe("poster");
  });
});

// Redirect ONLY from the bare landing route. Without the gate a ?cpp= on any
// deep link (a shared job URL, a push landing) yanks the user to /post-job.
// @mutate src/lib/cppRouting.ts | if (location.pathname === "/" \|\| location.pathname === "") { | if (true) {
// And it must REPLACE: without it the CPP landing stays in history, so Back
// from /post-job returns to /?cpp=poster and the effect fires again.
// @mutate src/lib/cppRouting.ts | navigate(VARIANT_ROUTES[variant], { replace: true }); | navigate(VARIANT_ROUTES[variant]);
