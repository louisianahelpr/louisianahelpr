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

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, CircleMarker } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { divIcon, point as leafletPoint } from "leaflet";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import { Loader2, Crosshair, BellRing, MapPin } from "lucide-react";
import "leaflet/dist/leaflet.css";

// Above this many open jobs, default to Heat view so the user sees
// hotspots at a glance instead of a soup of clustered pins. The user
// can still flip back to Pins via the top-right toggle.
const HEAT_AUTO_THRESHOLD = 50;

// Persisted user choice for the Pins/Heat toggle. Stored in
// localStorage so a helper who prefers Heat across sessions keeps it
// without re-toggling on every map open. The presence of any stored
// value also suppresses the auto-Heat-at-threshold behavior so we
// never overwrite an explicit user preference.
const LAYER_STORAGE_KEY = "helpr_browse_map_layer";
type MapLayer = "pins" | "heat";

function readStoredLayer(): MapLayer | null {
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

function writeStoredLayer(layer: MapLayer): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAYER_STORAGE_KEY, layer);
  } catch {
    // Swallow — the toggle still works in memory for this session.
  }
}

// Fix Leaflet's default-icon-not-found problem when bundlers can't
// resolve the asset paths. We use a small inline div-icon instead so
// pins render reliably across web + Capacitor iOS.
const categoryColors: Record<string, string> = {
  cleaning: "#5E6544",
  yard_work: "#8C947D",
  moving: "#A0613B",
  errands: "#C39A60",
  handyman: "#5E6544",
  painting: "#A0613B",
  delivery: "#8C947D",
  pet_care: "#C39A60",
  assembly: "#5E6544",
  other: "#7A7E68",
};

