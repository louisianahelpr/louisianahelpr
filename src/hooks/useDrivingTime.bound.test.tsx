/**
 * THE ETA HALF OF THE 2026-09-19 CHIP — "27h 6m · 1634 mi".
 *
 * `useDrivingTime` is the single funnel every drive-time label in this app
 * passes through: JobCard's browse meta pill and the job detail's Where tile
 * (via jobDetailDialog/useJobDetailData). So the bound lives in the hook, and
 * these tests are what prove both surfaces inherit it — the detail dialog is
 * covered here without a second render of it.
 *
 * Both of the hook's branches are exercised, because they fail differently:
 * the heuristic derives minutes FROM miles (so an impossible distance must
 * not mint a possible-looking duration), while MapKit answers with a REAL
 * route that need not agree with the straight line beside it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

let mapKitStatus = "idle";
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => mapKitStatus }));

import { useDrivingTime } from "./useDrivingTime";
import { MAX_PLAUSIBLE_TRIP_MILES, MAX_PLAUSIBLE_TRIP_MINUTES } from "@/lib/geo";

/** The prod coordinate that caused the report, and one of the four jobs. */
const MENLO_PARK = { lat: 37.47282350893211, lng: -122.2443517921565 };
const SHREVEPORT = { lat: 32.5776, lng: -93.8773 };
const BATON_ROUGE = { lat: 30.4515, lng: -91.1871 };

beforeEach(() => {
  mapKitStatus = "idle";
  delete (window as unknown as { mapkit?: unknown }).mapkit;
});

describe("heuristic branch", () => {
  it("returns nothing for the distance the owner was actually shown", () => {
    const { result } = renderHook(() =>
      useDrivingTime(MENLO_PARK.lat, MENLO_PARK.lng, SHREVEPORT.lat, SHREVEPORT.lng, 1634),
    );
    // Before the bound this seeded 1634 × 1.3 ≈ 2124 min and rendered "35h 24m"
    // — or, once MapKit answered, the "27h 6m" on the screenshot.
    expect(result.current).toBeNull();
  });

  it("is null on the FIRST render, not only after an effect", () => {
    // The lazy useState initialiser is a separate code path from the effect,
    // and it is the one that paints the first frame. An unbounded initial
    // value would flash the absurd number and then remove it.
    const { result } = renderHook(() =>
      useDrivingTime(MENLO_PARK.lat, MENLO_PARK.lng, SHREVEPORT.lat, SHREVEPORT.lng, 1813),
    );
    expect(result.current).toBeNull();
  });

  it("still estimates a real Louisiana drive", () => {
    const { result } = renderHook(() =>
      useDrivingTime(BATON_ROUGE.lat, BATON_ROUGE.lng, SHREVEPORT.lat, SHREVEPORT.lng, 230),
    );
    expect(result.current).toBe(Math.round(230 * 1.3));
    expect(result.current!).toBeLessThan(MAX_PLAUSIBLE_TRIP_MINUTES);
  });

  it("still estimates a short one", () => {
    const { result } = renderHook(() =>
      useDrivingTime(BATON_ROUGE.lat, BATON_ROUGE.lng, 30.44, -91.18, 4),
    );
    expect(result.current).toBe(10);
  });

  it("passes the mileage bound and refuses the value past it", () => {
    const at = renderHook(() =>
      useDrivingTime(BATON_ROUGE.lat, BATON_ROUGE.lng, SHREVEPORT.lat, SHREVEPORT.lng, MAX_PLAUSIBLE_TRIP_MILES),
    );
    expect(at.result.current).not.toBeNull();
    const past = renderHook(() =>
      useDrivingTime(BATON_ROUGE.lat, BATON_ROUGE.lng, SHREVEPORT.lat, SHREVEPORT.lng, MAX_PLAUSIBLE_TRIP_MILES + 1),
    );
    expect(past.result.current).toBeNull();
  });

  it("returns null when there is no distance to work from", () => {
    const { result } = renderHook(() =>
      useDrivingTime(BATON_ROUGE.lat, BATON_ROUGE.lng, SHREVEPORT.lat, SHREVEPORT.lng, null),
    );
    expect(result.current).toBeNull();
  });
});

describe("MapKit branch", () => {
  /** Stand in for mapkit.Directions, answering with a fixed travel time. */
  function stubMapKit(seconds: number) {
    mapKitStatus = "ready";
    (window as unknown as { mapkit: unknown }).mapkit = {
      Coordinate: function Coordinate(this: unknown, lat: number, lng: number) {
        Object.assign(this as object, { lat, lng });
      },
      Directions: function Directions(this: unknown) {
        Object.assign(this as object, {
          route: (
            _opts: unknown,
            cb: (err: unknown, data: { routes: Array<{ expectedTravelTime: number }> }) => void,
          ) => cb(null, { routes: [{ expectedTravelTime: seconds }] }),
        });
      },
    };
  }

  it("refuses a real route that is longer than this app can be about", () => {
    // 27h 6m — the exact duration on the owner's card, which a genuine
    // cross-country MapKit route would return for that origin.
    stubMapKit((27 * 60 + 6) * 60);
    const { result } = renderHook(() =>
      useDrivingTime(MENLO_PARK.lat, MENLO_PARK.lng, SHREVEPORT.lat, SHREVEPORT.lng, 1634),
    );
    expect(result.current).toBeNull();
  });

  it("refuses an absurd route even when the straight line beside it looks sane", () => {
    // A 60-mile hop that MapKit answers with a 20-hour route (a ferry leg, a
    // closed pass). The miles half would have rendered happily.
    stubMapKit(20 * 3600);
    const { result } = renderHook(() =>
      useDrivingTime(BATON_ROUGE.lat, BATON_ROUGE.lng, 30.0, -90.5, 60),
    );
    expect(result.current).toBeNull();
  });

  it("uses a real route when it is a real route", async () => {
    // A DIFFERENT destination from the test above on purpose: the hook holds
    // a module-level route cache keyed on (origin, destination) rounded to 3
    // decimals, so reusing the coordinates would read back the refused
    // 20-hour route and prove nothing.
    stubMapKit(45 * 60);
    const { result } = renderHook(() =>
      useDrivingTime(BATON_ROUGE.lat, BATON_ROUGE.lng, 30.2241, -92.0198, 60),
    );
    await waitFor(() => expect(result.current).toBe(45));
  });

  it("re-bounds a route it already has cached", async () => {
    // The cache stores the RAW MapKit answer, so the bound has to be applied
    // again on the way out of it — otherwise the first card in a scroll
    // refuses the number and the second one, served from cache, shows it.
    stubMapKit(19 * 3600);
    const first = renderHook(() =>
      useDrivingTime(BATON_ROUGE.lat, BATON_ROUGE.lng, 29.9511, -90.0715, 80),
    );
    await waitFor(() => expect(first.result.current).toBeNull());
    const second = renderHook(() =>
      useDrivingTime(BATON_ROUGE.lat, BATON_ROUGE.lng, 29.9511, -90.0715, 80),
    );
    expect(second.result.current).toBeNull();
  });
});
