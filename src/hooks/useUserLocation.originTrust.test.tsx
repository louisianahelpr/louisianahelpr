/**
 * THE WRITE SIDE AND THE READ SIDE OF THE 2026-09-19 DISTANCE DEFECT.
 *
 * Owner, with a screenshot of /dashboard: "im not sure about the timer thing
 * and the miles?? why is this showing here it hasnt before" — four browse
 * cards reading 1634 / 1813 / 1797 / 1731 miles for jobs in Louisiana.
 *
 * Proven against prod: the account's `profiles` row held
 * 37.47282350893211 / -122.2443517921565 — Menlo Park, California — written
 * that same day by `persistUserLocation`, from a `navigator.geolocation`
 * SUCCESS. The browser could see no GPS, Wi-Fi or cell, so it answered from
 * the egress IP. Nothing in this hook looked at `coords.accuracy`, and
 * nothing asked whether the answer was inside the area this app serves.
 *
 * `geo.trip.test.ts` proves those four numbers follow from that coordinate.
 * This file proves the coordinate can no longer get in, and — because the row
 * is already written for at least one real account — that it is no longer
 * believed on the way back out either.
 *
 * Module state note (same as useUserLocation.test.tsx): the hook keeps a
 * module-scoped `cached`, so every test does vi.resetModules() + a dynamic
 * import to start clean.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const requestMock = vi.fn();
vi.mock("@/hooks/usePermissionRationale", () => ({
  usePermissionRationale: () => ({ request: requestMock }),
}));

let profileMock: Record<string, unknown> | null = null;
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ profile: profileMock }),
}));

const resolveParishByZipMock = vi.fn();
vi.mock("@/lib/parishLookup", () => ({
  resolveParishByZip: (zip: string) => resolveParishByZipMock(zip),
}));

/**
 * THE ASSERTION THAT MATTERS MOST IN THIS FILE.
 *
 * `profiles.latitude/longitude` is documented in persistUserLocation.ts as
 * holding "A PRECISE DEVICE FIX, and nothing else", and it is read by the
 * saved-search radius tier, applicant proximity and get_neighbor_hire_count —
 * a sub-mile neighbour test. A Bay Area coordinate in those columns is not a
 * cosmetic defect, so the gate is proven by counting the write, not only by
 * inspecting what the hook returns.
 */
const persistMock = vi.fn();
vi.mock("@/lib/persistUserLocation", () => ({
  persistUserLocation: (lat: number, lng: number) => persistMock(lat, lng),
}));

/** Verbatim from prod, 2026-09-19. Menlo Park, California. */
const MENLO_PARK = { lat: 37.47282350893211, lng: -122.2443517921565 };
/** Erath, Louisiana — the ZIP the same row carried all along. */
const OWNER_ZIP = "70528";
/** getParishCentroid("Vermilion"), the honest answer for that ZIP. */
const VERMILION = { lat: 29.8732, lng: -92.2987 };
/** A real fix in Baton Rouge, for the control case. */
const BATON_ROUGE = { lat: 30.4515, lng: -91.1871 };

const originalGeolocation = navigator.geolocation;
let getCurrentPosition: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  requestMock.mockReset();
  persistMock.mockReset();
  resolveParishByZipMock.mockReset();
  profileMock = null;
  getCurrentPosition = vi.fn();
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    writable: true,
    value: { getCurrentPosition },
  });
  // The rationale gate is a pre-prompt, not the subject here: always granted,
  // and it is what actually invokes the geolocation read.
  requestMock.mockImplementation(async (_kind: string, run: () => unknown) => {
    await run();
    return true;
  });
});

afterEach(() => {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    writable: true,
    value: originalGeolocation,
  });
});

/** Answer the next getCurrentPosition with this position. */
function answerWith(coords: { lat: number; lng: number; accuracy?: number }) {
  getCurrentPosition.mockImplementation((ok: (p: unknown) => void) => {
    ok({
      coords: {
        latitude: coords.lat,
        longitude: coords.lng,
        ...(coords.accuracy === undefined ? {} : { accuracy: coords.accuracy }),
      },
    });
  });
}

async function load() {
  return await import("./useUserLocation");
}

