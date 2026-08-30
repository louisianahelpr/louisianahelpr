// Marker/cluster element builders + heat-density helpers for BrowseMap.
//
// Ported from Leaflet `divIcon`s to MapKit JS custom annotations: MapKit's
// `mapkit.Annotation(coordinate, factory)` takes a FACTORY that returns a real
// DOM element rather than an HTML string, so these now build and return
// elements. The markup, sizes, colours and shadows are byte-for-byte the same
// as the Leaflet div-icons they replace — the pin is still a 28x36 teardrop in
// the category hue with a burnt-sienna ring when urgent, and the cluster is
// still a bark circle with a parchment count.
//
// NOTE: `bucketJobs` groups already-coarsened pin coordinates into ~0.1°
// visual heat buckets — it is a display grouping, NOT the privacy coarsening
// (that happens server-side in the get_open_jobs_for_map RPC). Untouched here.

import { categoryHue } from "@/lib/categoryHues";
import type { MapJob } from "./config";

function resolveToken(varName: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v ? `hsl(${v})` : fallback;
}

/** Pin geometry, exported because the annotation's anchor offset has to
 *  agree with it: MapKit centres an element on its coordinate, so the pin
 *  is shifted up by half its height to put the TIP on the coordinate (the
 *  Leaflet `iconAnchor: [14, 36]` equivalent). */
export const PIN_WIDTH = 28;
export const PIN_HEIGHT = 36;

/**
 * Branded cluster bubble. MapKit clusters natively (annotations sharing a
 * `clusteringIdentifier` collapse, and the map's `annotationForCluster`
 * callback supplies the stand-in annotation) — but its default cluster is an
 * unstyled marker, exactly the problem react-leaflet-cluster had. So we render
 * it ourselves: a bark circle with a cream count, so "7 jobs near New Orleans"
 * reads instantly and tapping it zooms in.
 */
export function clusterElement(count: number): HTMLElement {
  const size = count >= 10 ? 44 : count >= 5 ? 40 : 36;
  const bark = resolveToken("--bark", "#5E6544");
  const parchment = resolveToken("--parchment", "#FAF8F5");
  const el = document.createElement("div");
  el.className = "browse-map-cluster";
  el.style.cssText = [
    `width:${size}px`,
    `height:${size}px`,
    "border-radius:9999px",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    `background:${bark}`,
    `color:${parchment}`,
    "font-family:ui-sans-serif,system-ui,sans-serif",
    "font-weight:800",
    `font-size:${count >= 10 ? 15 : 14}px`,
    `border:2px solid ${parchment}`,
    "box-shadow:0 4px 12px -2px rgba(46,46,40,0.45)",
    "cursor:pointer",
  ].join(";");
  el.textContent = String(count);
  return el;
}

export function pinElement(category: string, isUrgent: boolean): HTMLElement {
  const color = categoryHue(category);
  const sienna = resolveToken("--burnt-sienna", "#A0613B");
  const parchment = resolveToken("--parchment", "#FAF8F5");
  const ring = isUrgent ? `stroke="${sienna}" stroke-width="2.5"` : "";
  const el = document.createElement("div");
  el.className = "browse-map-pin";
  el.style.cssText = `width:${PIN_WIDTH}px;height:${PIN_HEIGHT}px;cursor:pointer;`;
  el.innerHTML = `
    <svg width="${PIN_WIDTH}" height="${PIN_HEIGHT}" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.5 14 22 14 22s14-12.5 14-22C28 6.27 21.73 0 14 0z"
        fill="${color}" ${ring} />
      <circle cx="14" cy="14" r="5" fill="${parchment}" />
    </svg>
  `;
  return el;
}

// Density-aware tint for the heatmap layer. Lower count → cooler
// olivewood; higher count → warm burnt-sienna. Caps at 8+ jobs per
// cluster bucket so a single hot zip doesn't bleach the rest of the
// state.
export function densityFill(count: number): string {
  if (count >= 8) return "hsla(15, 55%, 45%, 0.65)"; // burnt-sienna heavy
  if (count >= 5) return "hsla(15, 50%, 50%, 0.55)";
  if (count >= 3) return "hsla(25, 55%, 55%, 0.50)";
  if (count >= 2) return "hsla(38, 55%, 60%, 0.45)"; // gold-warm
  return "hsla(70, 25%, 50%, 0.40)"; // bark-cool
}

/** The heat bubble's on-screen radius in CSS PIXELS — the exact Leaflet
 *  `CircleMarker` radius formula. Converted to metres against the live camera
 *  at draw time (see `metresPerPixel` in ./mapkitRuntime). */
export function heatRadiusPx(count: number): number {
  return Math.min(8 + count * 4, 36);
}

// Group jobs into ~0.1° lat/lng buckets for a quick density map without
// pulling in a heat-map library. Each bucket becomes a circle sized by job
// count. Cheap, dependency-free, and still gives the "where's the work"
// glance pattern.
export function bucketJobs(jobs: MapJob[]): Array<{
  center: [number, number];
  count: number;
}> {
  const buckets = new Map<string, { lat: number; lng: number; count: number }>();
  for (const j of jobs) {
    const lat = Math.round(Number(j.latitude) * 10) / 10;
    const lng = Math.round(Number(j.longitude) * 10) / 10;
    const key = `${lat}:${lng}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      existing.lat = (existing.lat * (existing.count - 1) + lat) / existing.count;
      existing.lng = (existing.lng * (existing.count - 1) + lng) / existing.count;
    } else {
      buckets.set(key, { lat, lng, count: 1 });
    }
  }
  return [...buckets.values()].map((b) => ({ center: [b.lat, b.lng] as [number, number], count: b.count }));
}
