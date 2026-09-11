import { useEffect, useRef, useState } from "react";
import { useMapKitJs } from "@/hooks/useMapKitJs";
import { MapPinOff } from "lucide-react";

function resolveToken(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v || fallback;
}

interface MapKitCoordinate {
  latitude: number;
  longitude: number;
}
interface MapKitGeocodeResult {
  coordinate?: MapKitCoordinate;
}
interface MapKitGeocodeResponse {
  results: MapKitGeocodeResult[];
}
interface MapKitGeocoder {
  lookup: (
    place: string,
    callback: (err: Error | null, data: MapKitGeocodeResponse) => void,
  ) => void;
}
interface MapKitMapInstance {
  region: unknown;
  addAnnotation: (annotation: unknown) => void;
  destroy?: () => void;
}
interface MapKitRuntime {
  Geocoder?: new () => MapKitGeocoder;
  Coordinate: new (lat: number, lng: number) => unknown;
  CoordinateSpan: new (latDelta: number, lngDelta: number) => unknown;
  CoordinateRegion: new (center: unknown, span: unknown) => unknown;
  Map: new (el: HTMLElement, options: Record<string, unknown>) => MapKitMapInstance;
  MarkerAnnotation?: new (coord: unknown, options: { color: string }) => unknown;
  FeatureVisibility?: { Hidden?: unknown };
}

/**
 * JobLocationPreview — an inline, non-interactive Apple MapKit pin for a
 * job's address, shown INSIDE the job detail sheet instead of sending the
 * tap off to an external maps site (owner, 2026-08-31: "it should show
 * where it is on the map in the webpage... not leave the webpage and go
 * elsewhere. I want it to show where it is on the job detail").
 *
 * Same geocode-then-pin pattern as `postjob/AppleMapPreview.tsx`, adapted
 * to take one address string (a job's `location` column) instead of the
 * post form's separate street/city/state/zip fields. Kept as its own
 * component rather than generalizing AppleMapPreview: the post form's
 * debounced per-keystroke geocode and this one-shot job-detail geocode
 * have different triggering rules, and forcing one signature over both
 * would have made the shared component harder to read for either caller.
 */
/**
 * How long this preview is allowed to show its loading skeleton before it gives
 * up and says so.
 *
 * There is no such thing as "still loading" forever, but this component had
 * three separate routes to exactly that, and production sat on all of them
 * (owner, 2026-09-11: "why isnt map loading" — the element was stuck on
 * `role="status" aria-label="Loading map" ... animate-pulse`, pulsing grey
 * indefinitely and never reaching the error state one branch below):
 *
 *   1. `mapKitStatus` never settling — the hook's optimistic auth timer could
 *      resolve "ready" for a MapKit that was never handed a token, and its
 *      Geocoder then never invokes the callback below. Fixed at source in
 *      useMapKitJs, but a consumer must not depend on that being true forever.
 *   2. A whitespace-only `address`, which passes the `job.location` truthiness
 *      check at the call site but fails `address.trim()` here, so the geocode
 *      effect returns immediately and nothing ever sets state again.
 *   3. `mk.Geocoder` being absent, which also returns early and sets nothing.
 *
 * A watchdog covers all three and any future fourth. 15s is deliberately
 * generous — it must not fire while a slow phone is still legitimately working
 * through Apple's 807KB script plus an 8s token budget — because its job is to
 * terminate "never", not to be snappy.
 */
const MAP_PREVIEW_TIMEOUT_MS = 15_000;

