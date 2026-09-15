// TrackingMap — tracking mini-map for in-progress jobs.
//
// Rendered inside JobTracking from "on_the_way" until the job is marked done
// (owner, 2026-09-14: "Keep map until done"), whenever the job_tracking row
// carries a position. En route that position is live; after arrival it is the
// last ping, and the helper pin says so.
//
// Uses the same Leaflet + react-leaflet stack as BrowseMap (react-leaflet
// is already in the bundle; no new vendor or API-key path is introduced).
// The component is lazy-loaded at the call-site so it only adds to the
// bundle when actually mounted.
//
// Graceful degradation: if Leaflet can't load (e.g. CSP on a sandboxed
// WebView) or either coordinate pair is missing, the parent falls back
// to the existing ETA text — this component simply returns null.

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import { divIcon, point as leafletPoint, type DivIcon } from "leaflet";
import "leaflet/dist/leaflet.css";

// Resolve a brand token to its computed hex so the inline SVG markup
// (built as a string for Leaflet's divIcon) tracks light/dark theme
// changes via the CSS custom properties. Falls back to the prior literal
// hex if the var resolution fails (e.g. SSR), so the pins still render.
function resolveToken(varName: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return v ? `hsl(${v})` : fallback;
}

// Leaflet renders markers with `keyboard: true` by default, so every marker
// below becomes a focusable `role="button"` in the tab order (Marker.js's
// `_initIcon`: `if (options.keyboard) { icon.tabIndex = '0'; icon.setAttribute
// ('role', 'button'); }`) — a command role an a11y sweep correctly flags if it
// has no accessible name. `<Marker alt="...">` looks like the fix, but Leaflet
// only copies that option onto the icon node `if (icon.tagName === 'IMG')`;
// a `divIcon` icon is a `<div>`, so `alt` is silently dropped and the button
// stays unlabelled — a screen-reader user meets two unnamed buttons on a map
// whose entire purpose is telling them where two things are.
// This wraps `createIcon` to stamp a real `aria-label` onto the DOM node
// Leaflet hands back, so it survives every re-render (a fresh `DivIcon` is
// built on every render here) and every marker re-icon.
function withAccessibleName<T extends DivIcon>(icon: T, label: string): T {
  const createIcon = icon.createIcon.bind(icon);
  icon.createIcon = (oldIcon?: HTMLElement) => {
    const el = createIcon(oldIcon);
    el.setAttribute("aria-label", label);
    return el;
  };
  return icon;
}

// Helper pin — a moving vehicle indicator (olive circle with parchment center).
// `live` is false once the helper has arrived: the point is then their last
// ping, not a current position, and the accessible name must not claim more.
export function helperIcon(live = true) {
  const olive = resolveToken("--olivewood", "hsl(83,18%,36%)");
  const parchment = resolveToken("--parchment", "#FAF8F5");
  const html = `
    <div style="
      width:32px;height:32px;border-radius:9999px;
      display:flex;align-items:center;justify-content:center;
      background:${olive};
      border:2.5px solid ${parchment};
      box-shadow:0 3px 10px -2px rgba(46,46,40,0.45);
    ">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        xmlns="http://www.w3.org/2000/svg">
        <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v5h-2"
          stroke="${parchment}" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round"/>
        <circle cx="7.5" cy="17.5" r="2.5" stroke="${parchment}" stroke-width="2"/>
        <circle cx="17.5" cy="17.5" r="2.5" stroke="${parchment}" stroke-width="2"/>
      </svg>
    </div>
  `;
  return withAccessibleName(
    divIcon({
      className: "tracking-helper-pin",
      html,
      iconSize: leafletPoint(32, 32),
      iconAnchor: leafletPoint(16, 16),
    }),
    live ? "Your Helpr's current location" : "Your Helpr's last shared location",
  );
}

// Arrival labels this pin may carry. A closed set, not free text: the label is
// interpolated into divIcon HTML, so only these fixed strings may reach it.
const DESTINATION_LABELS = new Set(["Location confirmed", "Poster confirmed arrival"]);

