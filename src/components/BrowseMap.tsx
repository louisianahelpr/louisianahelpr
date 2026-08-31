// BrowseMap — Apple MapKit JS map showing open Louisiana jobs as pins. The
// "force multiplier" from the audit: open the app, see the marketplace
// alive on a parish map, tap a pin → see the job → 1-tap apply.
//
// Privacy: pins use coordinates rounded to ~110m via the public
// get_open_jobs_for_map RPC. The doorstep/exact location is never
// exposed to anonymous viewers. Authenticated users see the full
// address only after a job is accepted.
//
// Bundle weight: MapKit JS is loaded from Apple's CDN by `useMapKitJs` —
// there is no npm map dependency in the bundle at all now (this screen used
// to pull leaflet + react-leaflet + react-leaflet-cluster, ~45KB gzipped).
// The SDK is fetched only on surfaces that actually mount a map, and the same
// loader/token path already serves address autocomplete and the driving-time
// estimate, so the script is usually warm by the time /browse asks for it.
//
// Structure: static config/types/storage live in ./browseMap/config,
// marker element builders in ./browseMap/mapMarkers, the MapKit runtime
// typings + the pixel↔metre bridge in ./browseMap/mapkitRuntime, and the map
// overlays/controls in ./browseMap/MapLayers. This file owns the data fetch,
// the imperative map lifecycle, and the pin PREVIEW SHEET.
//
// Pin preview (reworked 2026-08-31): tapping a pin no longer opens a MapKit
// callout floating over the pin. It opens a bottom sheet this component
// renders, anchored above the dock in the map's own bottom control stack,
// holding the same `<JobCard bare>` the feed renders. See the `selectedJobId`
// state and the "Bottom control stack" block in the JSX for why.

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import { BellRing, MapPin, MapPinOff, Loader2, X } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { useMapKitJs } from "@/hooks/useMapKitJs";
import {
  LA_BOUNDS,
  MAP_DOCK_CLEARANCE,
  type MapJob,
} from "./browseMap/config";
import { mapJobToEnrichedJob } from "./browseMap/mapJobToEnrichedJob";
import JobCard from "./dashboard/JobCard";
import { clusterElement, pinElement, PIN_HEIGHT } from "./browseMap/mapMarkers";
import {
  buildMapJobFilter,
  isAnyFilterActive,
  unsupportedMapFilters,
  type MapJobFilterInput,
} from "./browseMap/mapFilter";
import {
  fitToPins,
  laRegion,
  RecenterControl,
} from "./browseMap/MapLayers";
import {
  colorSchemeFor,
  getMapKit,
  regionFromBounds,
  type MKAnnotation,
  type MKMap,
} from "./browseMap/mapkitRuntime";

interface BrowseMapProps {
  /**
   * Tap anywhere on a pin's preview card (same tap-anywhere-opens-the-job
   * behaviour as the feed's `JobCard`, which the preview literally
   * reuses — no separate "Apply" button on the map anymore).
   */
  onJobAction?: (jobId: string) => void;
  /**
   * Current user id. When set, the popup hides jobs the user posted
   * themselves (you can't apply to your own post — same rule as the
   * Dashboard apply path). When undefined (guest), every pin is shown.
   */
  currentUserId?: string;
  /**
   * Optional CTA rendered in the empty-state ("no jobs on the map
   * today"). Used by the guest dashboard to nudge sign-up so users
   * still convert when the marketplace happens to be quiet.
   */
  emptyStateCta?: { label: string; onClick: () => void };
  /**
   * The browse filters, applied to the map's own rows. The map runs its own
   * `get_open_jobs_for_map` fetch (the list is paginated; the map is not), so
   * it has to re-apply the predicate rather than reuse `filteredJobs`.
   * Omitted by surfaces with no filter UI (the guest dashboard) — then every
   * open pin shows.
   */
  filters?: MapJobFilterInput;
  /** Clears every filter — the CTA on the "no pins match" empty state. */
  onClearFilters?: () => void;
  /**
   * Fill the parent edge to edge — no rounded top corners, no border of its
   * own (owner: "map should fill this space").
   *
   * Set on the desktop website's side-by-side column, where the map IS the
   * column: its parent already draws the hairline that separates it from the
   * feed, so a second border inset the tiles by a pixel on every side and the
   * rounded top left two corner wedges of panel showing through. The phone's
   * list⇄map toggle keeps the rounded, bordered treatment — there the map is a
   * surface floating above the dock, not a column.
   */
  flush?: boolean;
  /**
   * The viewer's platform commission percent — the SAME value the surrounding
   * feed passes to `JobCard`. With it the pin popup prints the helper's net
   * take-home, so a job can't read $110 on the map and $96 in the list beside
   * it. Without it the popup falls back to the gross posted budget rather than
   * guessing a fee, because a payout figure must never read higher than the
   * payout.
   */
  effectiveFee?: number;
  /**
   * Desktop split-view hover sync: the id of the job whose FEED CARD the
   * pointer is currently over (BrowseTasksFeed/Dashboard's `hoveredJobId`).
   * When set, that job's pin scales up on the map so a poster scanning the
   * list can see at a glance which pin a card corresponds to. `undefined`
   * on surfaces with no feed alongside the map (the phone list⇄map toggle,
   * the guest dashboard) — then no pin is ever highlighted this way.
   */
  hoveredJobId?: string | null;
}

