/**
 * A job card only pulls in MapKit when a route could come back and be shown.
 * Every JobCard calls useDrivingTime, so a visitor with no location (every guest
 * on /browse) downloaded Apple's script (232 KB gzip) and an edge-minted token
 * for a route the hook would never request (Lighthouse run 41080594282).
 *
 * The real hooks run here, not a mock of useMapKitJs: the assertion is on the
 * script tag and the token fetch themselves.
 *
 * @mutate src/hooks/useDrivingTime.ts | originLat != null && originLng != null && destLat != null && destLng != null && isCommutableDistance(miles), | true,
 * @mutate src/hooks/useDrivingTime.ts | destLng != null && isCommutableDistance(miles), | destLng != null,
 * @mutate src/hooks/useMapKitJs.ts |     if (!enabled) {\n      statusListeners.add(setStatus); |     if (false) {\n      statusListeners.add(setStatus);
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDrivingTime } from "./useDrivingTime";
import { useMapKitJs } from "./useMapKitJs";

const SCRIPT_ID = "apple-mapkit-js";
const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ token: "t" }), { status: 200 }));
const started = () => !!document.getElementById(SCRIPT_ID);
const A = { lat: 30.45, lng: -91.18 };
const B = { lat: 30.5, lng: -91.1 };

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockClear();
});
afterAll(() => {
  vi.unstubAllGlobals();
  document.getElementById(SCRIPT_ID)?.remove();
});

// In order: the loader is module-level and once-per-page, so every "starts
// nothing" case runs before the one that starts it.
describe("useDrivingTime asks for MapKit only when a route could be shown", () => {
  it.each([
    ["no location (a guest)", null, null, B.lat, B.lng, null],
    ["no location, but a distance", null, null, B.lat, B.lng, 5],
    ["a location, no destination", A.lat, A.lng, null, null, 5],
    ["both ends, no distance", A.lat, A.lng, B.lat, B.lng, null],
    ["both ends, past commute range", A.lat, A.lng, B.lat, B.lng, 1634],
  ])("%s: starts nothing", (_label, oLat, oLng, dLat, dLng, miles) => {
    const { unmount } = renderHook(() => useDrivingTime(oLat, oLng, dLat, dLng, miles));
    expect(started()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    unmount();
  });

  it("useMapKitJs({ enabled: false }) starts nothing and reports idle", () => {
    const { result, unmount } = renderHook(() => useMapKitJs({ enabled: false }));
    expect(result.current).toBe("idle");
    expect(started()).toBe(false);
    unmount();
  });

  it("both ends within commute range: starts the script and the token", () => {
    const { unmount } = renderHook(() => useDrivingTime(A.lat, A.lng, B.lat, B.lng, 5));
    expect(started()).toBe(true);
    expect(fetchSpy).toHaveBeenCalled();
    unmount();
  });

  it("a card with no location still hears when another screen's MapKit finishes", () => {
    const { result, unmount } = renderHook(() => useMapKitJs({ enabled: false }));
    expect(result.current).toBe("loading");
    unmount();
  });
});

