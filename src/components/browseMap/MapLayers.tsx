// Map child components for BrowseMap — each is a child of MapContainer so
// it can grab useMap(). Moved verbatim from BrowseMap.tsx; every hook call,
// dependency array, color token, and className is preserved exactly.

import { useEffect } from "react";
import { Popup, useMap, CircleMarker } from "react-leaflet";
import { Crosshair } from "lucide-react";
import { densityFill } from "./mapMarkers";
import { LA_STATE_BOUNDS, type MapJob } from "./config";

// Auto-fit the map to whatever pins exist when they load. If only one
// pin, zoom in to a useful neighborhood-level view instead of a
// state-wide one. With NO pins, fall back to framing Louisiana itself —
// previously this bailed early and left the map on its initial camera,
// which is how an empty (or heavily filtered) map ended up showing five
// states with Louisiana off to one side.
/**
 * Fit by LATITUDE, cropping east/west.
 *
 * `fitBounds` picks the zoom at which BOTH dimensions fit, so in a tall narrow
 * column the WIDTH is the binding constraint: it zoomed out far enough to fit
 * Louisiana's ~5.3° of longitude into ~335px, which left a screen's worth of
 * vertical slack filled with Missouri above and open Gulf below. The state was
 * correctly framed and still didn't look like it (owner: "should be focused on
 * LA" — and then, given the trade, "crop east/west").
 *
 * Collapsing the longitude span to a single meridian removes the horizontal
 * constraint, so the zoom comes from the latitude span alone and the frame
 * fills top to bottom. The east and west edges crop instead — a pin out at a
 * corner may sit just off-screen until the user pans, which is the trade that
 * was chosen deliberately over the state floating in a sea of other states.
 *
 * `maxBounds` still stops the pan running off into empty ocean, so cropping
 * never becomes losing your place.
 */
function fitByLatitude(
  map: ReturnType<typeof useMap>,
  bounds: [[number, number], [number, number]],
  opts: { padding: [number, number]; maxZoom?: number },
) {
  // Collapsing the box to a single meridian is what removes the horizontal
  // constraint — `fitBounds` then has only the latitude span to satisfy.
  const [[south, west], [north, east]] = bounds;
  const centerLon = (west + east) / 2;
  map.fitBounds(
    [
      [south, centerLon],
      [north, centerLon],
    ],
    opts,
  );
}

export function FitToPins({ jobs }: { jobs: MapJob[] }) {
  const map = useMap();
  useEffect(() => {
    // ONE pin: that neighbourhood is the whole story, so go there.
    if (jobs.length === 1) {
      map.setView([jobs[0].latitude, jobs[0].longitude], 13);
      return;
    }
    // Otherwise frame LOUISIANA, not the pins.
    //
    // Fitting the pins' own bounds is what made this look wrong: the board's
    // jobs cluster along the south of the state, so their latitude span is a
    // fraction of a degree and a fit-to-pins put the map at street level over
    // Saint Martinville with no pin in sight, while fitting them by longitude
    // (the old behaviour) zoomed out until Missouri and the Gulf filled the
    // column. Neither answers "where in Louisiana is the work" — the state
    // does, and it is the same frame every time the map loads, which is what
    // makes it readable at a glance.
    //
    // The STATE sets both the zoom (its latitude span — see the crop note
    // above) and the centre. Centring on the pins instead pulled the frame east
    // with the New Orleans cluster and put Jackson, Mississippi in the middle of
    // a map of Louisiana; the crop has to fall symmetrically on the state for
    // the state to be what you see.
    const [[south, west], [north, east]] = LA_STATE_BOUNDS;
    fitByLatitude(map, LA_STATE_BOUNDS, { padding: [16, 16] });
    map.setView([(south + north) / 2, (west + east) / 2], map.getZoom(), {
      animate: false,
    });
  }, [jobs, map]);
  return null;
}

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
            <p className="font-sans font-semibold text-ds-13 leading-tight">
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
// the dock clearance. Flies back to the same Louisiana frame the map
// opens on, so users who have panned/zoomed deep get the statewide view
// back in one tap.
export function RecenterControl() {
  const map = useMap();
  return (
    <button
      type="button"
      onClick={() => {
        // Same latitude-only framing the initial fit uses, so "recenter" puts
        // the map back exactly where it started rather than to a wider view.
        const [[south, west], [north, east]] = LA_STATE_BOUNDS;
        const centerLon = (west + east) / 2;
        map.flyToBounds(
          [
            [south, centerLon],
            [north, centerLon],
          ],
          { padding: [16, 16], duration: 0.45 },
        );
      }}
      aria-label="Recenter map"
      title="Recenter map"
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
