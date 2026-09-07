// useUserLocation requests browser geolocation through the rationale-
// dialog gate. Module has a module-scoped `cached` value that persists
// across hook calls, so each test does vi.resetModules() + dynamic
// import to start with a clean cache.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const requestMock = vi.fn();
vi.mock("@/hooks/usePermissionRationale", () => ({
  usePermissionRationale: () => ({ request: requestMock }),
}));

// The hook now falls back to the profile when the device won't answer, so it
// reads `useCurrentUser` — a React Query consumer these tests render without a
// QueryClientProvider. `profileMock` is the profile under test; the default
// (null) reproduces the old behaviour exactly, so every pre-existing
// expectation about `status: "error"` still means what it used to.
let profileMock: Record<string, unknown> | null = null;
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ profile: profileMock }),
}));

// The ZIP branch goes through the real RPC wrapper; stub it at the boundary.
const resolveParishByZipMock = vi.fn();
vi.mock("@/lib/parishLookup", () => ({
  resolveParishByZip: (zip: string) => resolveParishByZipMock(zip),
}));

const originalGeolocation = navigator.geolocation;

beforeEach(() => {
  vi.resetModules();
  requestMock.mockReset();
  profileMock = null;
  resolveParishByZipMock.mockReset();
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    writable: true,
    value: { getCurrentPosition: vi.fn() },
  });
});

afterEach(() => {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    writable: true,
    value: originalGeolocation,
  });
});

async function load() {
  return await import("./useUserLocation");
}

