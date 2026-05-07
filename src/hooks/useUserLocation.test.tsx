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

const originalGeolocation = navigator.geolocation;

beforeEach(() => {
  vi.resetModules();
  requestMock.mockReset();
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
    expect(result.current.status).toBe("error");
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
});
