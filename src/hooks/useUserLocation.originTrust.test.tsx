/**
 * WHAT THIS HOOK IS ALLOWED TO DO WITH A POSITION IT RECEIVED.
 *
 * ── THE REPORT, AND THE DIAGNOSIS THAT WAS WRONG ───────────────────────────
 * Owner, 2026-09-19, /home: "im not sure about the timer thing and the
 * miles?? why is this showing here it hasnt before" — four browse cards
 * reading 1634 / 1813 / 1797 / 1731 miles for jobs in Louisiana.
 *
 * The account's `profiles` row held 37.47282350893211 / -122.2443517921565 —
 * Menlo Park, California — beside a Louisiana ZIP. That is the exact signature
 * of a browser answering the geolocation SUCCESS callback from its egress IP,
 * so fecdbf6e7 added a service-area gate and this file asserted, test by test,
 * that the Menlo Park coordinate must reach neither the module cache nor
 * `profiles`.
 *
 * THE OWNER WAS IN MENLO PARK. "Yes I'm in Menlo Park rn."
 *
 * Those assertions were wrong, and the code they guarded was worse than the
 * pill it fixed: it threw away a real position and substituted the signup
 * ZIP's parish centroid, so a user standing in California would have been
 * given Erath, Louisiana as their origin — for the distance pill, and also for
 * server-side radius search, applicant proximity and get_neighbor_hire_count's
 * sub-mile neighbour test. They are inverted here rather than deleted, because
 * the lesson is worth keeping: GEOGRAPHY IS NOT EVIDENCE ABOUT A FIX. A
 * latitude cannot tell a travelling helpr from an IP guess, so no threshold on
 * it is correct, and a gate that discards a true position fails closed into a
 * confident lie.
 *
 * ── WHAT IS STILL GUARDED ──────────────────────────────────────────────────
 * Accuracy survives, because the platform reporting its own confidence IS
 * evidence — but only as a DEMOTION. A coarse fix is kept, cached and
 * surfaced, flagged `approximate`, and withheld from
 * `profiles.latitude/longitude` alone: those columns are documented in
 * persistUserLocation.ts as "A PRECISE DEVICE FIX, and nothing else" and
 * get_neighbor_hire_count runs a sub-mile test on them, so the cost of
 * storing a 45 km-accurate point there is a broken neighbour test, while the
 * cost of declining to store it is nothing at all.
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

/** Verbatim from prod, 2026-09-19. Menlo Park, California — and CORRECT. */
const MENLO_PARK = { lat: 37.47282350893211, lng: -122.2443517921565 };
/** Erath, Louisiana — the signup ZIP on the same row. The fallback, not the truth. */
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