/** Reads the app's resolved theme off `<html data-theme>` (set by
 *  `useDarkMode`) so the map's own tiles match the surrounding UI. */
function readIsDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-theme") === "dark";
}

export function BrowseMap({ onJobAction, currentUserId, emptyStateCta, filters, onClearFilters, effectiveFee, flush = false, hoveredJobId }: BrowseMapProps) {
  const shellClass = flush ? "" : " rounded-t-2xl border border-b-0 border-border";
  const mapKitStatus = useMapKitJs();
  const [jobs, setJobs] = useState<MapJob[]>([]);
  const [loading, setLoading] = useState(true);
  // The pin RPC used to fail SILENTLY: `if (error) { report(...); return; }`
  // left `jobs` at [], so a 500 rendered the "Empty map for now." card — the
  // map told the user Louisiana had no work when in truth the query died.
  // That is the exact failure CLAUDE.md's "never drop the Supabase error"
  // rule exists to stop, and the error-state sweep caught it on /dashboard's
  // map view (SILENT_FAILURE: 36 failed requests, no failure wording, no way
  // out). Tracked explicitly so the map can say so and offer a retry.
  const [loadError, setLoadError] = useState(false);
  /** Bumped by the retry button to re-run the fetch effect. */
  const [reloadNonce, setReloadNonce] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [isDark, setIsDark] = useState(readIsDark);

  useEffect(() => {
    let cancelled = false;
    supabase
      .rpc("get_open_jobs_for_map")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          report(error, { tags: { source: "BrowseMap.rpc" } });
          setLoadError(true);
          setLoading(false);
          return;
        }
        setLoadError(false);
        const rows = (data as MapJob[] | null) ?? [];
        // Defensive: drop any rows that snuck through with null coords
        // despite the SQL filter (e.g. type coercion oddness).
        // The RPC doesn't expose customer_id (PII concern), so we can't
        // filter "my own posts" client-side — that's fine since
        // handleApplyRequest in Dashboard already bails out with a
        // "you can't apply to your own post" toast on attempt.
        const cleaned = rows.filter(
          (j) => j.latitude !== null && j.longitude !== null && !Number.isNaN(Number(j.latitude)),
        );
        setJobs(cleaned);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId, reloadNonce]);

  // Filtered pin set. Every downstream consumer (count badge, fitToPins, the
  // markers themselves, the empty state) reads THIS, not the raw `jobs` —
  // otherwise the map would zoom to and count pins it isn't drawing.
  const visibleJobs = useMemo(
    () => (filters ? jobs.filter(buildMapJobFilter(filters)) : jobs),
    [jobs, filters],
  );
  const filtersActive = !!filters && isAnyFilterActive(filters);
  // Filters the narrow map row has no field to evaluate. Named in the UI
  // rather than silently dropped — a filter that looks applied but isn't is
  // worse than one the app says it can't apply here.
  const ignoredFilters = filters ? unsupportedMapFilters(filters) : [];

  const mapBoxRef = useRef<HTMLDivElement | null>(null);

  /**
   * The job whose preview is open, or null.
   *
   * WAS a MapKit CALLOUT — a bubble MapKit floated over the tapped pin, whose
   * body we rendered a `<JobCard>` into with a detached React root per pin.
   * That is the structural cause of everything the owner flagged:
   *   • MapKit owns a callout's position, so the card landed mid-map on top of
   *     the pins, the place labels and the map controls, and (worst) on top of
   *     the very pin that opened it;
   *   • the callout body has no chrome of its own, so the close control had
   *     nowhere structural to live and was `absolute top-1 right-1` OVER the
   *     card — which is JobCard's own top-right corner, i.e. directly on the
   *     price chip. A 24x24 stray glyph laid on the "$123", well under the
   *     44px tap-target floor, with no background and no hit area;
   *   • one React root per visible pin, all rendered up front, purely so the
   *     callout had something to measure.
   * It is now our own bottom sheet (see the preview block in the JSX), which
   * this state drives. MapKit still owns pin SELECTION — we just draw the card.
   */
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const selectedJob = useMemo(
    () => visibleJobs.find((j) => j.id === selectedJobId) ?? null,
    [visibleJobs, selectedJobId],
  );
  // A filter (or a refetch) that removes the previewed job must close the
  // preview — otherwise the sheet describes a pin that is no longer on the map.
  useEffect(() => {
    if (selectedJobId && !selectedJob) setSelectedJobId(null);
  }, [selectedJobId, selectedJob]);
  /** True when the open preview was opened from the keyboard, so focus should
   *  move into the sheet and back to the pin on close (a pointer tap must NOT
   *  steal focus — that scroll-jumps the map on iOS). */
  const openedByKeyboardRef = useRef(false);

  const retry = () => {
    setLoadError(false);
    setLoading(true);
    setReloadNonce((n) => n + 1);
  };

  // ── MapKit lifecycle ────────────────────────────────────────────────────
  const mapRef = useRef<MKMap | null>(null);
  const annotationsRef = useRef<MKAnnotation[]>([]);
  // Latest values, readable from the DOM-level pin/keyboard handlers below
  // without making them (and therefore every annotation) rebuild on change.
  const jobsRef = useRef<MapJob[]>(visibleJobs);
  jobsRef.current = visibleJobs;
  const selectedJobIdRef = useRef<string | null>(selectedJobId);
  selectedJobIdRef.current = selectedJobId;
  // A CALLBACK REF, held in state, not a plain ref: the map surface is not in
  // the tree during the loading/error early-returns, so a ref would still be
  // null the one time the creation effect ran and the map would never be
  // built. State makes the element's arrival itself the trigger.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  const mapKitUnusable = mapKitStatus === "missing-token" || mapKitStatus === "error";

  // Create the map exactly once, as soon as MapKit authorizes.
  useEffect(() => {
    if (mapKitStatus !== "ready" || mapRef.current) return;
    const mk = getMapKit();
    const el = containerEl;
    if (!mk || !el) return;
    try {
      const map = new mk.Map(el, {
        region: laRegion(mk),
        // Louisiana-only marketplace: the Leaflet map used maxBounds +
        // maxBoundsViscosity:1 + minZoom to stop a drag flinging the state
        // off-screen or zooming out to the globe. MapKit's equivalents are
        // `cameraBoundary` (a hard pan limit) and `cameraZoomRange` — the max
        // camera distance below frames roughly the same extent Leaflet's
        // minZoom 6 did.
        cameraBoundary: regionFromBounds(mk, LA_BOUNDS, 1),
        cameraZoomRange: mk.CameraZoomRange ? new mk.CameraZoomRange(0, 1_500_000) : undefined,
        colorScheme: colorSchemeFor(mk, readIsDark()),
        showsCompass: mk.FeatureVisibility?.Hidden ?? "hidden",
        showsScale: mk.FeatureVisibility?.Hidden ?? "hidden",
        showsZoomControl: false,
        showsMapTypeControl: false,
        showsUserLocationControl: false,
        isRotationEnabled: false,
      });
      // Branded cluster bubble. MapKit clusters any annotations sharing a
      // `clusteringIdentifier` and asks this callback for the stand-in
      // annotation — the native replacement for react-leaflet-cluster's
      // `iconCreateFunction`.
      map.annotationForCluster = (cluster) => {
        const members = cluster.memberAnnotations ?? [];
        const count = members.length;
        return new mk.Annotation(
          cluster.coordinate,
          () =>
            // Tap OR keyboard-activate a cluster → zoom into the jobs it
            // stands for, matching Leaflet's zoom-to-bounds-on-cluster-click.
            // The handler moved into `clusterElement` so pointer and Enter/
            // Space go through one path and the bubble carries a real
            // accessible name ("6 jobs in this area — zoom in to see them")
            // instead of a bare, unnamed "6".
            clusterElement(count, () => {
              const coords = members.map((m) => m.coordinate);
              if (!coords.length) return;
              const lats = coords.map((c) => c.latitude);
              const lngs = coords.map((c) => c.longitude);
              map.setRegionAnimated(
                regionFromBounds(
                  mk,
                  [
                    [Math.min(...lats), Math.min(...lngs)],
                    [Math.max(...lats), Math.max(...lngs)],
                  ],
                  1.4,
                ),
                true,
              );
            }),
          { calloutEnabled: false },
        );
      };
      mapRef.current = map;
      setMapReady(true);
    } catch (e) {
      report(e instanceof Error ? e : new Error("MapKit map construction failed"), {
        tags: { source: "BrowseMap.mapkit" },
      });
    }
  }, [mapKitStatus, containerEl]);

  // Tear the map down on unmount. Separate from the creation effect so a
  // status change can never destroy a live map out from under the user.
  useEffect(() => {
    return () => {
      try { mapRef.current?.destroy?.(); } catch { /* ignore */ }
      mapRef.current = null;
      annotationsRef.current = [];
    };
  }, []);

  // Follow the app's light/dark theme. `useDarkMode` writes the resolved
  // theme to `<html data-theme>`, so an attribute observer catches both an
  // explicit toggle and a system-preference flip while the map is open.
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const obs = new MutationObserver(() => setIsDark(readIsDark()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map) return;
    try {
      map.colorScheme = colorSchemeFor(mk, isDark);
    } catch { /* older runtimes may not allow reassignment — leave as built */ }
  }, [isDark, mapReady]);

  /** Remove every job annotation currently on the map. */
  const clearAnnotations = useCallback(() => {
    const map = mapRef.current;
    if (map && annotationsRef.current.length) {
      try { map.removeAnnotations(annotationsRef.current); } catch { /* ignore */ }
    }
    annotationsRef.current = [];
  }, []);

  /**
   * Open a pin's preview and slide the camera so the pin is NOT under the
   * sheet that is about to cover the bottom of the pane.
   *
   * This is the other half of the "the card covers the pin you just tapped"
   * fix: moving the card to the bottom stops it landing ON the pin, and this
   * lifts the pin into the clear upper band so the two are visibly connected.
   * The shift is a fraction of the CURRENT span, so it behaves the same at
   * every zoom level, and the camera keeps its zoom (no `fitToPins` re-frame).
   */
  const openPreview = useCallback((jobId: string, fromKeyboard: boolean) => {
    openedByKeyboardRef.current = fromKeyboard;
    setSelectedJobId(jobId);
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map) return;
    const job = jobsRef.current.find((j) => j.id === jobId);
    if (!job) return;
    try {
      const span = map.region.span;
      map.setRegionAnimated(
        new mk.CoordinateRegion(
          // South of the pin by ~18% of the visible height ⇒ the pin renders
          // ABOVE centre, in the band the sheet never reaches.
          new mk.Coordinate(Number(job.latitude) - span.latitudeDelta * 0.18, Number(job.longitude)),
          new mk.CoordinateSpan(span.latitudeDelta, span.longitudeDelta),
        ),
        true,
      );
    } catch { /* a runtime that won't hand back its region just skips the nudge */ }
  }, []);

  /** Dismiss the preview. `returnFocus` puts focus back on the pin that opened
   *  it, which is what a keyboard user expects and what makes the pin → sheet
   *  → close → pin loop traversable without a mouse. */
  const closePreview = useCallback((returnFocus: boolean) => {
    const map = mapRef.current;
    const jobId = selectedJobIdRef.current;
    setSelectedJobId(null);
    // MapKit JS deselects a pin by clearing `selectedAnnotations`.
    try { if (map) map.selectedAnnotations = []; } catch { /* ignore */ }
    if (returnFocus && jobId && map) {
      const pin = map.element.querySelector<HTMLElement>(
        `.browse-map-pin[data-job-id="${CSS.escape(jobId)}"]`,
      );
      pin?.focus();
    }
  }, []);

  /**
   * Keep only the pins a user can actually reach in the tab order.
   *
   * MapKit does not remove a clustered pin from the DOM — it leaves the
   * element parked at the cluster's position, drawn BEHIND the cluster bubble,
   * and marks it by setting `pointer-events: none` on it (verified 2026-08-31:
   * every pin under a cluster computed `none`, every standalone pin `auto`).
   * Because our pins are `tabIndex=0`, that meant a keyboard user could tab to
   * a pin that is invisible under a bubble and get a focus ring on nothing.
   * Mirroring MapKit's own signal into `tabindex`/`aria-hidden` fixes it with
   * no loss: the cluster standing in for those pins is itself focusable and
   * named ("6 jobs in this area — zoom in to see them"), and expanding it
   * hands the pins back.
   */
  const syncPinFocusability = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.element.querySelectorAll<HTMLElement>(".browse-map-pin").forEach((el) => {
      // Never hide the element that currently HAS focus — aria-hidden on the
      // active element is itself a violation, and the user is mid-interaction.
      const collapsed =
        getComputedStyle(el).pointerEvents === "none" && document.activeElement !== el;
      el.tabIndex = collapsed ? -1 : 0;
      if (collapsed) el.setAttribute("aria-hidden", "true");
      else el.removeAttribute("aria-hidden");
    });
  }, []);

  // Read through a ref so the annotation factories never close over a stale
  // `openPreview`, and so the pins effect does not rebuild every annotation
  // when it changes identity.
  const openPreviewRef = useRef(openPreview);
  openPreviewRef.current = openPreview;

  // Pins layer. Each job becomes a custom annotation. The pin ELEMENT carries
  // its own accessible name + Enter/Space handling (see `pinElement`), and
  // activating it opens the preview SHEET this component renders at the bottom
  // of the pane — MapKit's own callout is switched off (`calloutEnabled:
  // false`). Nothing is pre-rendered per pin any more: the old code built a
  // detached React root and a full `<JobCard>` for EVERY visible pin up front,
  // just so MapKit's bubble had something to measure.
  useEffect(() => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map) return;
    clearAnnotations();
    if (visibleJobs.length === 0) return;

    const annotations = visibleJobs.map((job) => {
      return new mk.Annotation(
        new mk.Coordinate(Number(job.latitude), Number(job.longitude)),
        () =>
          pinElement({
            category: job.category,
            isUrgent: job.is_urgent,
            jobId: job.id,
            title: job.title,
            where: job.location ?? job.parish,
            onActivate: (fromKeyboard) => openPreviewRef.current(job.id, fromKeyboard),
          }),
        {
          // MapKit centres a custom annotation element on its coordinate;
          // the pin's point is at its bottom edge, so lift it by half the
          // icon height (Leaflet's `iconAnchor: [14, 36]`).
          anchorOffset:
            typeof DOMPoint === "function" ? new DOMPoint(0, -PIN_HEIGHT / 2) : undefined,
          clusteringIdentifier: "browse-job",
          // OFF. MapKit positions a callout over the pin it belongs to, which
          // is precisely the overlap the owner flagged; the preview is our own
          // bottom sheet now. Selection itself still happens (the `select` /
          // `deselect` listeners below), so the pin keeps its selected state.
          calloutEnabled: false,
          data: { jobId: job.id },
        },
      );
    });
    annotationsRef.current = annotations;
    try { map.addAnnotations(annotations); } catch { /* ignore */ }
  }, [visibleJobs, mapReady, clearAnnotations]);

  // MapKit still owns SELECTION, so mirror it into our own state: selecting a
  // pin any other way (programmatically, or a tap MapKit handled before the
  // element's own click listener) opens the sheet, and deselecting — which is
  // what tapping empty map does — closes it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onSelect = (e: unknown) => {
      const annotation = (e as { annotation?: MKAnnotation }).annotation;
      const jobId = annotation?.data?.jobId;
      // Do NOT touch `openedByKeyboardRef` here — MapKit fires this for a
      // pointer tap too, and the pin element's own handler is the one that
      // knows which input opened the preview.
      if (typeof jobId === "string") setSelectedJobId(jobId);
    };
    // Guarded, not a blanket clear: switching pins fires deselect(old) and
    // select(new), and the two can arrive in either order relative to the pin
    // element's own click handler. Clearing only when the DESELECTED pin is
    // the one on screen means a pin-to-pin switch can never close the sheet
    // it just opened, while tapping empty map (which deselects the open pin)
    // still closes it.
    const onDeselect = (e: unknown) => {
      const jobId = (e as { annotation?: MKAnnotation }).annotation?.data?.jobId;
      if (typeof jobId !== "string") return;
      setSelectedJobId((cur) => (cur === jobId ? null : cur));
    };
    map.addEventListener("select", onSelect);
    map.addEventListener("deselect", onDeselect);
    return () => {
      map.removeEventListener("select", onSelect);
      map.removeEventListener("deselect", onDeselect);
    };
  }, [mapReady]);

  // Escape closes the preview, like every other dismissible surface in the app.
  useEffect(() => {
    if (!selectedJob) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closePreview(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedJob, closePreview]);

  // Focus moves into the sheet ONLY when the pin was activated from the
  // keyboard (see `openedByKeyboardRef`).
  const previewCloseRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (selectedJob && openedByKeyboardRef.current) previewCloseRef.current?.focus();
  }, [selectedJob]);

  /**
   * The live pixel height of the strip the dock + FAB cover, measured rather
   * than assumed: `MAP_DOCK_CLEARANCE` is a `calc()` over CSS variables
   * (`--safe-area-bottom`, `--bottom-nav-h`) whose resolved value differs by
   * surface — 0 + 16 on signed-out `/browse`, ~112 with a dock, more on a
   * notched phone. A zero-width probe styled to that height is the only way to
   * read it without duplicating the arithmetic.
   */
  const clearanceProbeRef = useRef<HTMLDivElement | null>(null);

  // Re-run it whenever the clustering can have changed. MapKit rebuilds and
  // re-styles annotation nodes asynchronously (and re-clusters on every camera
  // move), so a one-shot call after `addAnnotations` is always too early — a
  // rAF-debounced MutationObserver on the map's own subtree is what actually
  // catches it. `attributeFilter: ["style"]` both narrows the work to the
  // property that carries MapKit's signal AND keeps our own `tabindex` /
  // `aria-hidden` writes from re-triggering the observer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncPinFocusability);
    };
    schedule();
    const obs = new MutationObserver(schedule);
    obs.observe(map.element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    map.addEventListener("region-change-end", schedule);
    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      map.removeEventListener("region-change-end", schedule);
    };
  }, [visibleJobs, mapReady, syncPinFocusability]);

  // Frame the pins whenever the visible set changes (FitToPins' old job), with
  // the dock band excluded so an auto-framed pin is never parked underneath it.
  useEffect(() => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map) return;
    fitToPins(mk, map, visibleJobs, false, clearanceProbeRef.current?.offsetHeight ?? 0);
  }, [visibleJobs, mapReady]);

  // Desktop split-view hover sync: scale the pin whose feed card the pointer
  // is over. Pin elements are plain DOM nodes tagged with `data-job-id` (see
  // pinElement) rather than React-owned, so this reaches into the map's own
  // container to toggle a class — cheaper than rebuilding annotations on
  // every mouse move, and MapKit only calls the pin factory once anyway.
  const prevHoveredElRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const prev = prevHoveredElRef.current;
    if (prev) {
      prev.classList.remove("browse-map-pin-hovered");
      prevHoveredElRef.current = null;
    }
    if (!hoveredJobId) return;
    const el = map.element.querySelector<HTMLElement>(
      `.browse-map-pin[data-job-id="${CSS.escape(hoveredJobId)}"]`,
    );
    if (el) {
      el.classList.add("browse-map-pin-hovered");
      prevHoveredElRef.current = el;
    }
  }, [hoveredJobId, mapReady, visibleJobs]);

  const recenter = useCallback(() => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map) return;
    map.setRegionAnimated(laRegion(mk), true);
  }, []);

  if (loading) {
    return (
      <div
        className={`flex items-center justify-center h-full w-full bg-card/40${shellClass}`}
        style={{ paddingBottom: "calc(var(--safe-area-bottom, 0px) + 96px + 1rem)" }}
      >
        {/* Plain neutral spinner, not the branded H — the wrought-iron
            emblem's asymmetric shape reads oddly mid-rotation on this
            surface (owner, 2026-08-30). HelprSpinner stays the default
            everywhere else. */}
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "hsl(var(--bark) / 0.6)" }} />
      </div>
    );
  }

  // A failed fetch is NOT an empty marketplace — say which one it is. Same
  // frosted ErrorState + "Try again" the list view shows for the same
  // failure, so flipping list↔map during an outage reads as one screen.
  if (loadError && visibleJobs.length === 0) {
    return (
      <div
        className={`flex h-full w-full bg-card/40 px-3 pt-4${shellClass}`}
        style={{ paddingBottom: "calc(var(--safe-area-bottom, 0px) + 96px + 1rem)" }}
      >
        <ErrorState
          title="We couldn't load the map."
          body="The job pins didn't come back. Tap Try again — if it sticks, our end is having a hiccup, not yours."
          onRetry={retry}
        />
      </div>
    );
  }

  const isEmpty = visibleJobs.length === 0;

  return (
    /* Populated map: fills the parent's remaining height (h-full inside
       a flex-1 wrapper) and bleeds under the dock with flat bottom
       corners. Top corners stay rounded so the panel still reads as a
       distinct surface above the dock. */
    <div ref={mapBoxRef} className={`relative h-full w-full overflow-hidden${shellClass}`}>
      {/* Honest note when a filter the viewer turned on has no field on the
          map row to test (the RPC returns a narrow, PII-safe shape). Without
          this the map silently shows pins the list has already excluded and
          the two surfaces disagree for no visible reason. */}
      {ignoredFilters.length > 0 && (
        <div
          className="absolute top-3 left-3 z-[400] max-w-[60%] px-2.5 py-1.5 rounded-ds-md font-sans text-ds-11 leading-snug"
          style={{
            background: "hsla(0, 0%, 100%, 0.92)",
            color: "hsl(var(--olivewood))",
            border: "0.5px solid hsl(var(--olivewood) / 0.18)",
            boxShadow: "0 4px 14px -4px hsl(var(--olivewood) / 0.18)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          {ignoredFilters.join(" and ")} {ignoredFilters.length === 1 ? "isn't" : "aren't"} applied on
          the map — switch to the list for {ignoredFilters.length === 1 ? "it" : "those"}.
        </div>
      )}
      {/* The floating "N Jobs"/"N Matches" pill that used to live here was
          removed (owner: redundant with the "N jobs" label already shown in
          the list-view toolbar header — the two counts said the same thing
          twice). */}
      {/* Empty board — keep the real Louisiana map on screen (so it reads
          as "no posts yet here", not "the map is broken") and float a
          soft frosted caption over it. The wrapper passes pointer events
          through so the map stays pannable; only the caption card itself
          is interactive, so the guest signup CTA still works. */}
      {isEmpty && (
        <div className="absolute inset-0 z-[350] flex items-center justify-center pointer-events-none px-6">
          <div
            className="pointer-events-auto flex flex-col items-center text-center gap-3 rounded-2xl px-6 py-6 max-w-[300px]"
            style={{
              backgroundColor: "hsl(var(--surface-band) / 0.92)",
              border: "0.5px solid hsl(var(--olivewood) / 0.18)",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.6), " +
                "0 10px 30px -10px hsl(var(--olivewood) / 0.32)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{
                backgroundColor: "hsla(0, 0%, 100%, 0.55)",
                border: "1px solid hsl(var(--olivewood) / 0.10)",
                boxShadow:
                  "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                  "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                  "0 6px 14px -4px hsl(var(--olivewood) / 0.10)",
              }}
            >
              <MapPin className="w-6 h-6" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.5} />
            </div>
            <div className="space-y-1">
              {/* An empty board because the viewer narrowed it is a
                  different message from an empty marketplace — saying "no
                  posts yet" while a category filter is on is simply false,
                  and it hides the one action that fixes it. */}
              <p
                className="font-display italic font-bold leading-tight text-headline-card"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                {filtersActive ? "No pins match." : "Empty map for now."}
              </p>
              <p
                className="font-serif italic text-ds-13"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {filtersActive
                  ? "Nothing on the board fits those filters. Widen them and the pins come back."
                  : "New posts land here the moment they go live across Louisiana."}
              </p>
            </div>
            {filtersActive && onClearFilters && (
              <Button variant="outline" onClick={onClearFilters} className="rounded-ds-md mt-1">
                Clear Filters
              </Button>
            )}
            {/* Optional CTA — passed by the guest dashboard so the empty
                map still nudges signup ("get pinged when one lands")
                rather than dead-ending the user. */}
            {emptyStateCta && (
              <Button
                variant="primary"
                onClick={emptyStateCta.onClick}
                className="rounded-ds-md mt-1"
              >
                <BellRing className="w-4 h-4 mr-2" /> {emptyStateCta.label}
              </Button>
            )}
          </div>
        </div>
      )}
      {/* MapKit can't authorize (no token, script blocked, Apple rejected the
          key). Say so plainly instead of leaving a blank grey box: the pins
          are gone but the job list is one tap away, so nobody is stranded.
          Sits ABOVE the map surface rather than replacing the shell so the
          count badge and layer toggle keep their positions. */}
      {mapKitUnusable && (
        <div
          role="status"
          data-testid="browse-map-unavailable"
          className="absolute inset-0 z-[360] flex flex-col items-center justify-center gap-2 px-6 text-center"
          style={{ background: "hsl(var(--surface-band) / 0.96)" }}
        >
          <MapPinOff className="w-6 h-6" style={{ color: "hsl(var(--olivewood) / 0.7)" }} aria-hidden="true" />
          <p className="font-sans font-semibold text-ds-13" style={{ color: "hsl(var(--bark))" }}>
            The map isn't available right now.
          </p>
          <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
            Every open job is still on the list — switch to the list view to browse them.
          </p>
        </div>
      )}
      {/* Subtle load overlay — fades out once MapKit reports ready so the
          first paint is a soft transition rather than a flash of half-drawn
          map. Pointer events bypass so users can still pan even while it
          fades. */}
      {!mapKitUnusable && (
        <div
          aria-hidden
          className="absolute inset-0 z-[300] flex items-center justify-center pointer-events-none transition-opacity duration-500"
          style={{
            opacity: mapReady ? 0 : 1,
            background: "hsl(var(--surface-band) / 0.55)",
            backdropFilter: "blur(2px)",
            WebkitBackdropFilter: "blur(2px)",
          }}
        >
          {/* Plain neutral spinner, not the branded H — the wrought-iron
            emblem's asymmetric shape reads oddly mid-rotation on this
            surface (owner, 2026-08-30). HelprSpinner stays the default
            everywhere else. */}
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "hsl(var(--bark) / 0.6)" }} />
        </div>
      )}
      {/* Zero-width probe: renders nothing, exists so the dock clearance can be
          MEASURED in px (see `clearanceProbeRef`) instead of re-deriving the
          `calc()` in JS. */}
      <div
        ref={clearanceProbeRef}
        aria-hidden
        className="absolute left-0 bottom-0 w-0 pointer-events-none"
        style={{ height: MAP_DOCK_CLEARANCE }}
      />
      <div
        ref={setContainerEl}
        data-testid="browse-map-surface"
        role="application"
        aria-label="Map of open jobs across Louisiana"
        style={{ height: "100%", width: "100%" }}
      />
      {/* ── Bottom control stack ────────────────────────────────────────────
          ONE bottom-anchored column owns everything the map floats over its
          own lower edge, so nothing here can collide with anything else here.
          Reading up from the floor: the dock clearance (`MAP_DOCK_CLEARANCE`,
          the map bleeds under the app's dock + FAB), then the preview sheet,
          then the recenter button — so opening a preview LIFTS the recenter
          button by exactly the sheet's height rather than letting the two
          overlap. Previously `RecenterControl` positioned itself absolutely at
          that same corner with no knowledge of anything else, which is why it
          crowded the FAB.

          The column itself is `pointer-events-none` so the map stays pannable
          through the empty space either side of the sheet; only the sheet and
          the button take pointer events back. */}
      {!mapKitUnusable && (
        <div
          className="absolute left-0 right-0 z-[420] flex flex-col items-stretch gap-2 px-3 pointer-events-none"
          style={{ bottom: MAP_DOCK_CLEARANCE }}
        >
          {mapReady && (
            <div className="flex justify-end">
              <RecenterControl onRecenter={recenter} />
            </div>
          )}
          {/* ── Pin preview ──────────────────────────────────────────────────
              A BOTTOM SHEET, not a callout over the pin (owner, 2026-08-31:
              "X needs to be arranged better"; the card "floats mid-map
              covering Cankton/Sunset" and clips a place label).

              WHY A BOTTOM SHEET. The card has to go somewhere that is (a) a
              fixed, predictable place rather than wherever the tapped pin
              happens to be, (b) never on top of the pin that opened it, and
              (c) never on top of the map controls. A bottom sheet anchored
              above the dock is the conventional map+list answer (Apple Maps,
              Google Maps) for exactly those reasons, and it is the only
              placement that also gives the close control a real structural
              home — a header lane of its own — instead of an overlay laid on
              the card's price chip. `openPreview` additionally nudges the
              camera so the tapped pin sits ABOVE centre, in the band the sheet
              never reaches, so pin and card stay visibly connected.

              The card inside is still the SAME `<JobCard bare>` the feed
              renders (owner: "its not a shared component its the same page the
              both use it") — untouched, and NOT edited for this: the close
              control is the sheet's, not the card's. */}
          {selectedJob && (
            <aside
              aria-label="Job preview"
              data-testid="browse-map-preview"
              className="pointer-events-auto w-full max-w-[26rem] mx-auto motion-safe:animate-fade-in overflow-hidden"
              style={{
                borderRadius: "1rem",
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                boxShadow:
                  "inset 0 1px 0 0 hsla(0, 0%, 100%, 0.9), " +
                  "0 1px 3px hsl(var(--olivewood) / 0.1), " +
                  "0 14px 28px -8px hsl(var(--olivewood) / 0.16), " +
                  "0 32px 64px -16px hsl(var(--olivewood) / 0.2)",
              }}
            >
              {/* Header lane — the close control's OWN place in the sheet's
                  structure. It is a row, above the card, at the sheet's full
                  width: it cannot reach the price chip or the title, because
                  they are not in it. The grab handle centres the lane so the
                  surface reads as a sheet, and the 44x44 button sits at the
                  end of the row the way every other dismiss in the app does.
                  This lane is also why the card's own top-left category tab
                  and top-right status corner are left alone — the sheet adds
                  chrome ABOVE the card rather than competing inside it. */}
              <div className="relative flex items-center justify-end h-11 pl-3 pr-1.5">
                <span
                  aria-hidden
                  className="absolute left-1/2 top-2 -translate-x-1/2 h-1 w-9 rounded-full"
                  style={{ backgroundColor: "hsl(var(--olivewood) / 0.22)" }}
                />
                <button
                  type="button"
                  ref={previewCloseRef}
                  onClick={() => closePreview(false)}
                  aria-label="Close job preview"
                  title="Close job preview"
                  data-testid="browse-map-preview-close"
                  // 44x44 — the project tap-target floor. The old control was
                  // a bare 24x24 glyph with no background and no hit area.
                  className="w-11 h-11 -mr-0.5 rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  style={{ color: "hsl(var(--olivewood) / 0.75)" }}
                >
                  {/* Its own filled disc, so the glyph has contrast against
                      the sheet no matter what the card beneath it renders. */}
                  <span
                    aria-hidden
                    className="w-7 h-7 rounded-full flex items-center justify-center"
                    style={{
                      backgroundColor: "hsl(var(--olivewood) / 0.08)",
                      border: "0.5px solid hsl(var(--olivewood) / 0.16)",
                    }}
                  >
                    <X className="w-4 h-4" strokeWidth={2.5} />
                  </span>
                </button>
              </div>
              <div className="px-2 pb-2">
                <JobCard
                  job={mapJobToEnrichedJob(selectedJob)}
                  effectiveFee={effectiveFee ?? 0}
                  onSelect={() => onJobAction?.(selectedJob.id)}
                  onApply={() => onJobAction?.(selectedJob.id)}
                  onReport={() => { /* no report surface on the map pin preview */ }}
                  guestPricing={effectiveFee === undefined}
                  bare
                />
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
