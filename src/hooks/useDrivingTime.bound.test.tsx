/**
 * THE ETA HALF OF THE 2026-09-19 CHIP — "27h 6m · 1634 mi".
 *
 * CORRECTION (read this before the assertions). The first fix called that
 * number impossible and hunted the origin. It was not impossible: the owner
 * confirmed "Yes I'm in Menlo Park rn", so the 1,634 miles and the 27 hours
 * were both TRUE. What is wrong with them is that a 27-hour drive is not a
 * commute, and this hook exists to answer "is it worth the drive".
 *
 * So the rule these tests pin is about the TRIP, not the viewer. Nothing here
 * decides a coordinate is untrustworthy, and nothing discards one — the hook
 * simply declines to estimate a drive nobody takes, and the distance stays
 * available to any surface that wants to state it plainly (the job detail's
 * Where tile does exactly that).
 *
 * `useDrivingTime` is the single funnel every drive-time label in this app
 * passes through: JobCard's browse meta pill and the job detail's Where tile
 * (via jobDetailDialog/useJobDetailData). So the rule lives in the hook, and
 * these tests are what prove both surfaces inherit it — the detail dialog is
 * covered here without a second render of it.
 *
 * Both of the hook's branches are exercised, because they fail differently:
 * the heuristic derives minutes FROM miles (so a non-commute distance must not
 * mint a commute-looking duration), while MapKit answers with a REAL route
 * that need not agree with the straight line beside it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

let mapKitStatus = "idle";
/** Routes MapKit actually answered. The waiting tests wait on THIS, not on an
 *  emptiness their first paint already satisfies — see the note below. */
let routesAnswered = 0;
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => mapKitStatus }));

import { useDrivingTime } from "./useDrivingTime";
import { COMMUTE_RANGE_MILES, MAX_COMMUTE_MINUTES } from "@/lib/geo";

/** The prod coordinate that caused the report, and one of the four jobs. */
const MENLO_PARK = { lat: 37.47282350893211, lng: -122.2443517921565 };
const SHREVEPORT = { lat: 32.5776, lng: -93.8773 };
const BATON_ROUGE = { lat: 30.4515, lng: -91.1871 };

beforeEach(() => {
  mapKitStatus = "idle";
  routesAnswered = 0;
  delete (window as unknown as { mapkit?: unknown }).mapkit;
});

describe("heuristic branch", () => {
  it("declines to estimate a drive for the distance the owner was shown", () => {
    const { result } = renderHook(() =>
      useDrivingTime(MENLO_PARK.lat, MENLO_PARK.lng, SHREVEPORT.lat, SHREVEPORT.lng, 1634),
    );
    // Before this rule the heuristic seeded 1634 × 1.3 ≈ 2124 min and rendered
    // "35h 24m" — or, once MapKit answered, the "27h 6m" on the screenshot.
    // Both were accurate. Neither was a commute.
    expect(result.current).toBeNull();
  });

  it("is null on the FIRST render, not only after an effect", () => {
    // The lazy useState initialiser is a separate code path from the effect,
    // and it is the one that paints the first frame. An ungated initial value
    // would flash the 30-hour figure and then remove it.
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
    expect(result.current!).toBeLessThan(MAX_COMMUTE_MINUTES);
  });

  it("still estimates a short one", () => {
    const { result } = renderHook(() =>
      useDrivingTime(BATON_ROUGE.lat, BATON_ROUGE.lng, 30.44, -91.18, 4),
    );
    expect(result.current).toBe(10);
  });

  it("estimates at the commute range and declines the value past it", () => {
    const at = renderHook(() =>
      useDrivingTime(BATON_ROUGE.lat, BATON_ROUGE.lng, SHREVEPORT.lat, SHREVEPORT.lng, COMMUTE_RANGE_MILES),
    );
    expect(at.result.current).not.toBeNull();
    const past = renderHook(() =>
      useDrivingTime(BATON_ROUGE.lat, BATON_ROUGE.lng, SHREVEPORT.lat, SHREVEPORT.lng, COMMUTE_RANGE_MILES + 1),
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
          ) => {
            routesAnswered++;
            cb(null, { routes: [{ expectedTravelTime: seconds }] });
          },
        });
      },
    };
  }

  it("declines a real cross-country route — accurate, but not a commute", () => {
    // 27h 6m — the exact duration on the owner's card, which a genuine
    // cross-country MapKit route would return for that origin.
    stubMapKit((27 * 60 + 6) * 60);
    const { result } = renderHook(() =>
      useDrivingTime(MENLO_PARK.lat, MENLO_PARK.lng, SHREVEPORT.lat, SHREVEPORT.lng, 1634),
    );
    expect(result.current).toBeNull();
  });

  it("declines a route that contradicts its own straight line", () => {
    // A 60-mile hop that MapKit answers with a 20-hour route (a ferry leg, a
    // closed pass, a routing error). The distance is commutable, so this is
    // the second axis doing its job: the route disagrees with its own straight
    // line, and only one of them can be right.
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

  it("re-applies the rule to a route it already has cached", async () => {
    // The cache stores the RAW MapKit answer, so the rule has to be applied
    // again on the way out of it — otherwise the first card in a scroll
    // refuses the number and the second one, served from cache, shows it.
    stubMapKit(19 * 3600);
    const first = renderHook(() =>
      useDrivingTime(BATON_ROUGE.lat, BATON_ROUGE.lng, 29.9511, -90.0715, 80),
    );
    // WAIT FOR THE DATA, THEN ASSERT THE ABSENCE. This used to be
    // `waitFor(() => expect(first.result.current).toBeNull())`, which returns
    // on poll #1 for any hook that has not produced a value yet — so it could
    // not distinguish "MapKit answered 19h and the rule refused it" from
    // "MapKit never answered at all", and the cache it was written to populate
    // might never have been written. The positive condition is the route
    // coming back; only then is the null meaningful.
    await waitFor(() => expect(routesAnswered).toBeGreaterThan(0));
    expect(first.result.current).toBeNull();
    const answeredBefore = routesAnswered;
    const second = renderHook(() =>
      useDrivingTime(BATON_ROUGE.lat, BATON_ROUGE.lng, 29.9511, -90.0715, 80),
    );
    // Served from the module cache — no second route call — and still refused.
    expect(routesAnswered).toBe(answeredBefore);
    expect(second.result.current).toBeNull();
  });
});

// Shown able to fail:
// The distance gate itself — without it the hook mints "35h 24m" for the
// 1,634-mile trip on the owner's card.
// @mutate src/hooks/useDrivingTime.ts | if (!isCommutableDistance(miles)) return null; | if (false) return null;
// The second axis: a real MapKit route that contradicts its own straight line.
// @mutate src/lib/geo.ts | return minutes > MAX_COMMUTE_MINUTES ? null : minutes; | return minutes;
// The rule must be re-applied on the way OUT of the module route cache, or the
// first card in a scroll refuses the number and the second one shows it.
// @mutate src/hooks/useDrivingTime.ts | setMinutes(commuteEstimate(miles, cached)); | setMinutes(cached);
