// Map child components for BrowseMap — each is a child of MapContainer so
// it can grab useMap(). Moved verbatim from BrowseMap.tsx; every hook call,
// dependency array, color token, and className is preserved exactly.

import { useEffect } from "react";
import { Popup, useMap, CircleMarker } from "react-leaflet";
import { Crosshair } from "lucide-react";
import { densityFill } from "./mapMarkers";
import type { MapJob } from "./config";

// Auto-fit the map to whatever pins exist when they load. If only one
// pin, zoom in to a useful neighborhood-level view instead of a
// state-wide one.
export function FitToPins({ jobs }: { jobs: MapJob[] }) {
  const map = useMap();
  useEffect(() => {
    if (jobs.length === 0) return;
    if (jobs.length === 1) {
      map.setView([jobs[0].latitude, jobs[0].longitude], 13);
      return;
    }
    const bounds = jobs.map((j): [number, number] => [j.latitude, j.longitude]);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }, [jobs, map]);
  return null;
}

// Heat-bucket layer rendered as a child of MapContainer so it can grab
// useMap() and flyTo when a bucket is tapped. Lifted out of the main
// render so the click handler has clean access to the map instance.
export function HeatLayer({ buckets }: { buckets: Array<{ center: [number, number]; count: number }> }) {
  const map = useMap();
  return (
    <>
      {buckets.map((b, i) => (
        <CircleMarker
          key={`heat-${i}`}
          center={b.center}
          radius={Math.min(8 + b.count * 4, 36)}
          pathOptions={{
            fillColor: densityFill(b.count),
            fillOpacity: 0.7,
            color: "transparent",
            weight: 0,
          }}
          eventHandlers={{
            // Tap-to-zoom: pan to the bucket center and step in two
            // zoom levels (capped at maxZoom 16). Faster than opening
            // the popup and reading "Zoom in to see them individually".
            click: () => {
              const targetZoom = Math.min((map.getZoom() ?? 7) + 2, 16);
              map.flyTo(b.center, targetZoom, { duration: 0.45 });
            },
          }}
        >
          <Popup>
            <p className="font-display italic font-bold text-ds-13 leading-tight">
              {b.count} {b.count === 1 ? "job" : "jobs"} here
            </p>
            <p className="text-ds-11 text-muted-foreground">Tap the bubble to zoom in.</p>
          </Popup>
        </CircleMarker>
      ))}
    </>
  );
}

// Floating "recenter" control — sits over the map, bottom-right above
// the dock clearance. flyTo with the initial Louisiana frame so users
// who have panned/zoomed deep can get back to the statewide view in
// one tap.
export function RecenterControl({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  return (
    <button
      type="button"
      onClick={() => map.flyTo(center, zoom, { duration: 0.45 })}
      aria-label="Recenter map"
      title="Recenter map"
      className="absolute z-[400] w-11 h-11 rounded-full flex items-center justify-center active:scale-[0.94] transition-all"
      style={{
        // Sit clear of the floating dock + FAB at the bottom of the
        // screen. The parent map div bleeds beneath the dock so the
        // button needs to anchor above it.
        right: "0.75rem",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 0.75rem)",
        background: "hsla(0, 0%, 100%, 0.85)",
        border: "1px solid hsl(var(--olivewood) / 0.22)",
        color: "hsl(var(--olivewood))",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
          "0 4px 14px -4px hsl(var(--olivewood) / 0.22)",
      }}
    >
      <Crosshair className="w-4 h-4" strokeWidth={2.25} />
    </button>
  );
}
