// TrackingMap — tracking mini-map for in-progress jobs.
//
// Rendered inside JobTracking from "on_the_way" until the job is marked done
// (owner, 2026-09-14: "Keep map until done"), whenever the job_tracking row
// carries a position. En route that position is live; after arrival it is the
// last ping, and the helper pin says so.
//
// APPLE MAPKIT JS (owner decision, 2026-09-19: one map provider everywhere).
// This was the last Leaflet + OpenStreetMap surface in the app; BrowseMap,
// AppleMapPreview and JobLocationPreview were already MapKit. The SDK comes
// from Apple's CDN via the shared `useMapKitJs` loader — the same loader,
// the same origin-locked token, the same script tag — so no second loader and
// no npm map dependency is introduced. The component is lazy-loaded at the
// call site, so it is only fetched when a job actually reaches these steps.
//
// GRACEFUL DEGRADATION MATTERS MORE HERE, NOT LESS. Leaflet shipped in the
// bundle; MapKit is a third-party script from cdn.apple-mapkit.com that a CSP,
// a sandboxed WebView, an offline phone or a missing/rejected token can all
// stop. So every non-ready outcome lands somewhere honest and same-sized:
//   • the 180px frame is ALWAYS drawn, so the tracker never reflows and never
//     shows a blank grey hole;
//   • an unusable MapKit (missing token, script error, a construction throw,
//     or a load that simply never settles) gets a calm "map isn't available"
//     panel in that frame;
//   • that panel still carries the settled arrival fact. It has to: when the
//     map is shown, JobTracking's status line DROPS that clause and hands it
//     to the job pin (VN-20, `arrivalOnMap`), so a silent map would take the
//     fact off the screen entirely.
// Nothing here throws: every MapKit call is guarded, because the only thing
// worse than a tracker with no map is a tracker that white-screens.
//
// Theme: MapKit's own `colorScheme` follows `<html data-theme>` (the same
// source BrowseMap watches), and the pin SVGs resolve their brand tokens at
// build time, rebuilding when the theme flips.
//
// Accessibility: the two pins are `role="img"` with real names and no tab
// stop — see `trackingMap/trackingMarkers.ts` for why that is the right answer
// here and `role="button"` is the right answer on BrowseMap.

import { useEffect, useRef, useState } from "react";
import { MapPinOff } from "lucide-react";
import { useMapKitJs } from "@/hooks/useMapKitJs";
import { report } from "@/lib/errorLogger";
import {
  colorSchemeFor,
  getMapKit,
  regionFromBounds,
  type MapKitRuntime,
  type MKAnnotation,
  type MKCoordinateRegion,
  type MKMap,
} from "./browseMap/mapkitRuntime";
import {
  DESTINATION_MARKER_H,
  destinationMarkerElement,
  helperMarkerElement,
  safeDestinationLabel,
} from "./trackingMap/trackingMarkers";

/** The frame's fixed height. The map, the loading state and the unavailable
 *  panel are all exactly this tall so the tracker never reflows. */
const MAP_HEIGHT = 180;

/**
 * How long the map may sit un-drawn before it admits it isn't coming.
 *
 * Same watchdog, same reasoning as `JobLocationPreview`: `useMapKitJs` can
 * legitimately take a while (Apple's 807KB script plus an 8s token budget),
 * but "still loading" must not be a terminal state. 15s is deliberately
 * generous — its job is to terminate "never", not to be snappy.
 */
const MAP_LOAD_TIMEOUT_MS = 15_000;

/** Reads the app's resolved theme off `<html data-theme>` (set by
 *  `useDarkMode`), exactly as BrowseMap does, so the tiles match the card. */
function readIsDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-theme") === "dark";
}

/**
 * The camera frame holding both points with room to spare — Leaflet's
 * `fitBounds([...], { padding: [36, 36], maxZoom: 15 })`.
 *
 * `regionFromBounds` is BrowseMap's helper, reused rather than re-derived: it
 * pads the box and floors the span (0.02°, ~2km), which is what keeps two
 * pins a few metres apart from framing at maximum zoom the way Leaflet's
 * `maxZoom` did.
 *
 * `labelled` — the job pin carries an arrival pill standing ~22px above it, so
 * the camera centre shifts NORTH by a slice of the visible height, which
 * pushes both pins DOWN the frame and leaves the pill inside it. That is the
 * region equivalent of Leaflet's asymmetric `paddingTopLeft`.
 */
