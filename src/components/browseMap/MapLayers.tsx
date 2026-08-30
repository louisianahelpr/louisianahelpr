// Map overlays/controls for BrowseMap.
//
// Under Leaflet these were react-leaflet CHILD COMPONENTS that reached for
// `useMap()`. MapKit JS has no React binding — the map is a single imperative
// object we own — so the map-driven layer (fit-to-pins) is a plain function
// that takes the map instance, and only the piece that is really DOM (the
// recenter button) stays a component. The behaviour, geometry and colour
// tokens are unchanged.

import { Crosshair } from "lucide-react";
import { LA_STATE_BOUNDS, type MapJob } from "./config";
import { regionFromBounds, type MKMap, type MapKitRuntime } from "./mapkitRuntime";

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
