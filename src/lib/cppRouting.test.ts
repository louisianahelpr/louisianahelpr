import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Hoisted mocks so they apply at import time
const navigateMock = vi.fn();
const trackMock = vi.fn();
const recordPpoMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => locationState,
  };
});
vi.mock("@/lib/analytics", () => ({
  AhaEvent: { AppOpenedFromDeepLink: "app_opened_from_deep_link" },
  track: (...args: unknown[]) => trackMock(...args),
}));
vi.mock("@/lib/ppoAttribution", () => ({
  recordPpoAttribution: (...args: unknown[]) => recordPpoMock(...args),
}));

// Mutable per-test location state — the mock above reads this on every render.
let locationState: { pathname: string; search: string; hash: string; state: unknown; key: string } = {
  pathname: "/",
  search: "",
  hash: "",
  state: null,
  key: "default",
};

import { useCppVariantRouter, getActiveCppVariant } from "./cppRouting";

const setLocation = (pathname: string, search = "") => {
  locationState = { pathname, search, hash: "", state: null, key: pathname + search };
};

describe("getActiveCppVariant", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(getActiveCppVariant()).toBeNull();
  });

  it("returns 'poster' when the storage value is 'poster'", () => {
    sessionStorage.setItem("helpr_cpp_variant", "poster");
    expect(getActiveCppVariant()).toBe("poster");
  });

  it("returns 'helper' when the storage value is 'helper'", () => {
    sessionStorage.setItem("helpr_cpp_variant", "helper");
    expect(getActiveCppVariant()).toBe("helper");
  });

  it("returns null on a corrupted storage value", () => {
    sessionStorage.setItem("helpr_cpp_variant", "garbage");
    expect(getActiveCppVariant()).toBeNull();
  });
});

describe("useCppVariantRouter", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    trackMock.mockReset();
    recordPpoMock.mockReset();
    sessionStorage.clear();
  });

  it("always records PPO attribution from the search string", () => {
    setLocation("/", "?utm_source=foo");
    renderHook(() => useCppVariantRouter());
    expect(recordPpoMock).toHaveBeenCalledWith("?utm_source=foo");
  });

  it("does NOT navigate or store when no variant query is present", () => {
    setLocation("/", "");
    renderHook(() => useCppVariantRouter());
    expect(navigateMock).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBeNull();
  });

  it("routes ?cpp=poster to /post-job and persists the variant", () => {
    setLocation("/", "?cpp=poster");
    renderHook(() => useCppVariantRouter());
    expect(navigateMock).toHaveBeenCalledWith("/post-job", { replace: true });
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBe("poster");
    expect(trackMock).toHaveBeenCalledWith(
      "app_opened_from_deep_link",
      expect.objectContaining({ source: "cpp", variant: "poster" }),
    );
  });

  it("routes ?cpp=helper to /signup?intent=helper and persists the variant", () => {
    setLocation("/", "?cpp=helper");
    renderHook(() => useCppVariantRouter());
    expect(navigateMock).toHaveBeenCalledWith("/signup?intent=helper", { replace: true });
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBe("helper");
  });

  it("ignores unknown ?cpp= values (no nav, no analytics)", () => {
    setLocation("/", "?cpp=spammer");
    renderHook(() => useCppVariantRouter());
    expect(navigateMock).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBeNull();
  });

  it("does NOT redirect a user who is on a deep link, even with a valid variant", () => {
    // User followed a job-share link that already routes them — pulling
    // them to /post-job would lose their intent.
    setLocation("/jobs/abc-123", "?cpp=poster");
    renderHook(() => useCppVariantRouter());
    expect(navigateMock).not.toHaveBeenCalled();
    // But we DO still record the variant + fire analytics — the funnel
    // attribution shouldn't be lost just because the user landed deep.
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBe("poster");
    expect(trackMock).toHaveBeenCalledOnce();
  });

  it("treats an unmapped ?ppid= the same as no variant", () => {
    setLocation("/", "?ppid=UNMAPPED_ID_FROM_ASC");
    renderHook(() => useCppVariantRouter());
    expect(navigateMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("helpr_cpp_variant")).toBeNull();
  });

  it("does not throw when sessionStorage is unavailable (private mode)", () => {
    setLocation("/", "?cpp=helper");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private mode disables storage");
    });
    expect(() => renderHook(() => useCppVariantRouter())).not.toThrow();
    // Navigation still proceeds even though storage failed
    expect(navigateMock).toHaveBeenCalledWith("/signup?intent=helper", { replace: true });
    setItemSpy.mockRestore();
  });
});
