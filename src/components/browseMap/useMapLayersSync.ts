import { useEffect, useRef, useState, type RefObject } from "react";
import { report } from "@/lib/errorLogger";
import { busyAreas } from "@/lib/busyAreas";
import { drawBusyAreas } from "@/components/busyAreas/busyAreaOverlays";
import { colorSchemeFor, getMapKit, type MKMap } from "./mapkitRuntime";
import { readIsDark } from "./config";

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
export function useBusyAreaShading(mapRef: RefObject<MKMap | null>, mapReady: boolean, jobs: ReadonlyArray<{ parish?: string | null }>) {
  const overlaysRef = useRef<Parameters<MKMap["addOverlays"]>[0]>([]);
  useEffect(() => {
    const mk = getMapKit();
    const map = mapRef.current;
    if (!mk || !map || !mapReady) return;
    try {
      overlaysRef.current = drawBusyAreas(mk, map, busyAreas(jobs, []).areas, overlaysRef.current);
    } catch (e) {
      // Not silent; the pins still show every job, so the map stays usable.
      report(e instanceof Error ? e : new Error("busy-area shading failed"), { tags: { source: "BrowseMap.busyAreas" } });
    }
  }, [jobs, mapReady, mapRef]);
}
