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
import {
  regionFromBounds,
  type MKCoordinateRegion,
  type MKMap,
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
/**
 * Give a region a BOTTOM INSET, in pixels of the live pane.
 *
 * The map pane bleeds under the app's floating dock + FAB, so the lowest
 * ~112px of it is covered: a pin auto-framed into that band is drawn but
 * cannot be tapped, and a keyboard user tabbing to it gets a focus ring on
 * something behind the dock. Verified 2026-08-31 by hit-testing every pin
 * inside the dock's rect — two of three answered the dock, not the pin.
 *
 * Growing the latitude span by `paneH / (paneH - inset)` and holding the TOP
 * edge fixed adds the extra ground at the BOTTOM, which is exactly the strip
 * the dock hides — so everything the fit was trying to show ends up above it.
 */
function insetRegionBottom(
  mk: MapKitRuntime,
  region: MKCoordinateRegion,
  paneHeight: number,
  insetPx: number,
): MKCoordinateRegion {
  if (!(paneHeight > 0) || !(insetPx > 0) || insetPx >= paneHeight * 0.6) return region;
  const grown = region.span.latitudeDelta * (paneHeight / (paneHeight - insetPx));
  const topEdge = region.center.latitude + region.span.latitudeDelta / 2;
  return new mk.CoordinateRegion(
    new mk.Coordinate(topEdge - grown / 2, region.center.longitude),
    new mk.CoordinateSpan(grown, region.span.longitudeDelta),
  );
}

export function fitToPins(
  mk: MapKitRuntime,
  map: MKMap,
  jobs: MapJob[],
  animate = false,
  /** Height of the pane strip the dock/FAB covers, in CSS px. */
  bottomInsetPx = 0,
) {
  const paneHeight = map.element?.clientHeight ?? 0;
  const inset = (r: MKCoordinateRegion) => insetRegionBottom(mk, r, paneHeight, bottomInsetPx);
  if (jobs.length === 0) {
    // The empty/statewide frame is deliberately the whole state, uninset — it
    // is a picture of Louisiana, not a set of targets to hit.
    map.setRegionAnimated(laRegion(mk), animate);
    return;
  }
  if (jobs.length === 1) {
    // ~Leaflet zoom 13: a neighbourhood-level span rather than a state one.
    const region = new mk.CoordinateRegion(
      new mk.Coordinate(Number(jobs[0].latitude), Number(jobs[0].longitude)),
      new mk.CoordinateSpan(0.06, 0.06),
    );
    map.setRegionAnimated(inset(region), animate);
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
  map.setRegionAnimated(inset(region), animate);
}

// "Recenter" control — flies back to the same Louisiana frame the map opens
// on, so users who have panned/zoomed deep get the statewide view back in one
// tap. Takes the handler as a prop now that there is no `useMap()` to reach for.
//
// NOT self-positioned any more (2026-08-31). It used to be `position:absolute`
// with its own `bottom: safe-area + 96px` — the same constant the FAB and the
// dock use — which meant it sat in the one corner most likely to be crowded,
// and nothing could move it when the pin preview opened underneath. It is now a
// plain button laid out by BrowseMap's bottom control stack, which owns the
// single dock-clearance constant and lifts the whole stack above the preview
// sheet when one is open. 44x44 (w-11 h-11) meets the project tap-target floor.
export function RecenterControl({ onRecenter }: { onRecenter: () => void }) {
  return (
    <button
      type="button"
      onClick={onRecenter}
      aria-label="Recenter map"
      title="Recenter map"
      data-testid="browse-map-recenter"
      className="pointer-events-auto w-11 h-11 rounded-full flex items-center justify-center active:scale-[0.94] transition-all"
      style={{
        // TOKENS, not a literal white (fixed 2026-08-31). This was
        // `hsla(0,0%,100%,0.85)` with `color: hsl(var(--olivewood))`. In light
        // mode that reads as a frosted white puck with a dark glyph — but
        // `--olivewood` INVERTS in dark mode (36 15% 80%, a near-white warm),
        // so on the dark map the control became a near-white glyph on a
        // near-white puck: measured ~1.4:1, far under the 3:1 WCAG 1.4.11 floor
        // for a UI component. `--card` flips with the theme the way
        // `--olivewood` does, so the pair stays legible in both.
        background: "hsl(var(--card) / 0.88)",
        border: "1px solid hsl(var(--olivewood) / 0.22)",
        color: "hsl(var(--olivewood))",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow:
          "inset 0 1px 1px 0 hsl(var(--card) / 0.6), " +
          "0 4px 14px -4px hsl(var(--olivewood) / 0.22)",
      }}
    >
      <Crosshair className="w-4 h-4" strokeWidth={2.25} />
    </button>
  );
}
