// BrowseMap — Leaflet map showing open Louisiana jobs as pins. The
// "force multiplier" from the audit: open the app, see the marketplace
// alive on a parish map, tap a pin → see the job → 1-tap apply.
//
// Privacy: pins use coordinates rounded to ~110m via the public
// get_open_jobs_for_map RPC. The doorstep/exact location is never
// exposed to anonymous viewers. Authenticated users see the full
// address only after a job is accepted.
//
// Bundle weight: leaflet + react-leaflet ≈ 45KB gzipped, both lazy-
// loaded only on the /browse?view=map surface so the rest of the app
// pays nothing for the map pipeline.
//
// Structure: static config/types/storage live in ./browseMap/config,
// icon + heat-density helpers in ./browseMap/mapMarkers, and the
// useMap()-driven child overlays in ./browseMap/MapLayers. This file
// owns only the data fetch + top-level render/orchestration.

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { formatPrice } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { BellRing, MapPin } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import {
  HEAT_AUTO_THRESHOLD,
  LA_BOUNDS,
  LA_CENTER,
  LA_DEFAULT_ZOOM,
  LA_MIN_ZOOM,
  categoryLabels,
  readStoredLayer,
  writeStoredLayer,
  type MapJob,
  type MapLayer,
} from "./browseMap/config";
import { bucketJobs, clusterIcon, pinIcon } from "./browseMap/mapMarkers";
import { FitToPins, HeatLayer, RecenterControl } from "./browseMap/MapLayers";
import "leaflet/dist/leaflet.css";

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
}

