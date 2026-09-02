// TrackingMap — Uber-style live-tracking mini-map for in-progress jobs.
//
// Rendered inside JobTracking when a helper is "on_the_way" and their
// live location (lat/lng from the job_tracking row) is available.
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
import { divIcon, point as leafletPoint } from "leaflet";
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

// Helper pin — a moving vehicle indicator (olive circle with parchment center)
function helperIcon() {
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
  return divIcon({
    className: "tracking-helper-pin",
    html,
    iconSize: leafletPoint(32, 32),
    iconAnchor: leafletPoint(16, 16),
  });
}

// Destination pin — classic drop-pin in burnt-sienna
function destinationIcon() {
  const sienna = resolveToken("--burnt-sienna", "#A0613B");
  const parchment = resolveToken("--parchment", "#FAF8F5");
  const html = `
    <svg width="24" height="32" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.5 14 22 14 22s14-12.5 14-22C28 6.27 21.73 0 14 0z"
        fill="${sienna}" />
      <circle cx="14" cy="14" r="5" fill="${parchment}" />
    </svg>
  `;
  return divIcon({
    className: "tracking-dest-pin",
    html,
    iconSize: leafletPoint(24, 32),
    iconAnchor: leafletPoint(12, 32),
    popupAnchor: leafletPoint(0, -32),
  });
}

// Fit the viewport to include both points with generous padding so
// neither pin is clipped behind the card edge.
function FitBounds({
  helperLat,
  helperLng,
  destLat,
  destLng,
}: {
  helperLat: number;
  helperLng: number;
  destLat: number;
  destLng: number;
}) {
  const map = useMap();
  useEffect(() => {
    try {
      map.fitBounds(
        [[helperLat, helperLng], [destLat, destLng]],
        { padding: [36, 36], maxZoom: 15 },
      );
    } catch {
      // fitBounds can throw when positions are identical — fall back to
      // centering on the helper at a reasonable zoom.
      map.setView([helperLat, helperLng], 13);
    }
  }, [map, helperLat, helperLng, destLat, destLng]);
  return null;
}

interface TrackingMapProps {
  /** Helper's current position (from the live job_tracking row). */
  helperLat: number;
  helperLng: number;
  /** Job destination (from the jobs row). */
  destLat: number;
  destLng: number;
}

export function TrackingMap({
  helperLat,
  helperLng,
  destLat,
  destLng,
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
        />
        {/* Helper — moving truck icon.
            `alt` matters here: Leaflet renders markers with keyboard: true by
            default, so each of these becomes a focusable role="button" in the
            tab order. divIcon({html}) supplies no accessible name, so a
            screen-reader user met two unlabelled buttons on a map whose entire
            purpose is telling them where two things are. */}
        <Marker
          position={[helperLat, helperLng]}
          icon={helperIcon()}
          alt="Your Helpr's current location"
        />
        {/* Job destination — classic drop-pin */}
        <Marker
          position={[destLat, destLng]}
          icon={destinationIcon()}
          alt="The job location"
        />
      </MapContainer>
    </div>
  );
}
