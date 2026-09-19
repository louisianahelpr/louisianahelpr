// Marker element builders for TrackingMap.
//
// Ported from Leaflet `divIcon`s (HTML STRINGS) to Apple MapKit JS custom
// annotations (real DOM ELEMENTS), so every map in the app runs on one
// provider. `mapkit.Annotation(coordinate, factory)` calls `factory` and
// mounts whatever element it returns, which is why these return nodes.
//
// ACCESSIBILITY — the mirror image of BrowseMap's pins, and deliberately NOT
// the same answer. BrowseMap's pins ARE the map's only affordance for reaching
// a job, so they are `role="button"`, focusable, and Enter/Space-activatable.
// These two are not affordances at all: nothing happens when you press them.
// So they are `role="img"` with a real accessible name and NO tab stop — a
// screen reader announces "Your Helpr's current location" and a keyboard user
// is never parked on a control that does nothing.
//
// That distinction is the whole history of this file. Under Leaflet these
// markers were focusable `role="button"` nodes with NO accessible name at all
// (Leaflet's `keyboard: true` default), and the obvious fix — `<Marker
// alt="...">` — is silently dropped for a `<div>` icon, so it read as a fix
// and changed nothing. See docs/OPEN.md 2026-09-14 and
// src/test/mapMarkerAccessibleName.test.ts. MapKit adds no role and no tab
// index of its own to a custom annotation element, so the role/name we set
// here is the whole story; `TrackingMap.tsx` additionally neutralises any tab
// stop a MapKit container puts around them.

/**
 * Resolve a brand token to its computed colour so the marker SVG (which is
 * built outside React and therefore cannot use a Tailwind class) tracks the
 * light/dark theme. Falls back to the prior literal if the var can't be read
 * (SSR, a detached document), so the pins still render.
 *
 * Same shape as `browseMap/mapMarkers.ts` and `AppleMapPreview` — the native
 * map SDKs cannot read a CSS custom property, so every map surface resolves
 * its own. `src/test/alarmColourInvariant.test.ts` allows the hex fallbacks
 * on exactly these `resolveToken` lines.
 */
function resolveToken(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v ? `hsl(${v})` : fallback;
}

/** Helper pin geometry. The point is the CENTRE of the disc, so the
 *  annotation needs no anchor offset (Leaflet's `iconAnchor: [16, 16]`). */
export const HELPER_MARKER_SIZE = 32;

/** Destination pin geometry. The point is the TIP, at the bottom edge, so the
 *  annotation lifts the element by half its height (Leaflet's
 *  `iconAnchor: [12, 32]`). */
export const DESTINATION_MARKER_W = 24;
export const DESTINATION_MARKER_H = 32;

/** The accessible name for the helper pin.
 *  `live` is false once the helper has arrived: the point is then their last
 *  ping, not a current position, and the name must not claim more. */
export function helperMarkerName(live: boolean): string {
  return live ? "Your Helpr's current location" : "Your Helpr's last shared location";
}

/**
 * Helper pin — a moving vehicle indicator (olive disc with a parchment truck).
 */