export function JobLocationPreview({ address }: { address: string }) {
  const mapKitStatus = useMapKitJs();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapKitMapInstance | null>(null);
  const [resolved, setResolved] = useState<{ lat: number; lng: number } | null>(null);
  const [geocodeFailed, setGeocodeFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // Watchdog. Keyed on `address` only: a new address is a genuinely new attempt
  // and deserves a fresh window, but a status flap must NOT keep resetting the
  // clock or "never" becomes reachable again by a different road.
  useEffect(() => {
    setTimedOut(false);
    const t = setTimeout(() => setTimedOut(true), MAP_PREVIEW_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [address]);

  useEffect(() => {
    if (mapKitStatus !== "ready" || !window.mapkit || !address.trim()) return;
    let cancelled = false;
    try {
      const mk = window.mapkit as unknown as MapKitRuntime;
      const GeocoderCtor = mk.Geocoder;
      if (!GeocoderCtor) return;
      const geocoder = new GeocoderCtor();
      geocoder.lookup(address, (err, data) => {
        if (cancelled) return;
        const coord = !err ? data?.results?.[0]?.coordinate : undefined;
        if (!coord) {
          setGeocodeFailed(true);
          return;
        }
        setResolved({ lat: coord.latitude, lng: coord.longitude });
      });
    } catch {
      setGeocodeFailed(true);
    }
    return () => { cancelled = true; };
  }, [mapKitStatus, address]);

  useEffect(() => {
    if (!resolved || mapKitStatus !== "ready" || !window.mapkit || !containerRef.current) return;
    const mk = window.mapkit as unknown as MapKitRuntime;
    try {
      const center = new mk.Coordinate(resolved.lat, resolved.lng);
      const span = new mk.CoordinateSpan(0.01, 0.01);
      const region = new mk.CoordinateRegion(center, span);
      mapRef.current = new mk.Map(containerRef.current, {
        region,
        showsUserLocationControl: false,
        showsCompass: mk.FeatureVisibility?.Hidden ?? 0,
        showsScale: mk.FeatureVisibility?.Hidden ?? 0,
        // Scroll/zoom/rotate ARE enabled here (unlike the post-form preview,
        // which is a read-only confidence check) — this map's whole job is
        // to be the "look around" surface that used to require leaving the
        // page, so a helpr can actually explore the neighborhood.
        isZoomEnabled: true,
        isScrollEnabled: true,
        isRotationEnabled: false,
      });
      const Annotation = mk.MarkerAnnotation;
      if (Annotation) {
        mapRef.current.addAnnotation(new Annotation(center, { color: resolveToken("--burnt-sienna", "#A65A40") }));
      }
    } catch {
      setGeocodeFailed(true);
    }
    return () => {
      try { mapRef.current?.destroy?.(); } catch { /* ignore */ }
      mapRef.current = null;
    };
  }, [resolved, mapKitStatus]);

  // `timedOut && !resolved`, not a bare `timedOut`: once a pin is on screen the
  // watchdog is irrelevant and must never tear down a working map.
  if (
    mapKitStatus === "missing-token" ||
    mapKitStatus === "error" ||
    geocodeFailed ||
    !address.trim() ||
    (timedOut && !resolved)
  ) {
    return (
      <div
        role="status"
        className="w-full h-40 rounded-2xl overflow-hidden flex flex-col items-center justify-center gap-1.5 px-4 text-center"
        style={{ border: "0.5px solid hsl(var(--olivewood) / 0.22)", background: "hsl(var(--olivewood) / 0.05)" }}
      >
        <MapPinOff className="w-5 h-5" style={{ color: "hsl(var(--olivewood) / 0.7)" }} aria-hidden="true" />
        <p className="text-ds-11" style={{ color: "hsl(var(--olivewood))" }}>Map preview isn't available right now.</p>
      </div>
    );
  }

  if (mapKitStatus !== "ready" || !resolved) {
    return (
      <div
        role="status"
        aria-label="Loading map"
        className="w-full h-40 rounded-2xl overflow-hidden animate-pulse"
        style={{ background: "hsl(var(--olivewood) / 0.08)" }}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Map showing this job's location"
      className="w-full h-40 rounded-2xl overflow-hidden"
      style={{
        border: "0.5px solid hsl(var(--olivewood) / 0.22)",
        boxShadow: "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), 0 1px 2px hsl(var(--olivewood) / 0.06)",
      }}
    />
  );
}

export default JobLocationPreview;