export function BrowseMap({ onJobAction, ctaLabel = "View", currentUserId, emptyStateCta }: BrowseMapProps) {
  const [jobs, setJobs] = useState<MapJob[]>([]);
  // Total open jobs in the feed, including ones the map can't plot because
  // they lack geocoded coordinates. Lets the badge read "N of M" so a user
  // who sees 21 in the feed but 19 pins understands the 2 missing jobs are
  // un-mappable, not lost.
  const [totalOpen, setTotalOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  // Initialize from localStorage so the user's last choice survives
  // app restarts (and Capacitor cold starts).
  const [view, setView] = useState<MapLayer>(() => readStoredLayer() ?? "pins");
  const [tilesLoading, setTilesLoading] = useState(true);
  // Track whether we've already auto-switched to Heat for this session
  // so the auto-switch fires once on first load only — manual flips
  // back to Pins after that are respected. If there's a stored
  // preference, treat auto-switch as already-applied so we never
  // overwrite an explicit user choice with the density heuristic.
  const heatAutoApplied = useRef(readStoredLayer() !== null);

  const selectView = (next: MapLayer) => {
    setView(next);
    writeStoredLayer(next);
    // Treat any manual selection as the user's explicit preference —
    // freeze the auto-switch so a later high-density refresh doesn't
    // flip them back.
    heatAutoApplied.current = true;
  };

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
          setLoading(false);
          return;
        }
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
        // Auto-switch to Heat when there are enough pins that the
        // individual markers would just read as cluster soup. Runs
        // exactly once per mount so a user who manually flips back to
        // Pins stays there.
        if (!heatAutoApplied.current && cleaned.length >= HEAT_AUTO_THRESHOLD) {
          setView("heat");
          heatAutoApplied.current = true;
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const labels = useMemo(() => categoryLabels, []);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full w-full rounded-t-2xl border border-b-0 border-border bg-card/40"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 1rem)" }}
      >
        <HelprSpinner size={20} />
      </div>
    );
  }

  const heatBuckets = view === "heat" ? bucketJobs(jobs) : [];
  const isEmpty = jobs.length === 0;

  return (
    /* Populated map: fills the parent's remaining height (h-full inside
       a flex-1 wrapper) and bleeds under the dock with flat bottom
       corners. Top corners stay rounded so the panel still reads as a
       distinct surface above the dock. */
    <div className="relative h-full w-full rounded-t-2xl overflow-hidden border border-b-0 border-border">
      {/* Layer-toggle control card — top-right, surfaced prominently
          so helpers can scan job concentration at a glance and flip
          between individual Pins and the density Heat layer in one
          tap. The "N jobs" badge above keeps the dataset size visible
          in both modes so the toggle reads as a real scanning aid.
          Hidden when the board is empty — a layer toggle and a "0 jobs"
          badge are noise when there's nothing to plot. */}
      {!isEmpty && (
      <div className="absolute top-3 right-3 z-[400] flex flex-col items-end gap-1.5">
        <div
          aria-hidden
          data-testid="browse-map-job-count"
          className="px-2.5 h-6 rounded-full flex items-center font-sans font-semibold text-ds-11 tracking-wide"
          style={{
            background: "hsla(0, 0%, 100%, 0.92)",
            color: "hsl(var(--bark))",
            border: "0.5px solid hsl(var(--olivewood) / 0.18)",
            boxShadow: "0 4px 14px -4px hsl(var(--olivewood) / 0.18)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          {totalOpen !== null && totalOpen > jobs.length
            ? `${jobs.length} of ${totalOpen} mapped`
            : `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}`}
        </div>
        <div
          role="group"
          aria-label="Map layer"
          data-testid="browse-map-layer-toggle"
          className="flex items-center gap-1 p-1 rounded-full bg-[hsl(var(--parchment)/0.9)]"
          style={{
            border: "0.5px solid hsl(var(--olivewood) / 0.22)",
            boxShadow: "0 6px 18px -6px hsl(var(--olivewood) / 0.28)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          {([
            { key: "pins" as const, label: "Pins" },
            { key: "heat" as const, label: "Heat" },
          ]).map((opt) => {
            const active = view === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => selectView(opt.key)}
                aria-pressed={active}
                aria-label={`${opt.label} layer`}
                data-testid={`browse-map-layer-${opt.key}`}
                className={
                  active
                    ? "px-3.5 h-8 rounded-full text-ds-12 font-sans font-semibold transition-all bg-[hsl(var(--bark))] text-white shadow-sm"
                    : "px-3.5 h-8 rounded-full text-ds-12 font-sans font-semibold transition-all bg-[hsl(var(--parchment)/0.9)] text-[hsl(var(--bark))] hover:bg-[hsl(var(--parchment))]"
                }
              >
                {opt.label}
              </button>
            );
          })}
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
              <p
                className="font-display italic font-bold leading-tight text-headline-card"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
              >
                Empty map for now.
              </p>
              <p
                className="font-serif italic"
                style={{ fontSize: "0.82rem", color: "hsl(var(--olivewood) / 0.8)" }}
              >
                New posts land here the moment they go live across Louisiana.
              </p>
            </div>
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
      {/* Subtle tile-load overlay — fades out once the OSM tiles
          report `load` so the first paint is a soft transition rather
          than a flash of half-rendered tiles. Pointer events bypass so
          users can still pan even while it fades. */}
      <div
        aria-hidden
        className="absolute inset-0 z-[300] flex items-center justify-center pointer-events-none transition-opacity duration-500"
        style={{
          opacity: tilesLoading ? 1 : 0,
          background: "hsl(var(--surface-band) / 0.55)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
        }}
      >
        <HelprSpinner size={20} />
      </div>
      <MapContainer
        center={LA_CENTER}
        zoom={LA_DEFAULT_ZOOM}
        minZoom={LA_MIN_ZOOM}
        maxBounds={LA_BOUNDS}
        maxBoundsViscosity={1.0}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{
            // `load` fires when all currently-visible tiles are loaded.
            // `loading` fires when fresh tiles start fetching (e.g.
            // after the user pans into uncached area). Re-show the
            // overlay briefly so the user knows something's happening.
            load: () => setTilesLoading(false),
            loading: () => setTilesLoading(true),
          }}
        />
        <FitToPins jobs={jobs} />
        <RecenterControl center={LA_CENTER} zoom={LA_DEFAULT_ZOOM} />
        {view === "heat" && <HeatLayer buckets={heatBuckets} />}
        {view === "pins" && (
        <MarkerClusterGroup
          chunkedLoading
          spiderfyOnMaxZoom
          showCoverageOnHover={false}
          maxClusterRadius={40}
          iconCreateFunction={clusterIcon}
        >
        {jobs.map((job) => (
          <Marker
            key={job.id}
            position={[Number(job.latitude), Number(job.longitude)]}
            icon={pinIcon(job.category, job.is_urgent)}
          >
            <Popup>
              <div className="space-y-1.5 min-w-[180px]">
                <p className="font-display font-bold text-ds-13 leading-tight">
                  {job.title}
                </p>
                <p className="text-ds-11 text-muted-foreground">
                  {labels[job.category as keyof typeof labels] ?? job.category}
                  {job.parish ? ` · ${job.parish}` : ""}
                </p>
                <p className="font-mono text-ds-13 font-semibold">${formatPrice(Number(job.budget))}</p>
                {job.is_urgent && (
                  <p className="text-ds-10 uppercase tracking-wide text-destructive font-bold">
                    Urgent
                  </p>
                )}
                {onJobAction && (
                  <Button
                    size="sm"
                    onClick={() => onJobAction(job.id)}
                    className="w-full mt-1.5 h-8 text-ds-11"
                  >
                    {ctaLabel}
                  </Button>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
        </MarkerClusterGroup>
        )}
      </MapContainer>
    </div>
  );
}
