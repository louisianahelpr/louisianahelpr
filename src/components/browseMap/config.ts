import { JOB_CATEGORY_LABELS } from "@/lib/jobCategories";

// Static config, types, and localStorage helpers for BrowseMap.
// Extracted verbatim from BrowseMap.tsx — pure data + pure helpers with
// no map/effect coupling, so they move cleanly out of the render file.

// Above this many open jobs, default to Heat view so the user sees
// hotspots at a glance instead of a soup of clustered pins. The user
// can still flip back to Pins via the top-right toggle.
export const HEAT_AUTO_THRESHOLD = 50;

// Persisted user choice for the Pins/Heat toggle. Stored in
// localStorage so a helper who prefers Heat across sessions keeps it
// without re-toggling on every map open. The presence of any stored
// value also suppresses the auto-Heat-at-threshold behavior so we
// never overwrite an explicit user preference.
const LAYER_STORAGE_KEY = "helpr_browse_map_layer";
export type MapLayer = "pins" | "heat";

export function readStoredLayer(): MapLayer | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(LAYER_STORAGE_KEY);
    return v === "pins" || v === "heat" ? v : null;
  } catch {
    // localStorage can throw in privacy mode / sandboxed contexts —
    // just fall back to "no preference stored".
    return null;
  }
}

export function writeStoredLayer(layer: MapLayer): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAYER_STORAGE_KEY, layer);
  } catch {
    // Swallow — the toggle still works in memory for this session.
  }
}

export interface MapJob {
  id: string;
  title: string;
  category: string;
  budget: number;
  is_urgent: boolean;
  latitude: number;
  longitude: number;
  parish: string | null;
  created_at: string;
}

// The DEFAULT CAMERA: Louisiana's real geographic extent (state bounding
// box — 28.92 N at the Gulf toe to 33.02 N at the Arkansas line, 94.04 W
// at the Texas line to 88.76 W at the Mississippi line, per USGS).
//
// The map used to open at a fixed centre (31.0, -92.0) and zoom 7, which on a
// phone frames roughly a 9-degree box — Arkansas, Missouri, Mississippi,
// Alabama and a lot of Gulf, with Louisiana a smallish patch inside it.
// For a Louisiana-only marketplace the state should fill the frame, so we
// fit these bounds and let Leaflet pick the zoom for the actual viewport.
// (Fitting bounds also keeps the state framed on a tablet or a desktop
// rail-inset pane, where one hard-coded zoom never could.)
export const LA_STATE_BOUNDS: [[number, number], [number, number]] = [
  [28.92, -94.05], // SW — Gulf coast / Texas line
  [33.02, -88.76], // NE — Arkansas / Mississippi line
];

// Hard pan limit around Louisiana (+ a little margin). Without it the map
// drags infinitely into empty ocean/world, which reads as "the whole screen
// is scrolling left and right". `maxBoundsViscosity: 1` makes the edge solid
// so a drag can't fling the state off-screen; minZoom keeps it from zooming
// out to the whole globe.
export const LA_BOUNDS: [[number, number], [number, number]] = [
  [28.5, -94.6], // SW (Gulf coast / TX line)
  [33.3, -88.4], // NE (AR/MS line)
];
export const LA_MIN_ZOOM = 6;

// Category → human label, used by the pin popup. Canonical table lives in
// `src/lib/jobCategories.ts`; re-exported here so existing importers keep
// working and a pin popup can never disagree with the filter chip above it.
export const categoryLabels = JOB_CATEGORY_LABELS;