// Destination pin — classic drop-pin in burnt-sienna.
//
// `label` is the settled arrival fact (owner, 2026-09-14, VN-20: "Location
// confirmed does not need to show on the tracker, it should be on the map").
// It sits as a small pill directly above the pin. The marker icon element is
// `position: absolute`, so the pill anchors to the pin itself and moves with
// it; the pin's 24x32 hit box is unchanged.
export function destinationIcon(label?: string | null) {
  const sienna = resolveToken("--burnt-sienna", "#A0613B");
  const parchment = resolveToken("--parchment", "#FAF8F5");
  const ink = resolveToken("--ink-deep", "#2E2E28");
  const safeLabel = label && DESTINATION_LABELS.has(label) ? label : null;
  const labelHtml = safeLabel
    ? `
    <div data-arrival-label style="
      position:absolute;left:50%;bottom:calc(100% + 3px);transform:translateX(-50%);
      white-space:nowrap;padding:2px 7px;border-radius:9999px;
      background:${parchment};color:${ink};
      border:0.5px solid ${sienna};
      box-shadow:0 2px 6px -2px rgba(46,46,40,0.35);
      font-family:Montserrat,'Montserrat Fallback',system-ui,sans-serif;
      font-size:10px;font-weight:600;line-height:1.45;
      pointer-events:none;
    ">${safeLabel}</div>`
    : "";
  const html = `${labelHtml}
    <svg width="24" height="32" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.5 14 22 14 22s14-12.5 14-22C28 6.27 21.73 0 14 0z"
        fill="${sienna}" />
      <circle cx="14" cy="14" r="5" fill="${parchment}" />
    </svg>
  `;
  return withAccessibleName(
    divIcon({
      className: "tracking-dest-pin",
      html,
      iconSize: leafletPoint(24, 32),
      iconAnchor: leafletPoint(12, 32),
      popupAnchor: leafletPoint(0, -32),
    }),
    safeLabel ? `The job location · ${safeLabel}` : "The job location",
  );
}

// Fit the viewport to include both points with generous padding so
// neither pin is clipped behind the card edge.
function FitBounds({
  helperLat,
  helperLng,
  destLat,
  destLng,
  labelled,
}: {
  helperLat: number;
  helperLng: number;
  destLat: number;
  destLng: number;
  /** The job pin carries an arrival label — reserve room above it. */
  labelled: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    // animate: false. An animated zoom finishes on a timer that reads the map
    // pane; when the card unmounts mid-animation (switching My Jobs tabs) the
    // pane is gone and Leaflet throws "reading '_leaflet_pos'", which reached
    // error_logs 13 times from /my-jobs (journeys lane, 2026-09-12). A 180px
    // preview gains nothing from the animation.
    try {
      // A labelled pin stands ~54px above its point (32px pin + pill), so
      // the top inset grows to keep the label inside the 180px frame.
      map.fitBounds(
        [[helperLat, helperLng], [destLat, destLng]],
        labelled
          ? { paddingTopLeft: [36, 60], paddingBottomRight: [36, 36], maxZoom: 15, animate: false }
          : { padding: [36, 36], maxZoom: 15, animate: false },
      );
    } catch {
      // fitBounds can throw when positions are identical — fall back to
      // centering on the helper at a reasonable zoom.
      map.setView([helperLat, helperLng], 13, { animate: false });
    }
  }, [map, helperLat, helperLng, destLat, destLng, labelled]);
  return null;
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
  return (
    <div
      className="w-full rounded-ds-md overflow-hidden"
      style={{
        height: 180,
        border: "0.5px solid hsl(var(--olivewood) / 0.22)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255,255,255,0.35), " +
          "0 4px 14px -4px hsl(var(--olivewood) / 0.18)",
      }}
    >
      <MapContainer
        center={[helperLat, helperLng]}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds
          helperLat={helperLat}
          helperLng={helperLng}
          destLat={destLat}
          destLng={destLng}
          labelled={!!destinationLabel}
        />
        {/* Helper — moving truck icon. Accessible name is stamped onto the
            marker's DOM node by `withAccessibleName` in `helperIcon()` above
            (see the comment there for why `alt` alone doesn't work here). */}
        <Marker position={[helperLat, helperLng]} icon={helperIcon(helperLive)} />
        {/* Job destination — classic drop-pin, labelled with a settled
            arrival when there is one (VN-20). */}
        <Marker position={[destLat, destLng]} icon={destinationIcon(destinationLabel)} />
      </MapContainer>
    </div>
  );
}
