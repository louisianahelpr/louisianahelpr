import { JOB_CATEGORY_LABELS } from "@/lib/jobCategories";

// Static config, types, and localStorage helpers for BrowseMap.
// Extracted verbatim from BrowseMap.tsx — pure data + pure helpers with
// no map/effect coupling, so they move cleanly out of the render file.

// The Pins/Heat toggle, its localStorage persistence, and the
// auto-switch-to-Heat-above-50-jobs heuristic were removed 2026-08-30
// (owner: "remove heat, pins are fine"). The map is pins-only now.

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

  // ── Browse-card parity fields ───────────────────────────────────────────
  // Added to `get_open_jobs_for_map` by migration 20260823120000 so a pin
  // popup can describe a job with the same "what / where / when" a JobCard
  // does. Every one of them is ALREADY public on /jobs via
  // `get_ranked_open_jobs`, and `location` arrives pre-masked to "City, State"
  // by `public.mask_job_location()` — no new PII reaches the map.
  //
  // DELIBERATELY OPTIONAL, not `| null`. Migrations auto-deploy on merge but
  // not instantly, so between the merge and db-deploy finishing the RPC still
  // returns the old nine-column row and these keys are ABSENT, not null.
  // `MapJobPopup` distinguishes the two: an absent key hides the row, a null
  // value renders the card's own fallback ("Flexible"). Without the
  // distinction the popup would either print blank rows or claim a job is
  // flexible when it simply hasn't been told the date yet.

  /** Masked "City, State" — never the street line or ZIP. */
  location?: string | null;
  /** ISO `YYYY-MM-DD`. */
  date_needed?: string | null;
  /** Postgres `time` — `HH:MM:SS`. */
  start_time?: string | null;
  /** Customer-paid urgent bonus, in dollars. */
  urgent_fee?: number | null;
  is_group_job?: boolean | null;
  helpers_needed?: number | null;
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

// Category → human label, used by the pin popup. Canonical table lives in
// `src/lib/jobCategories.ts`; re-exported here so existing importers keep
// working and a pin popup can never disagree with the filter chip above it.
export const categoryLabels = JOB_CATEGORY_LABELS;

/**
 * The ONE dock-clearance constant for everything the map floats over its own
 * bottom edge — the recenter control and the pin-preview sheet.
 *
 * The map pane deliberately bleeds UNDER the app's floating bottom dock + Post
 * FAB (see BrowseTasksFeed's `pb-0`), so anything the map anchors to
 * `bottom: 0` lands beneath them. This is the height that has to be given back.
 *
 * DERIVED, not guessed: it is byte-for-byte Tailwind's `safe-nav` spacing token
 * (`tailwind.config.ts`), the value every `pb-safe-nav` page in the app already
 * clears the dock with. `RecenterControl` used to hard-code
 * `... + 96px + 0.75rem` privately, which was wrong twice over — it was a
 * one-off nobody else shared, and the literal 96px kept reserving a dock's
 * worth of space on the surfaces that have no dock (signed-out `/browse`,
 * where `MobileNav` sets `--bottom-nav-h: 0px` via `html.no-bottom-nav`).
 * Reading the variable means the map's floating controls sit exactly on the
 * same floor as every other screen's content, dock or no dock.
 */
export const MAP_DOCK_CLEARANCE =
  "calc(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px) + 1rem)";