describe("a position we received is a position we keep (the write side)", () => {
  it("SURFACES the Menlo Park coordinate — the owner really is there", async () => {
    // The inversion of the original assertion. The old gate answered this case
    // with the Vermilion centroid, i.e. told a user in California that they
    // were in Erath, Louisiana.
    profileMock = { zip_code: OWNER_ZIP, parish: "Vermilion" };
    resolveParishByZipMock.mockResolvedValue({ status: "resolved", parish: "Vermilion" });
    answerWith({ ...MENLO_PARK, accuracy: 65 });

    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    const state = result.current;
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.lat).toBe(MENLO_PARK.lat);
    expect(state.lng).toBe(MENLO_PARK.lng);
    expect(state.source).toBe("device");
    expect(state.approximate).toBe(false);
    // The ZIP fallback is not even consulted: there was nothing to fall back
    // from.
    expect(resolveParishByZipMock).not.toHaveBeenCalled();
  });

  it("caches it, so every distance surface measures from where the user IS", async () => {
    profileMock = { zip_code: OWNER_ZIP, parish: "Vermilion" };
    answerWith({ ...MENLO_PARK, accuracy: 65 });

    const { useUserLocation, getCachedUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(getCachedUserLocation()).toEqual({ lat: MENLO_PARK.lat, lng: MENLO_PARK.lng });
  });

  it("persists it, because a precise fix is a precise fix wherever it is", async () => {
    profileMock = { zip_code: OWNER_ZIP, parish: "Vermilion" };
    answerWith({ ...MENLO_PARK, accuracy: 65 });

    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(persistMock).toHaveBeenCalledWith(MENLO_PARK.lat, MENLO_PARK.lng);
  });

  it("KEEPS a coarse fix and uses it, instead of throwing it away", async () => {
    // The Baton Rouge point, but the platform says ±45km. The old code routed
    // this to failWith, i.e. replaced a roughly-right position with a
    // different place entirely. A rough "here" beats an invented "here".
    profileMock = { zip_code: OWNER_ZIP, parish: "Vermilion" };
    resolveParishByZipMock.mockResolvedValue({ status: "resolved", parish: "Vermilion" });
    answerWith({ ...BATON_ROUGE, accuracy: 45_000 });

    const { useUserLocation, getCachedUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    const state = result.current;
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.lat).toBe(BATON_ROUGE.lat);
    expect(state.lng).toBe(BATON_ROUGE.lng);
    expect(state.source).toBe("device");
    expect(getCachedUserLocation()).toEqual({ lat: BATON_ROUGE.lat, lng: BATON_ROUGE.lng });
  });

  it("but FLAGS it approximate, so nothing quotes it as a measurement", async () => {
    answerWith({ ...BATON_ROUGE, accuracy: 45_000 });

    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    const state = result.current;
    if (state.status !== "ready") throw new Error("expected ready");
    expect(state.approximate).toBe(true);
  });

  it("and keeps it OUT of the precise-fix columns — the one thing accuracy gates", async () => {
    // persistUserLocation.ts: "A PRECISE DEVICE FIX, and nothing else".
    // get_neighbor_hire_count runs a sub-mile test against those columns, so a
    // 45km-accurate point stored there would report half a city as one
    // another's neighbours.
    answerWith({ ...BATON_ROUGE, accuracy: 45_000 });

    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("still accepts, caches and persists a real Louisiana fix", async () => {
    // The control. If this ever goes red the radius filter has quietly stopped
    // working for everyone.
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
    // Capacitor shims and older WebKit builds omit the field. There is no
    // second gate behind this one any more, so "terse" must mean "fine".
    answerWith(BATON_ROUGE);

    const { useUserLocation } = await load();
    const { result } = renderHook(() => useUserLocation(true));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(persistMock).toHaveBeenCalledWith(BATON_ROUGE.lat, BATON_ROUGE.lng);
  });

  it("only falls back when no position arrived at all", async () => {
    // failWith is for the denial/unsupported case, and nothing else. This is
    // the behaviour the corrected onSuccess must never borrow.
    profileMock = { zip_code: OWNER_ZIP, parish: "Vermilion" };
    resolveParishByZipMock.mockResolvedValue({ status: "resolved", parish: "Vermilion" });
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
});

describe("the stored row is CORRECT and is returned as-is (the read side)", () => {
  it("returns the owner's stored Menlo Park coordinate, not the ZIP under it", async () => {
    // EXACTLY the row on prod. fecdbf6e7 made this branch fall through to the
    // ZIP; that row is the owner's true position and must be handed back.
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
    expect(state.source).toBe("profile");
    expect(state.approximate).toBe(false);
    expect(state.lat).toBe(MENLO_PARK.lat);
    expect(state.lng).toBe(MENLO_PARK.lng);
    expect(resolveParishByZipMock).not.toHaveBeenCalled();
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

  it("falls through to the ZIP only when the row holds no usable number", async () => {
    profileMock = { latitude: null, longitude: null, zip_code: OWNER_ZIP, parish: "Vermilion" };
    resolveParishByZipMock.mockResolvedValue({ status: "resolved", parish: "Vermilion" });
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
  });
});

// ── VACUITY ─────────────────────────────────────────────────────────────────
// PROVEN RED 2026-09-21. Persisting unconditionally — dropping the `precise`
// guard in front of `persistUserLocation` — turns "keeps it OUT of the
// precise-fix columns" red. Accuracy gates exactly one thing in this hook, and
// that is it: `profiles.latitude/longitude` feeds `get_neighbor_hire_count`'s
// sub-mile neighbour test, so a 45km-accurate point written there reports half
// a city as one another's neighbours.
// BLIND TO: `persistUserLocation` itself (mocked here), the Capacitor
// Geolocation branch (only the navigator path is driven), and anything the
// DATABASE does with the columns.
// @mutate src/hooks/useUserLocation.ts | if (precise) void persistUserLocation(lat, lng); | void persistUserLocation(lat, lng);
