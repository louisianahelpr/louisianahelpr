import { useEffect, useMemo, useRef, useState } from "react";
import { Flame } from "lucide-react";
import { useMapKitJs } from "@/hooks/useMapKitJs";
import { report } from "@/lib/errorLogger";
import { busyAreaLabel, busyAreas, busyAreasBounds } from "@/lib/busyAreas";
import { colorSchemeFor, getMapKit, regionFromBounds, type MKMap } from "@/components/browseMap/mapkitRuntime";
import { LA_BOUNDS, readIsDark } from "@/components/browseMap/config";
import { useMapJobs } from "@/components/browseMap/useMapJobs";
import { drawBusyAreas } from "./busyAreaOverlays";

/**
 * Q2435 (owner-approved 2026-10-27): "Busy right now" on the Deliver page.
 * A small Louisiana map shading the parishes where open jobs and open
 * deliveries are waiting, and the same counts as a list (the list is the
 * accessible reading and the fallback when the map cannot load). Counts only,
 * by parish: jobs from get_open_jobs_for_map (the Browse map's own read), the
 * deliveries passed in from the page's own open-task read.
 */
export function BusyAreasCard({ userId, deliveries }: { userId: string; deliveries: ReadonlyArray<{ pickup_area?: string | null }> }) {
  const { jobs, loadError } = useMapJobs(userId, undefined);
  const summary = useMemo(() => busyAreas(jobs, deliveries), [jobs, deliveries]);
  const top = summary.areas.slice(0, 6);

  const mapKitStatus = useMapKitJs();
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const mapRef = useRef<MKMap | null>(null);
  const overlaysRef = useRef<Parameters<MKMap["addOverlays"]>[0]>([]);
  const [mapOk, setMapOk] = useState(false);

  useEffect(() => {
    if (mapKitStatus !== "ready" || mapRef.current || !el) return;
    const mk = getMapKit();
    if (!mk) return;
    try {
      mapRef.current = new mk.Map(el, {
        region: regionFromBounds(mk, LA_BOUNDS, 1.02),
        colorScheme: colorSchemeFor(mk, readIsDark()),
        showsCompass: mk.FeatureVisibility?.Hidden ?? "hidden",
        showsScale: mk.FeatureVisibility?.Hidden ?? "hidden",
        showsZoomControl: false,
        showsMapTypeControl: false,
        showsUserLocationControl: false,
        isRotationEnabled: false,
      });
      setMapOk(true);
    } catch (e) {
      report(e instanceof Error ? e : new Error("busy-areas map failed"), { tags: { source: "BusyAreasCard.mapkit" } });
    }
  }, [mapKitStatus, el]);

  useEffect(() => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map || !mapOk) return;
    try {
      overlaysRef.current = drawBusyAreas(mk, map, summary.areas, overlaysRef.current);
      // Frame the busy parishes (with room around them), not the whole Gulf coast.
      const bounds = busyAreasBounds(summary.areas);
      if (bounds) map.setRegionAnimated(regionFromBounds(mk, bounds, 1), false);
    } catch (e) {
      report(e instanceof Error ? e : new Error("busy-area shading failed"), { tags: { source: "BusyAreasCard.shading" } });
    }
  }, [summary, mapOk]);

  useEffect(() => () => {
    try { mapRef.current?.destroy?.(); } catch { /* the map was already torn down on unmount; nothing to report */ }
    mapRef.current = null;
  }, []);

  const mapUnusable = mapKitStatus === "missing-token" || mapKitStatus === "error";

  return (
    <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4" aria-labelledby="busy-areas-title" data-testid="busy-areas">
      <div className="flex items-center gap-2">
        <Flame className="h-4 w-4 text-[hsl(var(--bark))]" aria-hidden />
        <h2 id="busy-areas-title" className="text-base font-semibold">Busy right now</h2>
      </div>
      {!mapUnusable && (
        <div ref={setEl} className="h-44 w-full overflow-hidden rounded-xl bg-muted" aria-hidden data-testid="busy-areas-map" />
      )}
      {loadError ? (
        <p className="text-sm text-muted-foreground">We couldn't load open jobs just now, so this shows deliveries only.</p>
      ) : null}
      {top.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is waiting right now. New jobs and deliveries show up here as they come in.</p>
      ) : (
        <ul className="space-y-1.5" aria-label="Where work is waiting">
          {top.map((a) => (
            <li key={a.parish} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-foreground">{busyAreaLabel(a)}</span>
              <span className="shrink-0 tabular-nums font-semibold text-[hsl(var(--bark))]" aria-hidden>{a.total}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
