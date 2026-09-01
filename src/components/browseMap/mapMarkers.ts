// Marker/cluster element builders for BrowseMap.
//
// Ported from Leaflet `divIcon`s to MapKit JS custom annotations: MapKit's
// `mapkit.Annotation(coordinate, factory)` takes a FACTORY that returns a real
// DOM element rather than an HTML string, so these now build and return
// elements. The pin is still a 28x36 teardrop in the category hue, and the
// cluster is still a bark circle with a parchment count.
//
// ACCESSIBILITY (2026-08-31): these elements are the map's ONLY affordance for
// reaching a job, so they have to behave like the buttons they are — MapKit
// hands us a bare `<div>` and adds nothing itself. Every pin and cluster is now
// `role="button"` + `tabIndex=0` with a real accessible name (title, category,
// where, urgency / "N jobs here"), and Enter/Space activate it exactly like a
// pointer tap. Before this a keyboard user could not reach a single pin, and a
// screen reader met an unnamed, unlabelled div. (`TrackingMap.tsx` has the
// mirror-image bug — Leaflet's `keyboard: true` makes its markers focusable
// with NO accessible name — but that file is owned elsewhere; reported, not
// touched.)
//
// COLOUR IS NEVER THE ONLY SIGNAL (WCAG 1.4.1): the category hue is a
// cross-surface parity cue (it is literally the same `categoryHues` value the
// feed card's left rail paints), and urgency now carries a SHAPE difference —
// an urgent pin's head holds a bolt glyph, a normal pin's holds a disc — so the
// burnt-sienna ring is no longer the only thing distinguishing the two. Both
// facts are also in the accessible name.

import { categoryHue } from "@/lib/categoryHues";
import { jobCategoryLabel } from "@/lib/jobCategories";

function resolveToken(varName: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v ? `hsl(${v})` : fallback;
}

/** Pin geometry, exported because the annotation's anchor offset has to
 *  agree with it: MapKit centres an element on its coordinate, so the pin
 *  is shifted up by half its height to put the TIP on the coordinate (the
 *  Leaflet `iconAnchor: [14, 36]` equivalent). */
const PIN_WIDTH = 28;
export const PIN_HEIGHT = 36;

/**
 * Make a non-`<button>` element behave like one for the keyboard.
 *
 * MapKit annotation elements can't BE `<button>`s (MapKit positions and
 * transforms the node it is handed, and a focusable button inside its own
 * pointer pipeline swallows the map's drag), so they are `role="button"`
 * divs — which means Enter/Space have to be wired by hand. Space is
 * `preventDefault`ed so activating a focused pin never scrolls the page
 * behind the map.
 */
function wireButtonBehaviour(
  el: HTMLElement,
  label: string,
  activate: (fromKeyboard: boolean) => void,
) {
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", label);
  el.setAttribute("title", label);
  el.tabIndex = 0;
  el.addEventListener("click", () => activate(false));
  el.addEventListener("keydown", (e) => {
    const key = (e as KeyboardEvent).key;
    if (key === "Enter" || key === " " || key === "Spacebar") {
      e.preventDefault();
      // `true` tells the caller this came from the keyboard, which is what
      // decides whether focus is moved into whatever opens. A pointer tap must
      // NOT move focus (on iOS that scrolls the WebView to the focused node);
      // a keypress MUST, or the thing that just opened is unreachable.
      activate(true);
    }
  });
}

/**
 * Branded cluster bubble. MapKit clusters natively (annotations sharing a
 * `clusteringIdentifier` collapse, and the map's `annotationForCluster`
 * callback supplies the stand-in annotation) — but its default cluster is an
 * unstyled marker, exactly the problem react-leaflet-cluster had. So we render
 * it ourselves: a bark circle with a cream count, so "7 jobs near New Orleans"
 * reads instantly and tapping (or Entering) it zooms in.
 */
export function clusterElement(count: number, onActivate?: () => void): HTMLElement {
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
  // The visible glyph is a bare number ("6"), which on its own tells a screen
  // reader nothing about what it is or what activating it does.
  wireButtonBehaviour(
    el,
    `${count} ${count === 1 ? "job" : "jobs"} in this area — zoom in to see them`,
    // A cluster only moves the camera, so pointer and keyboard do the same thing.
    () => onActivate?.(),
  );
  return el;
}

export interface PinOptions {
  category: string;
  isUrgent: boolean;
  jobId?: string;
  /** Job title — the first thing the accessible name says. */
  title?: string;
  /** Masked "City, State" (or parish), for the accessible name only. */
  where?: string | null;
  /** Called on tap AND on Enter/Space; `fromKeyboard` distinguishes the two. */
  onActivate?: (fromKeyboard: boolean) => void;
}

export function pinElement({
  category,
  isUrgent,
  jobId,
  title,
  where,
  onActivate,
}: PinOptions): HTMLElement {
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
  // BrowseMap also uses it to return focus to the pin when its preview
  // sheet is closed from the keyboard.
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
  // The head glyph is the NON-COLOUR urgency signal (WCAG 1.4.1): a bolt for
  // urgent, a plain disc otherwise. Same bolt the feed card's "Urgent" chip
  // uses, so the two surfaces say urgency with one shape.
  const head = isUrgent
    ? `<g transform="translate(14 14) scale(0.46) translate(-12 -12)">
         <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="${parchment}" />
       </g>`
    : `<circle cx="14" cy="14" r="5" fill="${parchment}" />`;
  el.innerHTML = `
    <svg width="${PIN_WIDTH + 4}" height="${PIN_HEIGHT + 4}" viewBox="-2 -2 32 40"
      style="overflow:visible;margin:-2px;" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.5 14 22 14 22s14-12.5 14-22C28 6.27 21.73 0 14 0z"
        fill="${color}" ${ring} />
      ${head}
    </svg>
  `;
  const name = [
    title || "Open job",
    jobCategoryLabel(category),
    where || null,
    isUrgent ? "urgent" : null,
  ]
    .filter(Boolean)
    .join(" — ");
  wireButtonBehaviour(el, name, (fromKeyboard) => onActivate?.(fromKeyboard));
  return el;
}
