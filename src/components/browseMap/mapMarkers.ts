// Marker/cluster icon builders + heat-density helpers for BrowseMap.
// Moved verbatim from BrowseMap.tsx. NOTE: `bucketJobs` groups already-
// coarsened pin coordinates into ~0.1° visual heat buckets — it is a
// display grouping, NOT the privacy coarsening (that happens server-side
// in the get_open_jobs_for_map RPC). Untouched here regardless.

import { divIcon, point as leafletPoint } from "leaflet";
import type { MapJob } from "./config";

function resolveToken(varName: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v ? `hsl(${v})` : fallback;
}

// Fix Leaflet's default-icon-not-found problem when bundlers can't
// resolve the asset paths. We use a small inline div-icon instead so
// pins render reliably across web + Capacitor iOS.
// Muted, earthy per-category pin colors. Every tone is desaturated to sit
// calmly on the warm parchment map (no loud saturated pins), yet each
// category gets its OWN hue so they stay distinguishable — the old map
// reused 4 colors across 10 categories, so half of them looked identical.
export const categoryColors: Record<string, string> = {
  cleaning: "#6F8A78", // sage green
  yard_work: "#7E8A4E", // moss / olive
  moving: "#B27A48", // clay / terracotta
  errands: "#C7A75E", // warm gold
  handyman: "#8C6A52", // taupe brown
  painting: "#A86E6A", // dusty rose-clay
  delivery: "#6E8597", // muted slate blue
  pet_care: "#C99E78", // soft camel
  assembly: "#8A7B57", // khaki
  other: "#8A8576", // warm gray
};

// Branded cluster bubble. react-leaflet-cluster's built-in cluster styling
// relies on the leaflet.markercluster default CSS (not imported here, to
// keep the bundle lean), which made a cluster render as a tiny unstyled
// dot — so a metro of jobs looked like a single faint pin. This div-icon
// renders the cluster ourselves as a bark circle with a cream count, so
// "7 jobs near New Orleans" reads instantly and tapping it spiderfies/zooms.
export function clusterIcon(cluster: { getChildCount: () => number }) {
  const count = cluster.getChildCount();
  const size = count >= 10 ? 44 : count >= 5 ? 40 : 36;
  const bark = resolveToken("--bark", "#5E6544");
  const parchment = resolveToken("--parchment", "#FAF8F5");
  const html = `
    <div style="
      width:${size}px;height:${size}px;border-radius:9999px;
      display:flex;align-items:center;justify-content:center;
      background:${bark};color:${parchment};
      font-family:ui-sans-serif,system-ui,sans-serif;font-weight:800;
      font-size:${count >= 10 ? 15 : 14}px;
      border:2px solid ${parchment};
      box-shadow:0 4px 12px -2px rgba(46,46,40,0.45);
    ">${count}</div>
  `;
  return divIcon({
    html,
    className: "browse-map-cluster",
    iconSize: leafletPoint(size, size),
    iconAnchor: leafletPoint(size / 2, size / 2),
  });
}

export function pinIcon(category: string, isUrgent: boolean) {
  const color = categoryColors[category] ?? "#7A7E68";
  const ring = isUrgent ? "stroke=\"#A0613B\" stroke-width=\"2.5\"" : "";
  const html = `
    <svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.5 14 22 14 22s14-12.5 14-22C28 6.27 21.73 0 14 0z"
        fill="${color}" ${ring} />
      <circle cx="14" cy="14" r="5" fill="#FAF8F5" />
    </svg>
  `;
  return divIcon({
    className: "browse-map-pin",
    html,
    iconSize: leafletPoint(28, 36),
    iconAnchor: leafletPoint(14, 36),
    popupAnchor: leafletPoint(0, -32),
  });
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

// Group jobs into ~0.1° lat/lng buckets for a quick density map without
// pulling in leaflet.heat. Each bucket becomes a CircleMarker sized by
// job count. Cheap, dependency-free, and still gives the "where's the
// work" glance pattern.
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
