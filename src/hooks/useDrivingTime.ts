import { useEffect, useState } from "react";
import { useMapKitJs } from "@/hooks/useMapKitJs";
import { commuteMinutes, isCommutableDistance } from "@/lib/geo";

/**
 * Lightweight driving-time estimator for the dashboard JobCard meta row.
 *
 * Strategy:
 *
 *  1. **MapKit Directions when ready** — when `useMapKitJs()` reports
 *     `"ready"` we attempt a real `mapkit.Directions.route()` lookup for
 *     each unique (origin, destination) pair, cached at module level.
 *     The first matching route's `expectedTravelTime` (seconds) is
 *     rounded to minutes and surfaced to the caller. Failures and
 *     missing-route responses are silently treated as "no estimate"
 *     so the card never shows a broken state.
 *  2. **Heuristic fallback** — when MapKit isn't ready (token missing,
 *     load error, idle) we still want to show driving time alongside
 *     the existing distance pill so the card is informative. We
 *     compute a piecewise heuristic based on miles:
 *         < 5 mi  → 2.5 min/mi  (city, lights, low-speed)
 *         5–20 mi → 1.8 min/mi  (mixed surface)
 *         > 20 mi → 1.3 min/mi  (highway-dominant)
 *     This matches typical south-Louisiana drive times closely enough
 *     for an "X min" pill and avoids per-card API calls when MapKit
 *     isn't authenticated for this deployment.
 *
 * The hook deliberately returns null whenever an input is missing so a
 * caller can render the pill conditionally.
 */

const SECONDS_PER_MIN = 60;
const cache = new Map<string, number>();

function cacheKey(o: { lat: number; lng: number }, d: { lat: number; lng: number }) {
  // Round to 3 decimals (~110m) so neighborhood-rounded origins/dests
  // collapse to the same key — keeps the cache from blowing up across
  // a long scroll while staying accurate enough for a minute estimate.
  return `${o.lat.toFixed(3)},${o.lng.toFixed(3)}->${d.lat.toFixed(3)},${d.lng.toFixed(3)}`;
}

function heuristicMinutes(miles: number): number {
  if (miles <= 0) return 0;
  const minPerMi = miles < 5 ? 2.5 : miles < 20 ? 1.8 : 1.3;
  // Floor at 1 min — anything below reads as "instant" which is wrong
  // for a card meta row (parking, walk-up, etc.).
  return Math.max(1, Math.round(miles * minPerMi));
}

/**
 * A DRIVE TIME IS ONLY OFFERED FOR A TRIP SOMEONE WOULD DRIVE.
 *
 * Owner, 2026-09-19, /home: "27h 6m · 1634 mi" on a Shreveport job —
 * "why is this showing here". The first fix read that as a falsehood and
 * hunted the origin. It was not false: the owner was in Menlo Park and the
 * figures were correct to the mile (geo.ts carries the corrected account).
 *
 * The defect was that a 27-hour drive is not a commute. "How long is the
 * drive" is a question a helpr asks when they are deciding whether a $120 job
 * is worth the trip; past a few hundred miles it stops being that question and
 * becomes trivia dressed as a commute estimate. So this hook declines to
 * answer rather than answering uselessly — and it declines because of the
 * TRIP, never because of the viewer. No coordinate is discarded here and none
 * is called untrustworthy; the distance itself remains available to callers
 * that want to state it plainly (the job detail's Where tile does).
 *
 * The gate lives in the HOOK rather than at each call site on purpose:
 * `useDrivingTime` is the single funnel every drive-time label in the app
 * passes through (JobCard's meta pill and the job detail's Where tile, via
 * useJobDetailData), so one rule here covers both and any future caller
 * inherits it.
 *
 * `commuteMinutes` is the second axis, and it is conditioned on the first:
 * given a straight line already under COMMUTE_RANGE_MILES, a real MapKit route
 * that claims more than 12 hours is contradicting its own straight line (a
 * ferry leg, a closed pass, a routing error), so it is not shown either.
 */
function commuteEstimate(miles: number | null, minutes: number | null): number | null {
  if (!isCommutableDistance(miles)) return null;
  return commuteMinutes(minutes);
}

export function useDrivingTime(
  originLat: number | null | undefined,
  originLng: number | null | undefined,
  destLat: number | null | undefined,
  destLng: number | null | undefined,
  miles: number | null,
): number | null {
  const mapKitStatus = useMapKitJs();
  const [minutes, setMinutes] = useState<number | null>(() =>
    miles == null ? null : commuteEstimate(miles, heuristicMinutes(miles)),
  );

  useEffect(() => {
    // Re-seed the heuristic whenever the miles input changes so a
    // cached MapKit miss still updates as the user scrolls.
    if (miles == null) {
      setMinutes(null);
      return;
    }
    setMinutes(commuteEstimate(miles, heuristicMinutes(miles)));

    if (
      mapKitStatus !== "ready" ||
      originLat == null || originLng == null ||
      destLat == null || destLng == null
    ) {
      return;
    }

    const key = cacheKey(
      { lat: originLat, lng: originLng },
      { lat: destLat, lng: destLng },
    );
    const cached = cache.get(key);
    if (typeof cached === "number") {
      setMinutes(commuteEstimate(miles, cached));
      return;
    }

    // mapkit may not expose Directions on older 5.x builds; guard the
    // call so a missing class falls back to the heuristic.
    const mapkit = window.mapkit as unknown as {
      Coordinate?: new (lat: number, lng: number) => unknown;
      Directions?: new () => {
        route: (
          opts: { origin: unknown; destination: unknown; transportType?: unknown },
          cb: (err: unknown, data: { routes?: Array<{ expectedTravelTime?: number }> }) => void,
        ) => void;
      };
    };
    if (!mapkit?.Directions || !mapkit?.Coordinate) return;

    let cancelled = false;
    try {
      const origin = new mapkit.Coordinate(originLat, originLng);
      const destination = new mapkit.Coordinate(destLat, destLng);
      const directions = new mapkit.Directions();
      directions.route({ origin, destination }, (err, data) => {
        if (cancelled) return;
        if (err) return;
        const seconds = data?.routes?.[0]?.expectedTravelTime;
        if (typeof seconds === "number" && seconds > 0) {
          const m = Math.max(1, Math.round(seconds / SECONDS_PER_MIN));
          cache.set(key, m);
          setMinutes(commuteEstimate(miles, m));
        }
      });
    } catch {
      // Any thrown error from the MapKit shim → silently keep the
      // heuristic estimate. Never blow up rendering a card.
    }

    return () => {
      cancelled = true;
    };
  }, [mapKitStatus, originLat, originLng, destLat, destLng, miles]);

  return minutes;
}
