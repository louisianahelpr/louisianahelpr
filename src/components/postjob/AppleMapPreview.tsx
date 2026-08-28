import { useEffect, useRef, useState } from "react";
import { useMapKitJs } from "@/hooks/useMapKitJs";
import { MapPinOff } from "lucide-react";

function resolveToken(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v || fallback;
}

interface AppleMapPreviewProps {
  street: string;
  city: string;
  state: string;
  zipCode: string;
}

// Minimal MapKit JS shapes we touch here — Apple's runtime is loosely
// typed and the @types/mapkit-js package has drifted, so we describe
// only the members this preview reads/constructs.
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
  removeAnnotation: (annotation: unknown) => void;
  destroy?: () => void;
}
/** The handful of MapKit constructors/enums this component reaches for
 *  beyond what `MapKitGlobal` in useMapKitJs already types. */
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
 * Tiny inline preview of the typed address as a pinned MapKit JS map.
 *
 * Hides itself completely when MapKit isn't usable (missing token,
 * script blocked, geocode fails). The address text in the parent form
 * is still the source of truth — this is a confidence check, not a
 * primary input.
 *
 * We debounce the lookup so a user typing the street doesn't churn
 * MapKit. The map instance is created once and re-centered on each
 * resolved coordinate.
 */
export function AppleMapPreview({ street, city, state, zipCode }: AppleMapPreviewProps) {
  const mapKitStatus = useMapKitJs();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapKitMapInstance | null>(null);
  const annotationRef = useRef<unknown>(null);
  const [resolved, setResolved] = useState<{ lat: number; lng: number } | null>(null);

  // Hold off until we have at least a street + city or a zip — geocoding
  // half-typed strings just thrashes MapKit and leaves us empty maps.
  const composed = `${street}, ${city}, ${state} ${zipCode}`.trim();
  const enoughAddress = street.trim().length > 3 && (city.trim().length > 0 || zipCode.trim().length === 5);

  useEffect(() => {
    if (mapKitStatus !== "ready" || !window.mapkit || !enoughAddress) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      try {
        const mk = window.mapkit as unknown as MapKitRuntime;
        const GeocoderCtor = mk.Geocoder;
        if (!GeocoderCtor) return;
        const geocoder = new GeocoderCtor();
        geocoder.lookup(composed, (err, data) => {
          if (cancelled || err || !data?.results?.length) return;
          const place = data.results[0];
          const coord = place.coordinate;
          if (!coord) return;
          setResolved({ lat: coord.latitude, lng: coord.longitude });
        });
      } catch { /* ignore */ }
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mapKitStatus, composed, enoughAddress]);

  // Create / update the map once we have a coordinate.
  useEffect(() => {
    if (!resolved || mapKitStatus !== "ready" || !window.mapkit || !containerRef.current) return;
    const mk = window.mapkit as unknown as MapKitRuntime;
    try {
      const center = new mk.Coordinate(resolved.lat, resolved.lng);
      const span = new mk.CoordinateSpan(0.01, 0.01);
      const region = new mk.CoordinateRegion(center, span);
      if (!mapRef.current) {
        mapRef.current = new mk.Map(containerRef.current, {
          region,
          showsUserLocationControl: false,
          showsCompass: mk.FeatureVisibility?.Hidden ?? 0,
          showsScale: mk.FeatureVisibility?.Hidden ?? 0,
          isZoomEnabled: false,
          isScrollEnabled: false,
          isRotationEnabled: false,
        });
      } else {
        mapRef.current.region = region;
      }
      if (annotationRef.current) {
        mapRef.current.removeAnnotation(annotationRef.current);
      }
      const Annotation = mk.MarkerAnnotation;
      if (Annotation) {
        annotationRef.current = new Annotation(center, { color: resolveToken("--burnt-sienna", "#A65A40") });
        mapRef.current.addAnnotation(annotationRef.current);
      }
    } catch { /* ignore */ }
  }, [resolved, mapKitStatus]);

  // Tear down the map when the component unmounts.
  useEffect(() => {
    return () => {
      try { mapRef.current?.destroy?.(); } catch { /* ignore */ }
      mapRef.current = null;
      annotationRef.current = null;
    };
  }, []);

  // HONEST, not invisible. This used to `return null` for every non-ready
  // status, so a MapKit that could not authorize at all looked identical to a
  // half-typed address — the map simply never appeared and nothing anywhere
  // said why. Once the user has typed enough of an address to expect a
  // preview, an unusable MapKit gets a calm panel that says so.
  //
  // Deliberately calm and deliberately non-blocking: the address text in the
  // form is the source of truth, the job posts fine without a preview, and the
  // Helpr who receives it gets a Directions button that never touches MapKit.
  // Nobody is stranded by this.
  if (enoughAddress && (mapKitStatus === "missing-token" || mapKitStatus === "error")) {
    return (
      <div
        role="status"
        className="w-full h-32 rounded-2xl overflow-hidden flex flex-col items-center justify-center gap-1.5 px-4 text-center"
        style={{
          border: "0.5px solid hsl(var(--olivewood) / 0.22)",
          background: "hsl(var(--olivewood) / 0.05)",
        }}
      >
        <MapPinOff className="w-5 h-5" style={{ color: "hsl(var(--olivewood) / 0.7)" }} aria-hidden="true" />
        <p className="text-ds-11" style={{ color: "hsl(var(--olivewood))" }}>
          Map preview isn’t available right now.
        </p>
        <p className="text-ds-10 text-muted-foreground">
          Your address is still saved and your Helpr will still get directions.
        </p>
      </div>
    );
  }

  if (mapKitStatus !== "ready" || !resolved) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Map preview of the entered address"
      className="w-full h-32 rounded-2xl overflow-hidden"
      style={{
        border: "0.5px solid hsl(var(--olivewood) / 0.22)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
          "0 1px 2px hsl(var(--olivewood) / 0.06)",
      }}
    />
  );
}

export default AppleMapPreview;
