/**
 * A2-L14 (app audit 2026-10-28, 1440 Browse map): the dark "Busy right now"
 * circle (Q2435, a parish centroid with a 5-20 km radius) was cut off at the
 * map's right edge, because fitToPins framed the pins only. With pins at
 * Delcambre and Baton Rouge, the East Baton Rouge circle ran ~20 km past the
 * framed east edge. The frame now includes every busy circle's full extent.
 *
 * (The audit's other half, "3 of 5 jobs have no pin", is NULL coordinates:
 * measured 2026-10-29 on prod open_jobs_browse, "Mow and Weed Eat" in
 * New Iberia has latitude/longitude NULL. That is the A2-B4 geocode class,
 * not the camera.)
 *
 * @mutate src/components/browseMap/MapLayers.tsx |   for (const c of circles) { |   for (const c of circles.slice(0, 0)) {
 * @mutate src/components/browseMap/useMapLayersSync.ts | fitToPins(mk, map, visibleJobs, false, band, busyAreaCircles(busyAreas(visibleJobs, []).areas)); | fitToPins(mk, map, visibleJobs, false, band);
 * @mutate src/lib/busyAreas.ts |   return areas.map((a) => ({ lat: a.center.lat, lng: a.center.lng, radiusMeters: busyCircleRadiusMeters(a.total, max) })); |   return [];
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fitToPins } from "./MapLayers";
import { busyAreas, busyAreaCircles } from "@/lib/busyAreas";
import type { MapKitRuntime, MKMap } from "./mapkitRuntime";
import { blankComments } from "@/test/helpers/blankNonCode";

class Coordinate { constructor(public latitude: number, public longitude: number) {} }
class CoordinateSpan { constructor(public latitudeDelta: number, public longitudeDelta: number) {} }
class CoordinateRegion { constructor(public center: Coordinate, public span: CoordinateSpan) {} }
const mk = { Coordinate, CoordinateSpan, CoordinateRegion } as unknown as MapKitRuntime;

function frame(jobs: { latitude: number; longitude: number; parish: string }[]) {
  let region: CoordinateRegion | null = null;
  const map = { element: { clientHeight: 0 }, setRegionAnimated: (r: CoordinateRegion) => { region = r; } } as unknown as MKMap;
  fitToPins(mk, map, jobs, false, 0, busyAreaCircles(busyAreas(jobs, []).areas));
  const r = region as unknown as CoordinateRegion;
  return {
    east: r.center.longitude + r.span.longitudeDelta / 2,
    west: r.center.longitude - r.span.longitudeDelta / 2,
    north: r.center.latitude + r.span.latitudeDelta / 2,
    south: r.center.latitude - r.span.latitudeDelta / 2,
  };
}

const M_PER_DEG = 111_320;

describe("A2-L14: the Browse map frame includes the busy-area circles", () => {
  // The audit's screen: Delcambre (Vermilion) and two Baton Rouge jobs.
  const JOBS = [
    { latitude: 29.96, longitude: -91.99, parish: "Vermilion" },
    { latitude: 30.45, longitude: -91.19, parish: "East Baton Rouge" },
    { latitude: 30.44, longitude: -91.18, parish: "East Baton Rouge" },
  ];

  it("every circle sits wholly inside the framed region", () => {
    const circles = busyAreaCircles(busyAreas(JOBS, []).areas);
    expect(circles.length).toBeGreaterThan(1);
    const f = frame(JOBS);
    for (const c of circles) {
      const dLat = c.radiusMeters / M_PER_DEG;
      const dLng = c.radiusMeters / (M_PER_DEG * Math.cos((c.lat * Math.PI) / 180));
      expect(c.lng + dLng).toBeLessThanOrEqual(f.east);
      expect(c.lng - dLng).toBeGreaterThanOrEqual(f.west);
      expect(c.lat + dLat).toBeLessThanOrEqual(f.north);
      expect(c.lat - dLat).toBeGreaterThanOrEqual(f.south);
    }
  });

  it("every pin is still inside the frame", () => {
    const f = frame(JOBS);
    for (const j of JOBS) {
      expect(j.longitude).toBeLessThan(f.east);
      expect(j.longitude).toBeGreaterThan(f.west);
    }
  });

  it("BrowseMap hands the busy circles to the fit", () => {
    // The fit effect lives in useFitPinsOnChange (lifted out of BrowseMap.tsx for componentSizeRatchet); BrowseMap calls it.
    const hook = blankComments(readFileSync(resolve(__dirname, "useMapLayersSync.ts"), "utf8"));
    expect(hook).toMatch(/fitToPins\([^;]*busyAreaCircles\(busyAreas\(visibleJobs, \[\]\)\.areas\)\)/);
    const map = blankComments(readFileSync(resolve(__dirname, "../BrowseMap.tsx"), "utf8"));
    expect(map).toMatch(/useFitPinsOnChange\(mapRef, mapReady, visibleJobs, clearanceProbeRef\);/);
    expect(map).not.toMatch(/fitToPins\(mk, map, visibleJobs/);
  });
});