export function trackingRegion(
  mk: MapKitRuntime,
  helperLat: number,
  helperLng: number,
  destLat: number,
  destLng: number,
  labelled: boolean,
): MKCoordinateRegion {
  const region = regionFromBounds(
    mk,
    [
      [Math.min(helperLat, destLat), Math.min(helperLng, destLng)],
      [Math.max(helperLat, destLat), Math.max(helperLng, destLng)],
    ],
    1.5,
  );
  if (!labelled) return region;
  return new mk.CoordinateRegion(
    new mk.Coordinate(
      region.center.latitude + region.span.latitudeDelta * 0.08,
      region.center.longitude,
    ),
    new mk.CoordinateSpan(region.span.latitudeDelta, region.span.longitudeDelta),
  );
}

/**
 * Make sure MapKit hasn't parked a tab stop on a marker that does nothing.
 *
 * The markers themselves are `role="img"`, `tabindex="-1"` (see
 * `trackingMarkers.ts`), but MapKit wraps every custom annotation in a
 * container it owns and can decide to make selectable. This mirrors the
 * marker's own signal onto that wrapper. Deliberately narrow: it walks up at
 * most a few levels and stops at the first ancestor that isn't an annotation
 * container, so it can never reach — and never un-focus — MapKit's own
 * keyboard-pannable map surface.
 */