export function helperMarkerElement(live = true): HTMLElement {
  const olive = resolveToken("--olivewood", "hsl(83,18%,36%)");
  const parchment = resolveToken("--parchment", "#FAF8F5");
  const el = document.createElement("div");
  el.className = "tracking-helper-pin";
  el.dataset.trackingMarker = "helper";
  el.style.cssText = [
    `width:${HELPER_MARKER_SIZE}px`,
    `height:${HELPER_MARKER_SIZE}px`,
    "border-radius:9999px",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    `background:${olive}`,
    `border:2.5px solid ${parchment}`,
    "box-shadow:0 3px 10px -2px rgba(46,46,40,0.45)",
    // Not a control: never show a pointer, never take a tap the map wanted.
    "pointer-events:none",
  ].join(";");
  el.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v5h-2"
        stroke="${parchment}" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round"/>
      <circle cx="7.5" cy="17.5" r="2.5" stroke="${parchment}" stroke-width="2"/>
      <circle cx="17.5" cy="17.5" r="2.5" stroke="${parchment}" stroke-width="2"/>
    </svg>
  `;
  nameAsImage(el, helperMarkerName(live));
  return el;
}

/**
 * Arrival labels the destination pin may carry. A CLOSED SET, not free text.
 *
 * Under Leaflet the label was interpolated into an HTML string, so the closed
 * set was the only thing standing between a job row and stored XSS. It is now
 * written with `textContent`, which cannot execute anything — but the set
 * stays: it is also the product contract (these are the only two settled
 * arrival facts the tracker states), and defence in depth costs nothing.
 */
export const DESTINATION_LABELS = new Set([
  "Location confirmed",
  "Arrival confirmed by the person who posted it",
]);

/** The label if it is one of the settled arrival facts, else null. */
export function safeDestinationLabel(label?: string | null): string | null {
  return label && DESTINATION_LABELS.has(label) ? label : null;
}

/** The accessible name for the destination pin, including its settled
 *  arrival fact when it has one (VN-20). */
export function destinationMarkerName(label?: string | null): string {
  const safe = safeDestinationLabel(label);
  return safe ? `The job location · ${safe}` : "The job location";
}

/**
 * Destination pin — classic drop-pin in burnt-sienna.
 *
 * `label` is the settled arrival fact (owner, 2026-09-14, VN-20: "Location
 * confirmed does not need to show on the tracker, it should be on the map").
 * It sits as a small pill directly above the pin, absolutely positioned
 * against the marker element itself, so it moves with the pin and does not
 * change the 24x32 footprint the anchor offset is computed from.
 */
export function destinationMarkerElement(label?: string | null): HTMLElement {
  const sienna = resolveToken("--burnt-sienna", "#A0613B");
  const parchment = resolveToken("--parchment", "#FAF8F5");
  const ink = resolveToken("--ink-deep", "#2E2E28");
  const safeLabel = safeDestinationLabel(label);

  const el = document.createElement("div");
  el.className = "tracking-dest-pin";
  el.dataset.trackingMarker = "destination";
  el.style.cssText = [
    `width:${DESTINATION_MARKER_W}px`,
    `height:${DESTINATION_MARKER_H}px`,
    // The pill above is `position:absolute`; this is what it anchors to.
    // MapKit positions its own wrapper, not this node, so making this the
    // containing block is safe and keeps the pill glued to the pin.
    "position:relative",
    "overflow:visible",
    "pointer-events:none",
  ].join(";");
  el.innerHTML = `
    <svg width="${DESTINATION_MARKER_W}" height="${DESTINATION_MARKER_H}" viewBox="0 0 28 36"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.5 14 22 14 22s14-12.5 14-22C28 6.27 21.73 0 14 0z"
        fill="${sienna}" />
      <circle cx="14" cy="14" r="5" fill="${parchment}" />
    </svg>
  `;

  if (safeLabel) {
    const pill = document.createElement("div");
    pill.dataset.arrivalLabel = "";
    pill.style.cssText = [
      "position:absolute",
      "left:50%",
      "bottom:calc(100% + 3px)",
      "transform:translateX(-50%)",
      "white-space:nowrap",
      "padding:2px 7px",
      "border-radius:9999px",
      `background:${parchment}`,
      `color:${ink}`,
      `border:0.5px solid ${sienna}`,
      "box-shadow:0 2px 6px -2px rgba(46,46,40,0.35)",
      "font-family:Montserrat,'Montserrat Fallback',system-ui,sans-serif",
      "font-size:10px",
      "font-weight:600",
      "line-height:1.45",
      "pointer-events:none",
    ].join(";");
    // textContent, never innerHTML: the pill is the one place a database
    // string reaches the marker DOM.
    pill.textContent = safeLabel;
    // The pill repeats what the pin's own accessible name already says, so
    // it is decoration to a screen reader.
    pill.setAttribute("aria-hidden", "true");
    el.appendChild(pill);
  }

  nameAsImage(el, destinationMarkerName(label));
  return el;
}

/**
 * Give a non-interactive marker element a real accessible name WITHOUT making
 * it a control or a tab stop.
 *
 * `role="img"` (not `button`) is the point: these markers do nothing when
 * activated, so a command role would be a lie and a focus stop on them would
 * be a dead end. The name still has to exist — the map's entire purpose is
 * telling someone where two things are.
 */
function nameAsImage(el: HTMLElement, label: string): void {
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  el.setAttribute("title", label);
  // Explicit, not merely absent: MapKit re-parents these nodes, and an
  // ancestor made focusable later must not drag them into the tab order.
  el.tabIndex = -1;
}