describe("useUserLocation", () => {
  it("returns idle when enabled=false (no fetch attempt)", async () => {
    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(false));
    expect(result.current.status).toBe("idle");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("returns error when geolocation API is missing", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));
    // Now settles a tick later: the fallback chain is consulted first and only
    // reports the device error once it has come back empty (profileMock=null).
    await waitFor(() => expect(result.current.status).toBe("error"));
    if (result.current.status === "error") {
      expect(result.current.message).toMatch(/not supported/i);
    }
  });

  it("returns 'permission declined' error when rationale is denied", async () => {
    requestMock.mockResolvedValue(false);
    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("error"));
    if (result.current.status === "error") {
      expect(result.current.message).toMatch(/declined/i);
    }
  });

  it("returns ready with coords when getCurrentPosition succeeds", async () => {
    requestMock.mockImplementation(async (_kind, runNativeCall) => {
      await runNativeCall();
      return true;
    });
    const getCurrentPositionMock = vi
      .fn()
      .mockImplementation(
        (success: (pos: GeolocationPosition) => void) => {
          success({
            coords: {
              latitude: 30.45,
              longitude: -91.18,
              accuracy: 10,
            },
          } as GeolocationPosition);
        },
      );
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      writable: true,
      value: { getCurrentPosition: getCurrentPositionMock },
    });

    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status === "ready") {
      expect(result.current.lat).toBe(30.45);
      expect(result.current.lng).toBe(-91.18);
    }
  });

  it("returns 'permission denied' error when geolocation rejects with PERMISSION_DENIED", async () => {
    requestMock.mockImplementation(async (_kind, runNativeCall) => {
      await runNativeCall();
      return true;
    });
    const getCurrentPositionMock = vi
      .fn()
      .mockImplementation(
        (
          _success: unknown,
          error: (e: { code: number; PERMISSION_DENIED: number }) => void,
        ) => {
          error({ code: 1, PERMISSION_DENIED: 1 });
        },
      );
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      writable: true,
      value: { getCurrentPosition: getCurrentPositionMock },
    });

    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("error"));
    if (result.current.status === "error") {
      expect(result.current.message).toMatch(/permission denied/i);
    }
  });

  it("returns generic error when geolocation rejects with non-permission code", async () => {
    requestMock.mockImplementation(async (_kind, runNativeCall) => {
      await runNativeCall();
      return true;
    });
    const getCurrentPositionMock = vi
      .fn()
      .mockImplementation(
        (
          _success: unknown,
          error: (e: { code: number; PERMISSION_DENIED: number }) => void,
        ) => {
          error({ code: 2, PERMISSION_DENIED: 1 }); // POSITION_UNAVAILABLE
        },
      );
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      writable: true,
      value: { getCurrentPosition: getCurrentPositionMock },
    });

    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("error"));
    if (result.current.status === "error") {
      expect(result.current.message).toMatch(/couldn't get/i);
    }
  });

  it("calls request() with kind='location' (the rationale dialog config key)", async () => {
    requestMock.mockResolvedValue(false);
    const { useUserLocation } = await load();
    renderHook(() => useUserLocation(true));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(requestMock.mock.calls[0][0]).toBe("location");
  });

  /**
   * GEODATA FIRST, SIGNUP ZIP SECOND, NEVER "we don't know" WHILE A ZIP IS ON
   * FILE.
   *
   * Measured against prod 2026-09-06: of 8 profiles only 2 carry
   * latitude/longitude, 4 more carry a zip_code that resolves to a parish we
   * hold a centroid for, 1 has only a parish, and 1 has nothing. Before this
   * chain existed, six of those eight got `status: "error"` the moment the
   * device declined — so the radius filter silently kept every job while the
   * account's own signup ZIP sat unread.
   */
  describe("fallback chain when the device won't answer", () => {
    /** Every case below denies the device, which is the whole premise. */
    beforeEach(() => {
      requestMock.mockResolvedValue(false);
    });

    it("prefers real geodata on the profile, and does NOT call it approximate", async () => {
      profileMock = { latitude: 30.4515, longitude: -91.1871, zip_code: "70801" };
      const { useUserLocation } = await load();
      const { result } = renderHook(() => useUserLocation(true));

      await waitFor(() => expect(result.current.status).toBe("ready"));
      if (result.current.status === "ready") {
        expect(result.current.source).toBe("profile");
        expect(result.current.approximate).toBe(false);
        expect(result.current.lat).toBeCloseTo(30.4515, 4);
      }
      // Geodata outranks the ZIP, so the ZIP lookup must never have run.
      expect(resolveParishByZipMock).not.toHaveBeenCalled();
    });

    it("coerces numeric columns that PostgREST hands back as strings", async () => {
      // profiles.latitude/longitude are `numeric`, which arrives as a STRING.
      // A typeof-number check here would skip the branch for every real row —
      // the whole fallback would be dead in production and green in tests.
      profileMock = { latitude: "30.4515", longitude: "-91.1871" };
      const { useUserLocation } = await load();
      const { result } = renderHook(() => useUserLocation(true));

      await waitFor(() => expect(result.current.status).toBe("ready"));
      if (result.current.status === "ready") {
        expect(result.current.source).toBe("profile");
        expect(result.current.lng).toBeCloseTo(-91.1871, 4);
      }
    });

    it("falls back to the signup ZIP, flagged approximate", async () => {
      profileMock = { latitude: null, longitude: null, zip_code: "70801" };
      resolveParishByZipMock.mockResolvedValue({ status: "resolved", parish: "East Baton Rouge" });
      const { useUserLocation } = await load();
      const { result } = renderHook(() => useUserLocation(true));

      await waitFor(() => expect(result.current.status).toBe("ready"));
      if (result.current.status === "ready") {
        expect(result.current.source).toBe("zip");
        // A centroid is parish-scale, so no surface may quote it as a fix.
        expect(result.current.approximate).toBe(true);
      }
      expect(resolveParishByZipMock).toHaveBeenCalledWith("70801");
    });

    it("uses the parish when there is no ZIP", async () => {
      profileMock = { latitude: null, longitude: null, zip_code: null, parish: "Orleans" };
      const { useUserLocation } = await load();
      const { result } = renderHook(() => useUserLocation(true));

      await waitFor(() => expect(result.current.status).toBe("ready"));
      if (result.current.status === "ready") {
        expect(result.current.source).toBe("parish");
        expect(result.current.approximate).toBe(true);
      }
    });

    it("stays honest when nothing can be derived — a null parish is not an answer", async () => {
      // THE ORIGINAL DEFECT, asserted from the other side: with nothing on the
      // profile we must still say "no radius could run" rather than inventing
      // a position. The toolbar reads this to avoid claiming a filter ran.
      profileMock = { latitude: null, longitude: null, zip_code: null, parish: null };
      const { useUserLocation } = await load();
      const { result } = renderHook(() => useUserLocation(true));

      await waitFor(() => expect(result.current.status).toBe("error"));
    });

    it("does not invent a position from an out-of-state ZIP", async () => {
      profileMock = { latitude: null, longitude: null, zip_code: "77002", parish: null };
      resolveParishByZipMock.mockResolvedValue({ status: "unknown-zip", zip: "77002" });
      const { useUserLocation } = await load();
      const { result } = renderHook(() => useUserLocation(true));

      await waitFor(() => expect(result.current.status).toBe("error"));
    });

    it("survives a broken ZIP lookup without hanging on loading", async () => {
      profileMock = { latitude: null, longitude: null, zip_code: "70801", parish: null };
      resolveParishByZipMock.mockRejectedValue(new Error("rpc down"));
      const { useUserLocation } = await load();
      const { result } = renderHook(() => useUserLocation(true));

      await waitFor(() => expect(result.current.status).toBe("error"));
    });
  });
});
