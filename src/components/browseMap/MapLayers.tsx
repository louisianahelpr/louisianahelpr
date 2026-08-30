// Map overlays/controls for BrowseMap.
//
// Under Leaflet these were react-leaflet CHILD COMPONENTS that reached for
// `useMap()`. MapKit JS has no React binding — the map is a single imperative
// object we own — so the two map-driven layers (fit-to-pins, heat) are now
// plain functions that take the map instance, and only the pieces that are
// really DOM (the recenter button, the heat caption) stay components. The
// behaviour, geometry and colour tokens are unchanged.

import { Crosshair } from "lucide-react";
import { densityFill, heatRadiusPx } from "./mapMarkers";
import { LA_STATE_BOUNDS, type MapJob } from "./config";
import {
  metresPerPixel,
  regionFromBounds,
  type MKMap,
  type MKOverlay,
  type MapKitRuntime,
} from "./mapkitRuntime";

/** The camera the map opens on and returns to: Louisiana, framed. */
export function laRegion(mk: MapKitRuntime) {
  return regionFromBounds(mk, LA_STATE_BOUNDS);
}

/**
 * Auto-fit the map to whatever pins exist when they load. If only one pin,
 * zoom in to a useful neighborhood-level view instead of a state-wide one.
 * With NO pins, fall back to framing Louisiana itself — otherwise an empty
 * (or heavily filtered) map sits on whatever camera the user left behind.
 *
 * Leaflet's `fitBounds` took a pixel padding; MapKit takes a region, so the
 * padding is expressed as the span pad factor in `regionFromBounds`.
 */
export function fitToPins(mk: MapKitRuntime, map: MKMap, jobs: MapJob[], animate = false) {
  if (jobs.length === 0) {
    map.setRegionAnimated(laRegion(mk), animate);
    return;
  }
  if (jobs.length === 1) {
    // ~Leaflet zoom 13: a neighbourhood-level span rather than a state one.
    const region = new mk.CoordinateRegion(
      new mk.Coordinate(Number(jobs[0].latitude), Number(jobs[0].longitude)),
      new mk.CoordinateSpan(0.06, 0.06),
    );
    map.setRegionAnimated(region, animate);
    return;
  }
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  for (const j of jobs) {
    const lat = Number(j.latitude);
    const lng = Number(j.longitude);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  // maxZoom 13 under Leaflet — i.e. never zoom TIGHTER than ~0.06°, so a
  // pair of pins on the same street doesn't slam the camera to rooftop level.
  const region = regionFromBounds(mk, [[south, west], [north, east]], 1.25);
  region.span.latitudeDelta = Math.max(region.span.latitudeDelta, 0.06);
  region.span.longitudeDelta = Math.max(region.span.longitudeDelta, 0.06);
  map.setRegionAnimated(region, animate);
}

export interface HeatBucket {
  center: [number, number];
  count: number;
}

/**
 * Draw the heat buckets as `mapkit.CircleOverlay`s and wire tap-to-zoom.
 *
 * UNITS: `heatRadiusPx(count)` is the Leaflet screen-pixel radius; MapKit
 * wants METRES, so each radius is multiplied by the live metres-per-pixel of
 * the current camera (see ./mapkitRuntime). `resizeHeatOverlays` re-applies
 * that on `region-change-end`, which is what keeps a bubble the same size on
 * screen as the user zooms — a fixed metre radius would balloon when zoomed
 * in and vanish when zoomed out.
 *
 * Returns the overlays it added so the caller can remove exactly those.
 */
export function addHeatOverlays(
  mk: MapKitRuntime,
  map: MKMap,
  buckets: HeatBucket[],
  onSelect: (bucket: HeatBucket) => void,
): MKOverlay[] {
  const mpp = metresPerPixel(map) || 100;
  const overlays = buckets.map((b) => {
    const overlay = new mk.CircleOverlay(
      new mk.Coordinate(b.center[0], b.center[1]),
      heatRadiusPx(b.count) * mpp,
      {
        style: new mk.Style({
          fillColor: densityFill(b.count),
          fillOpacity: 0.7,
          lineWidth: 0,
          strokeOpacity: 0,
        }),
        // Stashed so the resize pass can recompute this overlay's pixel
        // radius without re-deriving which bucket it came from.
        data: { count: b.count },
      },
    );
    overlay.addEventListener?.("select", () => onSelect(b));
    return overlay;
  });
  map.addOverlays(overlays);
  return overlays;
}

/** Re-apply the pixel-derived radii after the camera moved. */
export function resizeHeatOverlays(map: MKMap, overlays: MKOverlay[]) {
  const mpp = metresPerPixel(map);
  if (!mpp) return;
  for (const o of overlays) {
    const count = Number((o as { data?: { count?: number } }).data?.count ?? 1);
    o.radius = heatRadiusPx(count) * mpp;
  }
}

/**
 * The "N jobs here" caption a heat bubble used to open as a Leaflet popup.
 * MapKit has no overlay callout, so the same words render as a small frosted
 * chip over the map — shown on tap, alongside the zoom-in that tap performs.
 */
export function HeatCaption({ count }: { count: number }) {
  return (
    <div
      role="status"
      data-testid="browse-map-heat-caption"
      className="absolute left-1/2 -translate-x-1/2 z-[400] px-3 py-2 rounded-ds-md text-center pointer-events-none"
      style={{
        top: "3.25rem",
        background: "hsla(0, 0%, 100%, 0.92)",
        border: "0.5px solid hsl(var(--olivewood) / 0.18)",
        boxShadow: "0 4px 14px -4px hsl(var(--olivewood) / 0.18)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <p className="font-sans font-semibold text-ds-13 leading-tight" style={{ color: "hsl(var(--bark))" }}>
        {count} {count === 1 ? "job" : "jobs"} here
      </p>
      <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Tap the bubble to zoom in.
      </p>
    </div>
  );
}

// Floating "recenter" control — sits over the map, bottom-right above
// the dock clearance. Flies back to the same Louisiana frame the map
// opens on, so users who have panned/zoomed deep get the statewide view
// back in one tap. Takes the handler as a prop now that there is no
// `useMap()` to reach for.
export function RecenterControl({ onRecenter }: { onRecenter: () => void }) {
  return (
    <button
      type="button"
      onClick={onRecenter}
      aria-label="Recenter map"
      title="Recenter map"
      data-testid="browse-map-recenter"
      className="absolute z-[400] w-11 h-11 rounded-full flex items-center justify-center active:scale-[0.94] transition-all"
      style={{
        // Sit clear of the floating dock + FAB at the bottom of the
        // screen. The parent map div bleeds beneath the dock so the
        // button needs to anchor above it.
        right: "0.75rem",
        bottom: "calc(var(--safe-area-bottom, 0px) + 96px + 0.75rem)",
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
