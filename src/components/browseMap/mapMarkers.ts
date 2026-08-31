// Marker/cluster element builders for BrowseMap.
//
// Ported from Leaflet `divIcon`s to MapKit JS custom annotations: MapKit's
// `mapkit.Annotation(coordinate, factory)` takes a FACTORY that returns a real
// DOM element rather than an HTML string, so these now build and return
// elements. The markup, sizes, colours and shadows are byte-for-byte the same
// as the Leaflet div-icons they replace — the pin is still a 28x36 teardrop in
// the category hue with a burnt-sienna ring when urgent, and the cluster is
// still a bark circle with a parchment count.

import { categoryHue } from "@/lib/categoryHues";

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

export function pinElement(category: string, isUrgent: boolean, jobId?: string): HTMLElement {
  const color = categoryHue(category);
  const sienna = resolveToken("--burnt-sienna", "#A0613B");
  const parchment = resolveToken("--parchment", "#FAF8F5");
  const ring = isUrgent ? `stroke="${sienna}" stroke-width="2.5"` : "";
  const el = document.createElement("div");
  el.className = "browse-map-pin";
  // Tags the pin with its job id so the desktop split-view can find and
  // scale THIS element when the matching feed card is hovered
  // (BrowseMap's hoveredJobId effect below) without re-rendering the
  // annotation — MapKit only calls this factory once per annotation.
  if (jobId) el.dataset.jobId = jobId;
  // Container keeps the LOGICAL 28x36 size the caller anchors against
  // (PIN_WIDTH/PIN_HEIGHT drive BrowseMap's anchorOffset math), but the
  // SVG itself renders 4px larger on every side with `overflow: visible`
  // so the urgent ring's 2.5px stroke has room to paint — the path's own
  // outline touches the viewBox edge exactly, so a stroke centered on it
  // was getting clipped by the SVG's own bounding box before this.
  // `transition:transform` + `transform-origin:bottom center` so the
  // hover-scale (applied via a `.browse-map-pin-hovered` class, not an
  // inline style, so it never fights the container's own logical size)
  // grows the pin from its tip, matching where it's anchored on the map.
  el.style.cssText = `width:${PIN_WIDTH}px;height:${PIN_HEIGHT}px;cursor:pointer;overflow:visible;transition:transform 150ms ease-out;transform-origin:bottom center;`;
  el.innerHTML = `
    <svg width="${PIN_WIDTH + 4}" height="${PIN_HEIGHT + 4}" viewBox="-2 -2 32 40"
      style="overflow:visible;margin:-2px;" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.5 14 22 14 22s14-12.5 14-22C28 6.27 21.73 0 14 0z"
        fill="${color}" ${ring} />
      <circle cx="14" cy="14" r="5" fill="${parchment}" />
    </svg>
  `;
  return el;
}
