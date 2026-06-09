import { useEffect, useState } from "react";
import { useMapKitJs } from "@/hooks/useMapKitJs";

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

export function useDrivingTime(
  originLat: number | null | undefined,
  originLng: number | null | undefined,
  destLat: number | null | undefined,
  destLng: number | null | undefined,
  miles: number | null,
): number | null {
  const mapKitStatus = useMapKitJs();
  const [minutes, setMinutes] = useState<number | null>(() => {
    if (miles == null) return null;
    return heuristicMinutes(miles);
  });

  useEffect(() => {
    // Re-seed the heuristic whenever the miles input changes so a
    // cached MapKit miss still updates as the user scrolls.
    if (miles == null) {
      setMinutes(null);
      return;
    }
    setMinutes(heuristicMinutes(miles));

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
      setMinutes(cached);
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
          setMinutes(m);
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
