import { useEffect, useRef, useState } from "react";
import { useMapKitJs } from "@/hooks/useMapKitJs";

interface AppleMapPreviewProps {
  street: string;
  city: string;
  state: string;
  zipCode: string;
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
  const mapRef = useRef<any>(null);
  const annotationRef = useRef<any>(null);
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
        const mk = window.mapkit as any;
        const GeocoderCtor = mk.Geocoder;
        if (!GeocoderCtor) return;
        const geocoder = new GeocoderCtor();
        geocoder.lookup(composed, (err: any, data: any) => {
          if (cancelled || err || !data?.results?.length) return;
          const place: any = data.results[0];
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
    const mk = window.mapkit as any;
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
        annotationRef.current = new Annotation(center, { color: "#A65A40" });
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
