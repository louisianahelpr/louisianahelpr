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
// overlays/controls in ./browseMap/MapLayers, the pin halo + popover placement
// in ./browseMap/usePinPreviewPlacement, the pin tab-order and hover syncs in
// ./browseMap/usePinFocusability, and the my-location button in
// ./browseMap/useShowMyLocation (Q806). This file owns the data fetch, the
// imperative map lifecycle, and the pin PREVIEW SHEET.
//
// Pin preview (reworked 2026-08-31): tapping a pin no longer opens a MapKit
// callout floating over the pin. It opens a bottom sheet this component
// renders, anchored above the dock in the map's own bottom control stack,
// holding the same `<JobCard bare>` the feed renders. See the `selectedJobId`
// state and the "Bottom control stack" block in the JSX for why.

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { report } from "@/lib/errorLogger";
import { Loader2 } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { useMapKitJs } from "@/hooks/useMapKitJs";
import { isJobExcludedForViewer } from "@/pages/home/viewerFeedExclusions";
import {
  LA_BOUNDS,
  MAP_DOCK_CLEARANCE,
  readIsDark,
  type MapJob,
} from "./browseMap/config";
import { useSelectedCrewSpots } from "./browseMap/useSelectedCrewSpots";
import { useMapJobs } from "./browseMap/useMapJobs";
import { pinElement, PIN_HEIGHT } from "./browseMap/mapMarkers";
import { ClusterList, clusterBubble } from "./browseMap/ClusterList";
import { IgnoredFiltersNote, MapEmptyState, MapUnavailable } from "./browseMap/MapOverlays";
import { PinPreview } from "./browseMap/PinPreview";
import {
  buildMapJobFilter,
  isAnyFilterActive,
  unsupportedMapFilters,
} from "./browseMap/mapFilter";
import { BusyAreasMapKey, laRegion, MyLocationCorner } from "./browseMap/MapLayers";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import {
  colorSchemeFor,
  getMapKit,
  regionFromBounds,
  type MKAnnotation,
  type MKMap,
} from "./browseMap/mapkitRuntime";
import { useBusyAreaShading, useFitPinsOnChange, useMapFollowsTheme } from "./browseMap/useMapLayersSync";
import type { BrowseMapProps } from "./browseMap/browseMapProps";
import { useHoveredPinHighlight, usePinFocusability } from "./browseMap/usePinFocusability";
import { usePinPreviewPlacement } from "./browseMap/usePinPreviewPlacement";
import { useShowMyLocation } from "./browseMap/useShowMyLocation";

