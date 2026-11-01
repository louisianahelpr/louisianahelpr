import { useEffect, useRef, useState, type RefObject } from "react";
import { report } from "@/lib/errorLogger";
import { busyAreaCircles, busyAreas, busyCirclesDimmed } from "@/lib/busyAreas";
import { drawBusyAreas } from "@/components/busyAreas/busyAreaOverlays";
import { colorSchemeFor, getMapKit, type MKMap } from "./mapkitRuntime";
import { readIsDark, type MapJob } from "./config";
import { fitToPins } from "./MapLayers";

/**
 * Two map-wide layers BrowseMap keeps in step with the page, lifted out of
 * BrowseMap.tsx (componentSizeRatchet) when Q2435 added the second.
 */

/**
 * Follow the app's light/dark theme. `useDarkMode` writes the resolved theme
 * to `<html data-theme>`, so an attribute observer catches both an explicit
 * toggle and a system-preference flip while the map is open. (Moved verbatim
 * from BrowseMap.tsx.)
 */
export function useMapFollowsTheme(mapRef: RefObject<MKMap | null>, mapReady: boolean) {
  const [isDark, setIsDark] = useState(readIsDark);
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
  }, [isDark, mapReady, mapRef]);
}

/**
 * Q2435 "Busy right now": shade each parish where the pins on this map are
 * waiting (counts by the job's parish, drawn at the parish centroid), so the
 * busy areas read at a glance before zooming in. Follows the filtered pins.
 */
export function useBusyAreaShading(mapRef: RefObject<MKMap | null>, mapReady: boolean, jobs: ReadonlyArray<{ parish?: string | null }>): boolean {
  const overlaysRef = useRef<Parameters<MKMap["addOverlays"]>[0]>([]);
  // NIGHT-JOBSMA5-4: whether any circle is on the map, so BrowseMap can say what the circles are (BusyAreasMapKey).
  const [shown, setShown] = useState(false);
  // NIGHT-JOBSMA5-4: dim the circles at street zoom (busyCirclesDimmed), re-read after every pan or zoom.
  const [dimmed, setDimmed] = useState(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const onRegion = () => setDimmed(busyCirclesDimmed(map.region?.span?.latitudeDelta));
    map.addEventListener("region-change-end", onRegion);
    return () => map.removeEventListener("region-change-end", onRegion);
  }, [mapReady, mapRef]);
  useEffect(() => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map || !mapReady) return;
    try {
      overlaysRef.current = drawBusyAreas(mk, map, busyAreas(jobs, []).areas, overlaysRef.current, dimmed);
      setShown(overlaysRef.current.length > 0);
    } catch (e) {
      // Not silent; the pins still show every job, so the map stays usable.
      report(e instanceof Error ? e : new Error("busy-area shading failed"), { tags: { source: "BrowseMap.busyAreas" } });
    }
  }, [jobs, mapReady, mapRef, dimmed]);
  return shown;
}

/**
 * Frame the pins whenever the visible set changes (FitToPins' old job), with
 * the dock band excluded so an auto-framed pin is never parked underneath it.
 * Lifted out of BrowseMap.tsx (componentSizeRatchet) when A2-L14 added the circles.
 */
export function useFitPinsOnChange(
  mapRef: RefObject<MKMap | null>,
  mapReady: boolean,
  visibleJobs: ReadonlyArray<Pick<MapJob, "latitude" | "longitude" | "parish">>,
  clearanceProbeRef: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map) return;
    // With the busy-area circles, so the busiest is never cut at the edge (A2-L14).
    fitToPins(mk, map, visibleJobs, false, clearanceProbeRef.current?.offsetHeight ?? 0, busyAreaCircles(busyAreas(visibleJobs, []).areas));
  }, [visibleJobs, mapReady, mapRef, clearanceProbeRef]);
}
