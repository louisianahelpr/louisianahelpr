import { busyCircleOpacity, busyCircleRadiusMeters, type BusyArea } from "@/lib/busyAreas";
import type { MKMap, MapKitRuntime } from "@/components/browseMap/mapkitRuntime";

type Overlay = Parameters<MKMap["addOverlays"]>[0][number];

/** The olive the app's primary controls wear, as a CSS colour MapKit can paint. */
function busyColor(): string {
  if (typeof document === "undefined") return "#5f6640";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--bark").trim();
  return v ? `hsl(${v})` : "#5f6640";
}

/**
 * Q2435: shade each busy parish with a circle at its centroid, bigger and
 * darker the more is waiting. Removes the previous set first and returns the
 * new one, so a caller keeps exactly one set on the map. Circles are not
 * interactive: the counts are read from the list beside the map.
 */
export function drawBusyAreas(mk: MapKitRuntime, map: MKMap, areas: readonly BusyArea[], previous: readonly Overlay[]): Overlay[] {
  if (previous.length) {
    try { map.removeOverlays([...previous]); } catch { /* the map was destroyed under us: nothing left to remove */ }
  }
  const max = areas.reduce((m, a) => Math.max(m, a.total), 0);
  if (max === 0) return [];
  const color = busyColor();
  const overlays = areas.map(
    (a) =>
      new mk.CircleOverlay(new mk.Coordinate(a.center.lat, a.center.lng), busyCircleRadiusMeters(a.total, max), {
        style: new mk.Style({ fillColor: color, fillOpacity: busyCircleOpacity(a.total, max), strokeColor: color, strokeOpacity: 0.55, lineWidth: 1 }),
        enabled: false,
      }),
  );
  map.addOverlays(overlays);
  return overlays;
}
