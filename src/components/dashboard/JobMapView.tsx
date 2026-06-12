// JobMapView — desktop-only Leaflet map panel for the split-screen
// Browse Tasks layout (≥ 1024px). The list occupies 420px on the left;
// this map fills the remaining right pane. Hidden on mobile — no layout
// changes touch the Capacitor native app.
//
// Pins are colored per category (matching the CompactJobCard dot colors).
// Hovering a list card highlights the corresponding pin (1.25× scale).
// Clicking a pin fires onJobClick → opens the JobDetailDialog.

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import { divIcon } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { EnrichedJob } from "@/components/dashboard/types";
import { getCityState } from "@/lib/locationUtils";

// ---------------------------------------------------------------------------
// Category → raw HSL hex for SVG inline styles (categoryColors uses
// Tailwind arbitrary-value classes which can't go in SVG fill attributes).
// Sourced from the dot hsl values in activityConstants.ts.
// ---------------------------------------------------------------------------
const CATEGORY_HEX: Record<string, string> = {
  cleaning:   "hsl(182 28% 44%)",
  yard_work:  "hsl(142 30% 40%)",
  moving:     "hsl(34 44% 47%)",
  errands:    "hsl(73 32% 40%)",
  handyman:   "hsl(19 46% 49%)",
  painting:   "hsl(330 40% 56%)",
  delivery:   "hsl(214 30% 51%)",
  pet_care:   "hsl(278 24% 57%)",
  assembly:   "hsl(6 42% 53%)",
  storm_prep: "hsl(220 28% 48%)",
  events:     "hsl(43 46% 46%)",
  other:      "hsl(40 10% 55%)",
};

function categoryColor(category: string): string {
  return CATEGORY_HEX[category] ?? CATEGORY_HEX.other;
}

// ---------------------------------------------------------------------------
// Pin icon factory — SVG teardrop, scales up 1.25× when highlighted.
// ---------------------------------------------------------------------------
function pinIcon(category: string, highlighted: boolean) {
  const color = categoryColor(category);
  const size = highlighted ? 34 : 28;
  const anchor = Math.round(size / 2);
  return divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [anchor, size],
    popupAnchor: [0, -size],
    html: `<svg width="${size}" height="${size}" viewBox="0 0 28 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="14" cy="13" rx="10" ry="10" fill="${color}" opacity="0.18"/>
      <circle cx="14" cy="13" r="7" fill="${color}"/>
      <circle cx="14" cy="13" r="3.5" fill="white" opacity="0.9"/>
      <path d="M14 20 L10 30 L14 27 L18 30 Z" fill="${color}"/>
    </svg>`,
  });
}

// ---------------------------------------------------------------------------
// FitToPins — fits the map bounds to all job pins on first load only.
// Uses the imperative Leaflet API (via useMap) so we don't fight the
// MapContainer's center/zoom props on subsequent renders.
// ---------------------------------------------------------------------------
function FitToPins({ jobs }: { jobs: EnrichedJob[] }) {
  const map = useMap();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (fittedRef.current) return;
    const coords = jobs
      .filter((j) => j.latitude != null && j.longitude != null)
      .map((j) => [j.latitude!, j.longitude!] as [number, number]);
    if (coords.length === 0) return;
    fittedRef.current = true;
    try {
      if (coords.length === 1) {
        map.setView(coords[0], 13, { animate: false });
      } else {
        map.fitBounds(coords, { padding: [40, 40], maxZoom: 14, animate: false });
      }
    } catch {
      // Non-fatal — map might be unmounted already.
    }
  }, [jobs, map]);

  return null;
}

// ---------------------------------------------------------------------------
// JobMapView
// ---------------------------------------------------------------------------
interface JobMapViewProps {
  jobs: EnrichedJob[];
  hoveredJobId: string | null;
  onJobClick: (job: EnrichedJob) => void;
}

export function JobMapView({ jobs, hoveredJobId, onJobClick }: JobMapViewProps) {
  // Jobs that have valid coordinates
  const mappable = jobs.filter((j) => j.latitude != null && j.longitude != null);

  // Category legend — top-4 categories present in the current job list,
  // sorted by frequency so the most-common ones always appear.
  const categoryFreq: Record<string, number> = {};
  for (const j of mappable) {
    categoryFreq[j.category] = (categoryFreq[j.category] ?? 0) + 1;
  }
  const legendCategories = Object.entries(categoryFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([cat]) => cat);

  // Default center: Louisiana geographic center
  const defaultCenter: [number, number] = [30.9843, -91.9623];

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={defaultCenter}
        zoom={7}
        className="w-full h-full"
        zoomControl={true}
        scrollWheelZoom={true}
        // Prevent Leaflet from stealing touch events on mobile (already
        // hidden via `hidden lg:flex` in Dashboard, but belt-and-suspenders).
        dragging={true}
        touchZoom={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <FitToPins jobs={mappable} />
        {mappable.map((job) => (
          <Marker
            key={job.id}
            position={[job.latitude!, job.longitude!]}
            icon={pinIcon(job.category, job.id === hoveredJobId)}
            zIndexOffset={job.id === hoveredJobId ? 1000 : 0}
            eventHandlers={{
              click: () => onJobClick(job),
            }}
          >
            <Popup closeButton={false} className="job-map-popup">
              <button
                type="button"
                onClick={() => onJobClick(job)}
                className="min-w-[180px] max-w-[220px] text-left p-0"
              >
                <p className="font-sans font-semibold text-[0.82rem] leading-tight text-gray-900 line-clamp-2">
                  {job.title}
                </p>
                {getCityState(job.location) && (
                  <p className="font-serif italic text-[0.72rem] text-gray-500 mt-0.5">
                    {getCityState(job.location)}
                  </p>
                )}
                <p className="font-sans font-bold text-[0.82rem] mt-1" style={{ color: categoryColor(job.category) }}>
                  ${job.budget}
                </p>
              </button>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Job count badge — top-right corner */}
      {mappable.length > 0 && (
        <div
          className="absolute top-3 right-3 z-[1000] px-2.5 py-1 rounded-full pointer-events-none"
          style={{
            background: "hsl(var(--bark) / 0.9)",
            color: "white",
            fontSize: "0.72rem",
            fontWeight: 600,
            letterSpacing: "0.02em",
            backdropFilter: "blur(8px)",
          }}
        >
          {mappable.length} {mappable.length === 1 ? "job" : "jobs"}
        </div>
      )}

      {/* Category legend — bottom-left corner */}
      {legendCategories.length > 0 && (
        <div
          className="absolute bottom-6 left-3 z-[1000] flex flex-col gap-1 px-2.5 py-2 rounded-ds-md pointer-events-none"
          style={{
            background: "rgba(255,255,255,0.88)",
            backdropFilter: "blur(8px)",
            border: "0.5px solid rgba(0,0,0,0.1)",
          }}
        >
          {legendCategories.map((cat) => (
            <div key={cat} className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: categoryColor(cat) }}
              />
              <span
                className="font-sans capitalize"
                style={{ fontSize: "0.68rem", color: "rgba(0,0,0,0.65)" }}
              >
                {cat.replace(/_/g, " ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default JobMapView;