describe("an out-of-service-area 'success' is not a fix (the write side)", () => {
  it("never persists the Menlo Park coordinate to profiles.latitude/longitude", async () => {
    profileMock = { zip_code: OWNER_ZIP, parish: "Vermilion" };
    resolveParishByZipMock.mockResolvedValue({ status: "resolved", parish: "Vermilion" });
    answerWith({ ...MENLO_PARK, accuracy: 65 });

    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("keeps it out of the module cache that feeds the distance pill", async () => {
    profileMock = { zip_code: OWNER_ZIP, parish: "Vermilion" };
    resolveParishByZipMock.mockResolvedValue({ status: "resolved", parish: "Vermilion" });
    answerWith({ ...MENLO_PARK, accuracy: 65 });

    const { useUserLocation, getCachedUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(getCachedUserLocation()).toBeNull();
  });

  it("answers with the account's own ZIP instead, flagged approximate", async () => {
    profileMock = { zip_code: OWNER_ZIP, parish: "Vermilion" };
    resolveParishByZipMock.mockResolvedValue({ status: "resolved", parish: "Vermilion" });
    answerWith({ ...MENLO_PARK, accuracy: 65 });

    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    const state = result.current;
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.lat).toBeCloseTo(VERMILION.lat, 3);
    expect(state.lng).toBeCloseTo(VERMILION.lng, 3);
    expect(state.source).toBe("zip");
    expect(state.approximate).toBe(true);
  });

  it("refuses a coarse fix even when it IS in Louisiana — an IP answer is not a fix", async () => {
    // Same Baton Rouge point, but the platform says ±45km. That is not a
    // position anyone may quote a mileage from.
    profileMock = null;
    answerWith({ ...BATON_ROUGE, accuracy: 45_000 });

    const { useUserLocation, getCachedUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(persistMock).not.toHaveBeenCalled();
    expect(getCachedUserLocation()).toBeNull();
  });

  it("still accepts, caches and persists a real Louisiana fix", async () => {
    // The control. If this ever goes red the gates are too tight and every
    // radius filter in the app has quietly stopped working.
    answerWith({ ...BATON_ROUGE, accuracy: 30 });

    const { useUserLocation, getCachedUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    const state = result.current;
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.source).toBe("device");
    expect(state.approximate).toBe(false);
    expect(getCachedUserLocation()).toEqual({ lat: BATON_ROUGE.lat, lng: BATON_ROUGE.lng });
    expect(persistMock).toHaveBeenCalledWith(BATON_ROUGE.lat, BATON_ROUGE.lng);
  });

  it("still accepts a fix from a platform that reports no accuracy at all", async () => {
    // Capacitor shims and older WebKit builds omit the field. Withholding a
    // real fix over a terse shim would be a worse bug than the one fixed.
    answerWith(BATON_ROUGE);

    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(persistMock).toHaveBeenCalledWith(BATON_ROUGE.lat, BATON_ROUGE.lng);
  });
});

describe("an already-poisoned profile row is not believed (the read side)", () => {
  it("skips a stored out-of-area coordinate and uses the ZIP under it", async () => {
    // EXACTLY the row that was on prod: a California fix and a Louisiana ZIP
    // on the same profile. Before this fix, branch 1 returned the California
    // point as `source: "profile", approximate: false` — a "real fix" — on
    // every load, forever, with no way for the user to clear it.
    profileMock = {
      latitude: String(MENLO_PARK.lat),
      longitude: String(MENLO_PARK.lng),
      zip_code: OWNER_ZIP,
      parish: "Vermilion",
    };
    resolveParishByZipMock.mockResolvedValue({ status: "resolved", parish: "Vermilion" });
    // Device declines, so the derive chain is what answers.
    getCurrentPosition.mockImplementation((_ok: unknown, fail: (e: unknown) => void) => {
      fail({ code: 1, PERMISSION_DENIED: 1 });
    });

    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    const state = result.current;
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.source).toBe("zip");
    expect(state.approximate).toBe(true);
    expect(state.lat).toBeCloseTo(VERMILION.lat, 3);
  });

  it("still trusts a stored Louisiana fix — PostgREST numerics arrive as strings", async () => {
    profileMock = {
      latitude: String(BATON_ROUGE.lat),
      longitude: String(BATON_ROUGE.lng),
      zip_code: OWNER_ZIP,
      parish: "Vermilion",
    };
    getCurrentPosition.mockImplementation((_ok: unknown, fail: (e: unknown) => void) => {
      fail({ code: 1, PERMISSION_DENIED: 1 });
    });

    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    const state = result.current;
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.source).toBe("profile");
    expect(state.approximate).toBe(false);
    expect(resolveParishByZipMock).not.toHaveBeenCalled();
  });
});