export function BrowseMap({ onJobAction, currentUserId, emptyStateCta, filters, onClearFilters, effectiveFee, flush = false, hoveredJobId, exclusions, refreshKey }: BrowseMapProps) {
  const shellClass = flush ? "" : " rounded-t-2xl border border-b-0 border-border";
  const mapKitStatus = useMapKitJs();
  // The pin set and its load state; see browseMap/useMapJobs.ts.
  const { jobs, loading, loadError, retry } = useMapJobs(currentUserId, refreshKey);
  // Offline with no pins in hand is never "Empty map for now" (owner 10-31).
  const { online } = useOnlineStatus();
  const [mapReady, setMapReady] = useState(false);

  // Filtered pin set. Every downstream consumer (count badge, fitToPins, the
  // markers themselves, the empty state) reads THIS, not the raw `jobs` —
  // otherwise the map would zoom to and count pins it isn't drawing.
  const visibleJobs = useMemo(
    () => {
      const filtered = filters ? jobs.filter(buildMapJobFilter(filters)) : jobs;
      // Drop pins for anything the list feed hides for THIS viewer — applied,
      // dismissed, outside "Only saved". One shared predicate, so the map
      // cannot fall behind the list the next time a cull is added. The map row
      // carries no `customer_id`, so the blocked-poster field of the same
      // object is a documented no-op here (see the prop's comment).
      if (!exclusions) return filtered;
      return filtered.filter((j) => !isJobExcludedForViewer(j, exclusions));
    },
    [jobs, filters, exclusions],
  );
  const filtersActive = !!filters && isAnyFilterActive(filters);
  // Filters the narrow map row has no field to evaluate. Named in the UI
  // rather than silently dropped — a filter that looks applied but isn't is
  // worse than one the app says it can't apply here.
  // Passed the ROWS so "unsupported" is decided by what the deployed RPC
  // actually returns, not by a static list that stayed true long after it
  // stopped being true. Once 20260921173413 is deployed this is [] and the
  // chips stop appearing on their own.
  const ignoredFilters = filters ? unsupportedMapFilters(filters, jobs) : [];

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
  /** The jobs of a cluster no zoom can split, listed (NIGHT-JOBSMA5-1); null = no list open. */
  const [clusterJobIds, setClusterJobIds] = useState<string[] | null>(null);
  const closeClusterList = useCallback(() => setClusterJobIds(null), []);
  const selectedJob = useMemo(
    () => visibleJobs.find((j) => j.id === selectedJobId) ?? null,
    [visibleJobs, selectedJobId],
  );
  // A filter (or a refetch) that removes the previewed job must close the
  // preview — otherwise the sheet describes a pin that is no longer on the map.
  useEffect(() => {
    if (selectedJobId && !selectedJob) setSelectedJobId(null);
  }, [selectedJobId, selectedJob]);
  // Q1464: the previewed crew's open spots (the map RPC has no count).
  const selectedCrewSpots = useSelectedCrewSpots(selectedJob?.is_group_job ? selectedJob.id : null);
  /** True when the open preview was opened from the keyboard, so focus should
   *  move into the sheet and back to the pin on close (a pointer tap must NOT
   *  steal focus — that scroll-jumps the map on iOS). */
  const openedByKeyboardRef = useRef(false);

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
      // Branded cluster bubble (MapKit asks this callback for the stand-in of annotations sharing a clusteringIdentifier).
      // Tap OR keyboard-activate it: zoom into the jobs it stands for (Leaflet's zoom-to-bounds), or, when their rounded
      // points coincide and no zoom can split them, list them (NIGHT-JOBSMA5-1, ClusterList.tsx).
      map.annotationForCluster = (cluster) => {
        const members = cluster.memberAnnotations ?? [];
        return new mk.Annotation(cluster.coordinate, () => clusterBubble(mk, map, members, (ids) => { setSelectedJobId(null); setClusterJobIds(ids); }), { calloutEnabled: false });
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

  useMapFollowsTheme(mapRef, mapReady);
  const busyShown = useBusyAreaShading(mapRef, mapReady, visibleJobs); // Q2435; BusyAreasMapKey says what they are

  /** Remove every job annotation currently on the map. */
  const clearAnnotations = useCallback(() => {
    const map = mapRef.current;
    if (map && annotationsRef.current.length) {
      try { map.removeAnnotations(annotationsRef.current); } catch { /* ignore */ }
    }
    annotationsRef.current = [];
  }, []);

  /**
   * Open a pin's preview and slide the camera so the pin sits a little BELOW
   * centre — the card is a pin-anchored popover that renders ABOVE the pin
   * (owner, 2026-09-15), so it needs clear room above and the pin needs to be
   * clear of the very top. Centring the map slightly NORTH of the pin lands the
   * pin at ~58% down: room above for the card, and never so low it hides behind
   * the dock. The shift is a fraction of the CURRENT span, so it behaves the
   * same at every zoom, and the camera keeps its zoom (no `fitToPins` re-frame).
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
          // North of the pin by ~8% of the visible height ⇒ the pin renders a
          // touch BELOW centre, leaving the upper band clear for the popover.
          new mk.Coordinate(Number(job.latitude) + span.latitudeDelta * 0.08, Number(job.longitude)),
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
  // There is no close button any more (VN-9: the owner removed the header lane
  // and its circled X — clicking outside or pressing Escape closes the sheet).
  // So the keyboard entry point is the CARD itself: JobCard's root carries
  // role="button"/tabIndex, so focusing it both announces the job and leaves
  // Enter/Space opening the detail dialog. Queried rather than ref-forwarded
  // because JobCard is the feed's card and must not grow a prop for the map.
  const previewCardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!selectedJob || !openedByKeyboardRef.current) return;
    // Unquoted attribute selector on purpose: the map-marker a11y guard
    // (src/test/mapMarkerAccessibleName.test.ts) greps this file for a quoted
    // role="button" and, being a source grep, cannot tell a CSS selector from
    // an unnamed JSX role. `[role=button]` is the same selector, no false hit.
    const el = previewCardRef.current?.querySelector<HTMLElement>("[role=button]");
    (el ?? previewCardRef.current)?.focus();
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

  usePinFocusability(mapRef, mapReady, visibleJobs); // pins under a cluster leave the tab order (browseMap/usePinFocusability.ts)

  useFitPinsOnChange(mapRef, mapReady, visibleJobs, clearanceProbeRef); // frames pins + busy circles, above the dock band

  useHoveredPinHighlight(mapRef, mapReady, visibleJobs, hoveredJobId); // desktop split-view hover sync (browseMap/usePinFocusability.ts)

  const { preview, previewWrapRef } = usePinPreviewPlacement({ mapRef, mapBoxRef, clearanceProbeRef, selectedJobId, mapReady, visibleJobs }); // pin halo + popover placement (browseMap/usePinPreviewPlacement.ts)

  const { showMyLocation, locating } = useShowMyLocation(mapRef); // VN-11 crosshair: centre on the viewer (browseMap/useShowMyLocation.ts)

  if (loading) {
    return (
      <div
        className={`flex items-center justify-center h-full w-full bg-card/40${shellClass}`}
        style={{ paddingBottom: "calc(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px) + 1rem)" }}
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
  if ((loadError || !online) && visibleJobs.length === 0) {
    return (
      <div
        className={`flex h-full w-full bg-card/40 px-3 pt-4${shellClass}`}
        style={{ paddingBottom: "calc(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px) + 1rem)" }}
      >
        <ErrorState
          title="Can't load jobs right now."
          body={online ? "The job pins didn't come back. Tap Try again." : "You're offline. The map will load when you're back online."}
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
      <IgnoredFiltersNote ignoredFilters={ignoredFilters} />
      {/* The floating "N Jobs"/"N Matches" pill that used to live here was
          removed (owner: redundant with the "N jobs" label already shown in
          the list-view toolbar header — the two counts said the same thing
          twice). */}
      {/* Empty board — keep the real Louisiana map on screen (so it reads
          as "no posts yet here", not "the map is broken") and float a
          soft frosted caption over it. The wrapper passes pointer events
          through so the map stays pannable; only the caption card itself
          is interactive, so the guest signup CTA still works. */}
      {/* NOT while the map is unusable. "Nothing is posted here" is a claim
          only a map that actually drew can make; when MapKit never loaded we
          know nothing about the area, and rendering both states at once put
          the empty-state copy legibly under the unavailable panel. One state
          at a time — the unavailable panel below is the whole answer. */}
      {isEmpty && !mapKitUnusable && (
        <MapEmptyState filtersActive={filtersActive} onClearFilters={onClearFilters} emptyStateCta={emptyStateCta} />
      )}
      {/* MapKit can't authorize (no token, script blocked, Apple rejected the
          key). Say so plainly instead of leaving a blank grey box: the pins
          are gone but the job list is one tap away, so nobody is stranded.
          Sits ABOVE the map surface rather than replacing the shell so the
          count badge and layer toggle keep their positions. */}
      {mapKitUnusable && <MapUnavailable />}
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
          then the my-location button — so opening a preview LIFTS that
          button by exactly the sheet's height rather than letting the two
          overlap. Previously the control positioned itself absolutely at
          that same corner with no knowledge of anything else, which is why it
          crowded the FAB.

          The column itself is `pointer-events-none` so the map stays pannable
          through the empty space either side of the sheet; only the sheet and
          the button take pointer events back. */}
      {!mapKitUnusable && mapReady && busyShown && <BusyAreasMapKey />}
      {!mapKitUnusable && mapReady && <MyLocationCorner onLocate={showMyLocation} busy={locating} />}
      {/* ── Pin preview — a POPOVER anchored to the tapped pin ────────────────
          Owner, 2026-09-15: the card sits AT the pin (near/under it), not in a
          bottom sheet. The two problems that once drove it to the bottom are
          re-solved here rather than avoided:
            • overlap — the card is centred on the pin and CLAMPED inside the
              map edges, prefers ABOVE the pin, and FLIPS below only when there
              is no room above; the dock band is excluded so a flipped card
              never lands under the controls (see the placement sync effect);
            • close-button-on-price — there is no close button to collide: the
              preview closes by tapping the pin again, tapping empty map
              (MapKit deselect), or Escape, exactly as the bottom sheet did.
          `preview` (from the sync effect) carries the live left/top and the
          caret. The card renders hidden until the first measurement so it
          never flashes at 0,0. Still the SAME `<JobCard bare>` the feed
          renders — untouched. */}
      {!mapKitUnusable && clusterJobIds && (
        <ClusterList jobs={visibleJobs.filter((j) => clusterJobIds.includes(j.id))} onClose={closeClusterList} onOpen={(id) => { setClusterJobIds(null); onJobAction?.(id); }} />
      )}
      {!mapKitUnusable && selectedJob && (
        <PinPreview
          selectedJob={selectedJob}
          selectedCrewSpots={selectedCrewSpots}
          preview={preview}
          wrapRef={previewWrapRef}
          cardRef={previewCardRef}
          effectiveFee={effectiveFee}
          onJobAction={onJobAction}
        />
      )}
    </div>
  );
}