function neutraliseMarkerFocus(map: MKMap): void {
  map.element.querySelectorAll<HTMLElement>("[data-tracking-marker]").forEach((marker) => {
    let node: HTMLElement | null = marker.parentElement;
    for (let hops = 0; node && node !== map.element && hops < 3; hops++) {
      const isAnnotationWrapper = Array.from(node.classList).some((c) => /annotation/i.test(c));
      if (!isAnnotationWrapper) break;
      if (node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
      if (node.getAttribute("role") === "button") node.removeAttribute("role");
      node = node.parentElement;
    }
  });
}

interface TrackingMapProps {
  /** Helper's current position (from the live job_tracking row). */
  helperLat: number;
  helperLng: number;
  /** Job destination (from the jobs row). */
  destLat: number;
  destLng: number;
  /** Settled arrival fact to label the job pin with (VN-20), or null. */
  destinationLabel?: string | null;
  /** True while en route (a live position); false once arrived (last ping). */
  helperLive?: boolean;
}

export function TrackingMap({
  helperLat,
  helperLng,
  destLat,
  destLng,
  destinationLabel = null,
  helperLive = true,
}: TrackingMapProps) {
  const mapKitStatus = useMapKitJs();
  const [isDark, setIsDark] = useState(readIsDark);
  const [mapReady, setMapReady] = useState(false);
  /** The map construction itself threw. Treated exactly like a failed load —
   *  a half-built map is not something to leave on screen. */
  const [constructFailed, setConstructFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  // A CALLBACK REF HELD IN STATE, not a plain ref (BrowseMap's reasoning): the
  // map surface is not in the tree while the unavailable panel is showing, so
  // a plain ref would still be null the one time the creation effect ran.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  const mapRef = useRef<MKMap | null>(null);
  const annotationsRef = useRef<{ helper: MKAnnotation; destination: MKAnnotation } | null>(null);
  // Latest coordinates, readable from the annotation-building effect without
  // making it rebuild the elements every time a ping moves the helper.
  const coordsRef = useRef({ helperLat, helperLng, destLat, destLng });
  coordsRef.current = { helperLat, helperLng, destLat, destLng };

  const labelled = safeDestinationLabel(destinationLabel) !== null;

  // Watchdog — see MAP_LOAD_TIMEOUT_MS. Cleared the moment the map draws.
  useEffect(() => {
    if (mapReady) return;
    const t = setTimeout(() => setTimedOut(true), MAP_LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [mapReady]);

  // Follow the app's light/dark theme, same observer BrowseMap uses.
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const obs = new MutationObserver(() => setIsDark(readIsDark()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // Create the map exactly once, as soon as MapKit authorizes.
  useEffect(() => {
    if (mapKitStatus !== "ready" || mapRef.current || !containerEl) return;
    const mk = getMapKit();
    if (!mk) return;
    try {
      const { helperLat: hLat, helperLng: hLng, destLat: dLat, destLng: dLng } = coordsRef.current;
      mapRef.current = new mk.Map(containerEl, {
        region: trackingRegion(mk, hLat, hLng, dLat, dLng, labelled),
        colorScheme: colorSchemeFor(mk, readIsDark()),
        showsCompass: mk.FeatureVisibility?.Hidden ?? "hidden",
        showsScale: mk.FeatureVisibility?.Hidden ?? "hidden",
        showsZoomControl: false,
        showsMapTypeControl: false,
        showsUserLocationControl: false,
        // STATIC, like the app's other inline preview maps. Leaflet already
        // disabled wheel zoom here (`scrollWheelZoom={false}`) because a
        // 180px map living inside a scrolling job card must never eat the
        // page scroll — and MapKit has no separate wheel flag, so leaving
        // zoom on would hand the scroll hijack straight back. The camera
        // already frames both pins; there is nothing here to explore.
        isZoomEnabled: false,
        isScrollEnabled: false,
        isRotationEnabled: false,
      });
      setMapReady(true);
    } catch (e) {
      report(e instanceof Error ? e : new Error("MapKit map construction failed"), {
        tags: { source: "TrackingMap.mapkit" },
      });
      setConstructFailed(true);
    }
    // The coordinates are read through `coordsRef`, not from props: they are
    // the FIRST frame only, and re-running this effect on every ping would
    // mean building a second map. The region effect below owns every later
    // camera change. `mapRef.current` makes the whole effect idempotent.
  }, [mapKitStatus, containerEl, labelled]);

  // Tear the map down on unmount, separate from the creation effect so no
  // status change can destroy a live map out from under the user.
  useEffect(() => {
    return () => {
      try {
        mapRef.current?.destroy?.();
      } catch {
        // Teardown only, and we are already unmounting: there is no state
        // left to correct and nobody left to tell. A runtime that refuses
        // to destroy its own map must not take the unmount down with it.
      }
      mapRef.current = null;
      annotationsRef.current = null;
    };
  }, []);

  // Theme → MapKit's own tiles.
  useEffect(() => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map) return;
    try {
      map.colorScheme = colorSchemeFor(mk, isDark);
    } catch { /* older runtimes may not allow reassignment — leave as built */ }
  }, [isDark, mapReady]);

  // The two pins. Rebuilt only when their APPEARANCE can have changed (the
  // arrival label, live-vs-last-ping, the theme the SVG tokens resolved
  // against) — a ping that only moves the helper is handled by the region
  // effect below, which moves the existing annotation instead of replacing
  // the element under the user.
  useEffect(() => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map) return;
    const { helperLat: hLat, helperLng: hLng, destLat: dLat, destLng: dLng } = coordsRef.current;
    const previous = annotationsRef.current;
    if (previous) {
      try {
        map.removeAnnotations([previous.helper, previous.destination]);
      } catch {
        // A pin we could not remove is a stale pin, not a broken tracker.
        // The rebuild below still runs, so the map stays correct-ish rather
        // than disappearing; reporting a MapKit DOM hiccup per re-render
        // would be noise, and the annotations ref is cleared either way.
      }
      annotationsRef.current = null;
    }
    try {
      // Helper — the coordinate is the CENTRE of the disc, so no anchor
      // offset (Leaflet's `iconAnchor: [16, 16]`).
      const helper = new mk.Annotation(
        new mk.Coordinate(hLat, hLng),
        () => helperMarkerElement(helperLive),
        { calloutEnabled: false, enabled: false },
      );
      // Destination — the coordinate is the TIP at the element's bottom edge,
      // and MapKit centres an element on its coordinate, so lift it by half
      // the pin height (Leaflet's `iconAnchor: [12, 32]`).
      const destination = new mk.Annotation(
        new mk.Coordinate(dLat, dLng),
        () => destinationMarkerElement(destinationLabel),
        {
          anchorOffset:
            typeof DOMPoint === "function" ? new DOMPoint(0, -DESTINATION_MARKER_H / 2) : undefined,
          calloutEnabled: false,
          enabled: false,
        },
      );
      map.addAnnotations([helper, destination]);
      annotationsRef.current = { helper, destination };
    } catch (e) {
      report(e instanceof Error ? e : new Error("MapKit annotation build failed"), {
        tags: { source: "TrackingMap.annotations" },
      });
      return;
    }
    // MapKit builds and restyles annotation nodes asynchronously, so this
    // runs on the next frame rather than inline.
    const raf = requestAnimationFrame(() => {
      try {
        neutraliseMarkerFocus(map);
      } catch {
        // Belt-and-braces over MapKit's own DOM. If its internals moved and
        // the walk throws, the markers themselves are still role="img" with
        // tabindex -1 — this pass only covers a wrapper MapKit may add, so
        // failing it degrades to "as before", never to a broken map.
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [mapReady, destinationLabel, helperLive, isDark]);

  // Move the pins and re-frame the camera as new pings arrive.
  //
  // `animate: false` — the Leaflet version had to pass it because an animated
  // zoom finishes on a timer that reads the map pane, and unmounting the card
  // mid-animation (switching My Jobs tabs) threw "reading '_leaflet_pos'" 13
  // times into error_logs. The reasoning carries over unchanged: a 180px
  // preview gains nothing from the animation, and an animation outliving its
  // container is a crash looking for a place to happen.
  useEffect(() => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map) return;
    const annotations = annotationsRef.current;
    try {
      if (annotations) {
        annotations.helper.coordinate = new mk.Coordinate(helperLat, helperLng);
        annotations.destination.coordinate = new mk.Coordinate(destLat, destLng);
      }
      map.setRegionAnimated(
        trackingRegion(mk, helperLat, helperLng, destLat, destLng, labelled),
        false,
      );
    } catch { /* a runtime that refuses the region keeps the frame it has */ }
  }, [helperLat, helperLng, destLat, destLng, labelled, mapReady]);

  const frameStyle = {
    height: MAP_HEIGHT,
    border: "0.5px solid hsl(var(--olivewood) / 0.22)",
    boxShadow:
      "inset 0 1px 1px 0 rgba(255,255,255,0.35), " +
      "0 4px 14px -4px hsl(var(--olivewood) / 0.18)",
  } as const;

  // MapKit can't be used: no token, the script was blocked or errored, the
  // constructor threw, or it never settled. Say so in the frame's own
  // footprint — and keep the settled arrival fact on screen, because the
  // status line above has already handed it to the (now absent) job pin.
  const unusable =
    mapKitStatus === "missing-token" ||
    mapKitStatus === "error" ||
    constructFailed ||
    (timedOut && !mapReady);

  if (unusable) {
    return (
      <div
        role="status"
        data-testid="tracking-map-unavailable"
        className="w-full rounded-ds-md overflow-hidden flex flex-col items-center justify-center gap-1.5 px-4 text-center"
        style={frameStyle}
      >
        <MapPinOff
          className="w-5 h-5"
          style={{ color: "hsl(var(--olivewood) / 0.7)" }}
          aria-hidden="true"
        />
        <p className="text-ds-11" style={{ color: "hsl(var(--olivewood))" }}>
          The live map isn't available right now.
        </p>
        {safeDestinationLabel(destinationLabel) && (
          <p className="text-ds-10 text-muted-foreground" data-testid="tracking-map-arrival-fallback">
            {safeDestinationLabel(destinationLabel)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full rounded-ds-md overflow-hidden relative" style={frameStyle}>
      <div
        ref={setContainerEl}
        data-testid="tracking-map-surface"
        // `group`, NOT `img` and NOT `application`: `img` would make the two
        // pins presentational and throw away the names that are the whole
        // point of this map, and `application` claims a keyboard mode this
        // static map does not have. A named group with two named images is
        // exactly what is on screen.
        role="group"
        aria-label="Map showing your Helpr and the job location"
        style={{ height: "100%", width: "100%" }}
      />
      {/* Soft cover until MapKit paints, so the first frame is a transition
          rather than a flash of half-drawn map. Pointer events pass through. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none transition-opacity duration-500"
        style={{
          opacity: mapReady ? 0 : 1,
          background: "hsl(var(--olivewood) / 0.08)",
        }}
      />
    </div>
  );
}
