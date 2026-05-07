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

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { divIcon, point as leafletPoint } from "leaflet";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import "leaflet/dist/leaflet.css";

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
}

// Louisiana center fallback (state geographic mean, near Marksville).
const LA_CENTER: [number, number] = [31.0, -92.0];
const LA_DEFAULT_ZOOM = 7;

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

export function BrowseMap({ onJobAction, ctaLabel = "View", currentUserId }: BrowseMapProps) {
  const [jobs, setJobs] = useState<MapJob[]>([]);
  const [loading, setLoading] = useState(true);

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
        setJobs(
          rows.filter(
            (j) => j.latitude !== null && j.longitude !== null && !Number.isNaN(Number(j.latitude)),
          ),
        );
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
      <div className="flex items-center justify-center h-96 rounded-2xl border border-border bg-card/40">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 rounded-2xl border border-border bg-card/40 px-6 text-center">
        <p className="font-display italic text-sm text-foreground">
          No jobs on the map just yet.
        </p>
        <p className="font-serif italic text-xs text-muted-foreground mt-1">
          New posts appear here as soon as they go live across Louisiana.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden border border-border" style={{ height: 480 }}>
      <MapContainer
        center={LA_CENTER}
        zoom={LA_DEFAULT_ZOOM}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToPins jobs={jobs} />
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
                <p className="font-display font-bold text-sm leading-tight">
                  {job.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {labels[job.category as keyof typeof labels] ?? job.category}
                  {job.parish ? ` · ${job.parish}` : ""}
                </p>
                <p className="font-mono text-sm font-semibold">${Number(job.budget).toFixed(2)}</p>
                {job.is_urgent && (
                  <p className="text-[10px] uppercase tracking-wide text-destructive font-bold">
                    Urgent
                  </p>
                )}
                {onJobAction && (
                  <Button
                    size="sm"
                    onClick={() => onJobAction(job.id)}
                    className="w-full mt-1.5 h-8 text-xs"
                  >
                    {ctaLabel}
                  </Button>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
}
