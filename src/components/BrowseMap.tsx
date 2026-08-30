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
// marker element + heat-density helpers in ./browseMap/mapMarkers, the
// MapKit runtime typings + the pixel↔metre bridge in ./browseMap/mapkitRuntime,
// and the map overlays/controls in ./browseMap/MapLayers. This file owns the
// data fetch + the imperative map lifecycle.

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import { BellRing, MapPin, MapPinOff, Loader2 } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { useMapKitJs } from "@/hooks/useMapKitJs";
import {
  LA_BOUNDS,
  type MapJob,
} from "./browseMap/config";
import { MapJobPopup } from "./browseMap/MapJobPopup";
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
  /** Tap on the popup's CTA (e.g. "Sign up to apply" for guests). */
  onJobAction?: (jobId: string) => void;
  /** CTA text — varies by surface (guest = "Sign up to apply", auth = "Apply"). */
  ctaLabel?: string;
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
}

/** Reads the app's resolved theme off `<html data-theme>` (set by
 *  `useDarkMode`) so the map's own tiles match the surrounding UI. */
function readIsDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-theme") === "dark";
}

export function BrowseMap({ onJobAction, ctaLabel = "View", currentUserId, emptyStateCta, filters, onClearFilters, effectiveFee, flush = false }: BrowseMapProps) {
  const shellClass = flush ? "" : " rounded-t-2xl border border-b-0 border-border";
  const mapKitStatus = useMapKitJs();
  const [jobs, setJobs] = useState<MapJob[]>([]);
  // Total open jobs in the feed, including ones the map can't plot because
  // they lack geocoded coordinates. Lets the badge read "N of M" so a user
  // who sees 21 in the feed but 19 pins understands the 2 missing jobs are
  // un-mappable, not lost.
  const [totalOpen, setTotalOpen] = useState<number | null>(null);
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
    // Total open jobs (same surface the feed counts) — the denominator for
    // the "N of M" badge. Best-effort: a failure just leaves the badge as a
    // plain pin count rather than bricking the map.
    supabase
      .from("open_jobs_browse")
      .select("id", { count: "exact", head: true })
      .neq("payment_status", "abandoned")
      .then(({ count, error }) => {
        if (cancelled || error) return;
        setTotalOpen(count ?? null);
      });
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

  /**
   * The map pane's own width, watched — the cap for a pin callout.
   *
   * MapKit does not pan the map to fit an oversized callout the way Leaflet
   * did (that was the old width math's whole reason for existing), but a
   * callout wider than the pane still overflows it. The narrowest surface this
   * ships to is a 375px phone map pane and the desktop side-by-side column is
   * ~270px, so the callout is capped to the MEASURED pane rather than a
   * constant. Watched rather than read once because the column resizes with
   * the window and with the side panel.
   */
  const mapBoxRef = useRef<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = useState(0);
  useEffect(() => {
    const el = mapBoxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    setPaneWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => {
      setPaneWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // ONE WIDTH, not a range (owner: "each one has a diff layout, make all
  // consistent"). A content-sized callout meant every pin opened a
  // differently-shaped card — 225px for a short title, 265px for a long one —
  // and the meta row wrapped onto one line or two depending on which pin you
  // happened to tap. A fixed width makes the callout an object the content
  // flows into, which is what the feed card beside it already is.
  //
  // 40px keeps the card clear of MapKit's own callout chrome and shadow.
  // Floor at 180 so a freak-narrow pane still renders a usable card.
  const calloutWidth = paneWidth ? Math.max(180, Math.min(264, paneWidth - 40)) : 264;

  const retry = () => {
    setLoadError(false);
    setLoading(true);
    setReloadNonce((n) => n + 1);
  };

  // ── MapKit lifecycle ────────────────────────────────────────────────────
  const mapRef = useRef<MKMap | null>(null);
  const annotationsRef = useRef<MKAnnotation[]>([]);
  /** One React root per open callout body, torn down with its annotation. */
  const calloutRootsRef = useRef<Root[]>([]);
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
          () => {
            const node = clusterElement(count);
            // Tap a cluster → zoom into the jobs it stands for, matching
            // Leaflet's zoom-to-bounds-on-cluster-click.
            node.addEventListener("click", () => {
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
            });
            return node;
          },
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
      const roots = calloutRootsRef.current;
      calloutRootsRef.current = [];
      // Deferred: React refuses to unmount a root synchronously while it is
      // already rendering, which is exactly where an effect cleanup runs.
      setTimeout(() => roots.forEach((r) => r.unmount()), 0);
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

  /** Remove and unmount every job annotation currently on the map. */
  const clearAnnotations = useCallback(() => {
    const map = mapRef.current;
    if (map && annotationsRef.current.length) {
      try { map.removeAnnotations(annotationsRef.current); } catch { /* ignore */ }
    }
    annotationsRef.current = [];
    const roots = calloutRootsRef.current;
    calloutRootsRef.current = [];
    if (roots.length) setTimeout(() => roots.forEach((r) => r.unmount()), 0);
  }, []);

  // Pins layer. Each job becomes a custom annotation whose callout body is a
  // real `<MapJobPopup>` — MapKit's callout delegate hands back DOM, not React
  // children, so the popup is rendered into a detached node by its own React
  // root and that node is what `calloutContentForAnnotation` returns. It is
  // rendered up front (not on tap) so the callout has laid-out content to
  // measure the moment MapKit asks for it.
  useEffect(() => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map) return;
    clearAnnotations();
    if (visibleJobs.length === 0) return;

    const annotations = visibleJobs.map((job) => {
      const body = document.createElement("div");
      body.className = "browse-map-callout";
      body.style.width = `${calloutWidth}px`;
      // Belt and braces on the narrowest surface: even if the pane is
      // mis-measured, the callout can never be wider than the phone screen.
      body.style.maxWidth = "calc(100vw - 32px)";
      const root = createRoot(body);
      root.render(
        <MapJobPopup
          job={job}
          onJobAction={onJobAction}
          ctaLabel={ctaLabel}
          effectiveFee={effectiveFee}
          // Dismiss the callout without waiting for an outside tap —
          // MapKit JS deselects a pin by clearing `selectedAnnotations`.
          onClose={() => {
            try { map.selectedAnnotations = []; } catch { /* ignore */ }
          }}
        />,
      );
      calloutRootsRef.current.push(root);
      return new mk.Annotation(
        new mk.Coordinate(Number(job.latitude), Number(job.longitude)),
        () => pinElement(job.category, job.is_urgent),
        {
          // MapKit centres a custom annotation element on its coordinate;
          // the pin's point is at its bottom edge, so lift it by half the
          // icon height (Leaflet's `iconAnchor: [14, 36]`).
          anchorOffset:
            typeof DOMPoint === "function" ? new DOMPoint(0, -PIN_HEIGHT / 2) : undefined,
          clusteringIdentifier: "browse-job",
          calloutEnabled: true,
          callout: { calloutContentForAnnotation: () => body },
          data: { jobId: job.id },
        },
      );
    });
    annotationsRef.current = annotations;
    try { map.addAnnotations(annotations); } catch { /* ignore */ }
  }, [visibleJobs, mapReady, ctaLabel, effectiveFee, onJobAction, calloutWidth, clearAnnotations]);

  // Frame the pins whenever the visible set changes (FitToPins' old job).
  useEffect(() => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map) return;
    fitToPins(mk, map, visibleJobs);
  }, [visibleJobs, mapReady]);

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
      {!isEmpty && (
      <div className="absolute top-3 right-3 z-[400] flex flex-col items-end gap-1.5">
        <div
          aria-hidden
          data-testid="browse-map-job-count"
          className="px-3 h-7 rounded-full flex items-center font-sans font-semibold text-ds-13 tracking-wide"
          style={{
            background: "hsla(0, 0%, 100%, 0.92)",
            color: "hsl(var(--bark))",
            border: "0.5px solid hsl(var(--olivewood) / 0.18)",
            boxShadow: "0 4px 14px -4px hsl(var(--olivewood) / 0.18)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          {filtersActive
            ? `${visibleJobs.length} ${visibleJobs.length === 1 ? "Match" : "Matches"}`
            : totalOpen !== null && totalOpen > visibleJobs.length
              ? `${visibleJobs.length} of ${totalOpen} Mapped`
              : `${visibleJobs.length} ${visibleJobs.length === 1 ? "Job" : "Jobs"}`}
        </div>
      </div>
      )}
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
      <div
        ref={setContainerEl}
        data-testid="browse-map-surface"
        role="application"
        aria-label="Map of open jobs across Louisiana"
        style={{ height: "100%", width: "100%" }}
      />
      {mapReady && !mapKitUnusable && <RecenterControl onRecenter={recenter} />}
    </div>
  );
}