function pinIcon(category: string, isUrgent: boolean) {
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

interface MapJob {
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

// Louisiana center fallback (state geographic mean, near Marksville).
const LA_CENTER: [number, number] = [31.0, -92.0];
const LA_DEFAULT_ZOOM = 7;

// Density-aware tint for the heatmap layer. Lower count → cooler
// olivewood; higher count → warm burnt-sienna. Caps at 8+ jobs per
// cluster bucket so a single hot zip doesn't bleach the rest of the
// state.
function densityFill(count: number): string {
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
function bucketJobs(jobs: MapJob[]): Array<{
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

// Auto-fit the map to whatever pins exist when they load. If only one
// pin, zoom in to a useful neighborhood-level view instead of a
// state-wide one.
function FitToPins({ jobs }: { jobs: MapJob[] }) {
  const map = useMap();
  useEffect(() => {
    if (jobs.length === 0) return;
    if (jobs.length === 1) {
      map.setView([jobs[0].latitude, jobs[0].longitude], 13);
      return;
    }
    const bounds = jobs.map((j): [number, number] => [j.latitude, j.longitude]);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }, [jobs, map]);
  return null;
}

// Heat-bucket layer rendered as a child of MapContainer so it can grab
// useMap() and flyTo when a bucket is tapped. Lifted out of the main
// render so the click handler has clean access to the map instance.
function HeatLayer({ buckets }: { buckets: Array<{ center: [number, number]; count: number }> }) {
  const map = useMap();
  return (
    <>
      {buckets.map((b, i) => (
        <CircleMarker
          key={`heat-${i}`}
          center={b.center}
          radius={Math.min(8 + b.count * 4, 36)}
          pathOptions={{
            fillColor: densityFill(b.count),
            fillOpacity: 0.7,
            color: "transparent",
            weight: 0,
          }}
          eventHandlers={{
            // Tap-to-zoom: pan to the bucket center and step in two
            // zoom levels (capped at maxZoom 16). Faster than opening
            // the popup and reading "Zoom in to see them individually".
            click: () => {
              const targetZoom = Math.min((map.getZoom() ?? 7) + 2, 16);
              map.flyTo(b.center, targetZoom, { duration: 0.45 });
            },
          }}
        >
          <Popup>
            <p className="font-display italic font-bold text-ds-13 leading-tight">
              {b.count} {b.count === 1 ? "job" : "jobs"} here
            </p>
            <p className="text-ds-11 text-muted-foreground">Tap the bubble to zoom in.</p>
          </Popup>
        </CircleMarker>
      ))}
    </>
  );
}

// Floating "recenter" control — sits over the map, bottom-right above
// the dock clearance. flyTo with the initial Louisiana frame so users
// who have panned/zoomed deep can get back to the statewide view in
// one tap.
function RecenterControl({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  return (
    <button
      type="button"
      onClick={() => map.flyTo(center, zoom, { duration: 0.45 })}
      aria-label="Recenter map"
      className="absolute z-[400] w-10 h-10 rounded-full flex items-center justify-center active:scale-[0.94] transition-all"
      style={{
        // Sit clear of the floating dock + FAB at the bottom of the
        // screen. The parent map div bleeds beneath the dock so the
        // button needs to anchor above it.
        right: "0.75rem",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 0.75rem)",
        background: "hsla(0, 0%, 100%, 0.85)",
        border: "1px solid hsl(var(--olivewood) / 0.22)",
        color: "hsl(var(--olivewood))",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
          "0 4px 14px -4px hsl(var(--olivewood) / 0.22)",
      }}
    >
      <Crosshair className="w-4 h-4" strokeWidth={2.25} />
    </button>
  );
}

export function BrowseMap({ onJobAction, ctaLabel = "View", currentUserId, emptyStateCta }: BrowseMapProps) {
  const [jobs, setJobs] = useState<MapJob[]>([]);
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

  const labels = useMemo(
    () => ({
      cleaning: "Cleaning",
      yard_work: "Yard Work",
      moving: "Moving",
      errands: "Errands",
      handyman: "Handyman",
      painting: "Painting",
      delivery: "Delivery",
      pet_care: "Pet Care",
      assembly: "Assembly",
      other: "Other",
    }),
    [],
  );

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full w-full rounded-t-2xl border border-b-0 border-border bg-card/40"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 1rem)" }}
      >
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      /* Empty-state surface bleeds beneath the floating dock — the
         outer rounded-t-2xl + cropped bottom shadow mirror the list
         empty state on the guest + auth dashboards so both views read
         as the same continuous panel under the dock's frosted
         curtain. paddingBottom clears the FAB + tab strip. */
      <div
        className="flex flex-col items-center justify-center h-full w-full liquid-glass px-6 text-center gap-3 rounded-t-2xl"
        style={{
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          borderBottom: "none",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
            "-1px 0 2px hsl(var(--olivewood) / 0.06), " +
            "1px 0 2px hsl(var(--olivewood) / 0.06), " +
            "0 -1px 2px hsl(var(--olivewood) / 0.06)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 1.5rem)",
          paddingTop: "1.5rem",
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
            className="font-serif italic max-w-[260px]"
            style={{ fontSize: "0.82rem", color: "hsl(var(--olivewood) / 0.7)" }}
          >
            New posts land here the moment they go live across Louisiana.
          </p>
        </div>
        {/* Optional CTA — passed by the guest dashboard so the empty
            map still nudges signup ("get pinged when one lands") rather
            than dead-ending the user. */}
        {emptyStateCta && (
          <Button
            variant="bark"
            onClick={emptyStateCta.onClick}
            className="rounded-ds-md mt-1"
          >
            <BellRing className="w-4 h-4 mr-2" /> {emptyStateCta.label}
          </Button>
        )}
      </div>
    );
  }

  const heatBuckets = view === "heat" ? bucketJobs(jobs) : [];

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
          in both modes so the toggle reads as a real scanning aid. */}
      <div className="absolute top-3 right-3 z-[400] flex flex-col items-end gap-1.5">
        <div
          aria-hidden
          data-testid="browse-map-job-count"
          className="px-2.5 h-6 rounded-full flex items-center font-sans font-semibold text-[0.68rem] tracking-wide"
          style={{
            background: "hsla(0, 0%, 100%, 0.92)",
            color: "hsl(var(--bark))",
            border: "0.5px solid hsl(var(--olivewood) / 0.18)",
            boxShadow: "0 4px 14px -4px hsl(var(--olivewood) / 0.18)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
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
                    ? "px-3.5 h-8 rounded-full text-[0.78rem] font-sans font-semibold transition-all bg-[hsl(var(--bark))] text-white shadow-sm"
                    : "px-3.5 h-8 rounded-full text-[0.78rem] font-sans font-semibold transition-all bg-[hsl(var(--parchment)/0.9)] text-[hsl(var(--bark))] hover:bg-[hsl(var(--parchment))]"
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
      {/* Subtle tile-load overlay — fades out once the OSM tiles
          report `load` so the first paint is a soft transition rather
          than a flash of half-rendered tiles. Pointer events bypass so
          users can still pan even while it fades. */}
      <div
        aria-hidden
        className="absolute inset-0 z-[300] flex items-center justify-center pointer-events-none transition-opacity duration-500"
        style={{
          opacity: tilesLoading ? 1 : 0,
          background: "hsla(38, 18%, 97%, 0.55)",
          backdropFilter: "blur(2px)",
          WebkitBackdropFilter: "blur(2px)",
        }}
      >
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
      <MapContainer
        center={LA_CENTER}
        zoom={LA_DEFAULT_ZOOM}
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
          maxClusterRadius={50}
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
                <p className="font-mono text-ds-13 font-semibold">${Number(job.budget).toFixed(2)}</p>
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
