import { useEffect, useMemo, useRef, useState } from "react";
import { Flame } from "lucide-react";
import { useMapKitJs } from "@/hooks/useMapKitJs";
import { report } from "@/lib/errorLogger";
import { busyAreaLabel, busyAreas } from "@/lib/busyAreas";
import { colorSchemeFor, getMapKit, regionFromBounds, type MKMap } from "@/components/browseMap/mapkitRuntime";
import { readIsDark } from "@/components/browseMap/config";

/**
 * The map always frames Louisiana's land (lead walkthrough 2026-10-28, shot 09: with one busy parish on the coast,
 * Vermilion, the map zoomed to it and showed Houston, Gulfport and mostly Gulf water). The shared LA_BOUNDS reach
 * 28.5 N, deep in the Gulf, for the jobs map's own reasons; this card frames the state itself, and the busy
 * parishes (all in Louisiana) are shaded inside it. Guard: src/test/deliverTabExplains.test.tsx.
 */
export const LOUISIANA_LAND: [[number, number], [number, number]] = [
  [29.0, -94.05], // SW: Sabine Pass
  [33.02, -88.8], // NE: the Arkansas line, the Pearl River
];
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
        region: regionFromBounds(mk, LOUISIANA_LAND, 1.02),
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
        // Taller, and no wider than the state's own shape needs: a 4:1 strip fitted to Louisiana's height showed Texas
        // to Florida.
        <div ref={setEl} className="aspect-[4/3] max-h-72 w-full max-w-md overflow-hidden rounded-xl bg-muted" aria-hidden data-testid="busy-areas-map" />
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
      {/* Lead 2026-10-28, option (c): the counts keep Q2435's jobs + deliveries mix and words; one plain line says
          where each is, with the deliveries counted on their own (every open delivery the page read, placed or not). */}
      {top.length > 0 && (
        <p className="text-ds-13 text-muted-foreground" data-busy-where="">
          {deliveries.length === 0 ? "No deliveries are waiting right now." : deliveries.length === 1 ? "1 delivery is waiting." : `${deliveries.length} deliveries are waiting.`} Open jobs are on the Jobs tab; deliveries you can take are below.
        </p>
      )}
    </section>
  );
}
