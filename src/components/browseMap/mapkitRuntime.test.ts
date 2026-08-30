// The pixel↔metre bridge for the heat layer. Leaflet's CircleMarker radius was
// in screen pixels and MapKit's CircleOverlay radius is in metres, so this
// conversion is the one place the ported heat bubbles can silently look wrong
// (a fixed metre radius balloons when zoomed in and disappears when zoomed
// out). Pinned with a test rather than eyeballed.

import { describe, it, expect } from "vitest";
import { metresPerPixel, METRES_PER_DEGREE_LAT, type MKMap } from "./mapkitRuntime";
import { heatRadiusPx } from "./mapMarkers";

function fakeMap(widthPx: number, lngDelta: number, centerLat: number): MKMap {
  return {
    element: { clientWidth: widthPx } as HTMLElement,
    region: {
      center: { latitude: centerLat, longitude: -92 },
      span: { latitudeDelta: lngDelta, longitudeDelta: lngDelta },
    },
  } as unknown as MKMap;
}

describe("metresPerPixel", () => {
  it("derives the scale from the visible longitude span and the pane width", () => {
    // 5° of longitude at the equator across 500px.
    const mpp = metresPerPixel(fakeMap(500, 5, 0));
    expect(mpp).toBeCloseTo((5 * METRES_PER_DEGREE_LAT) / 500, 3);
  });

  it("narrows with latitude — a degree of longitude is shorter in Louisiana", () => {
    const atEquator = metresPerPixel(fakeMap(500, 5, 0));
    const inLouisiana = metresPerPixel(fakeMap(500, 5, 31));
    expect(inLouisiana).toBeLessThan(atEquator);
    expect(inLouisiana).toBeCloseTo(atEquator * Math.cos((31 * Math.PI) / 180), 3);
  });

  it("halves when the camera zooms one level in, so a bubble holds its screen size", () => {
    const wide = metresPerPixel(fakeMap(500, 5, 31));
    const closer = metresPerPixel(fakeMap(500, 2.5, 31));
    expect(closer).toBeCloseTo(wide / 2, 6);
    // Which is the whole point: the metre radius halves with it, leaving the
    // bubble the same number of pixels across.
    expect(heatRadiusPx(3) * closer).toBeCloseTo((heatRadiusPx(3) * wide) / 2, 6);
  });

  it("returns 0 (caller falls back) when the pane has not been laid out yet", () => {
    expect(metresPerPixel(fakeMap(0, 5, 31))).toBe(0);
  });
});

describe("heatRadiusPx", () => {
  it("matches the Leaflet formula, including the 36px cap", () => {
    expect(heatRadiusPx(1)).toBe(12);
    expect(heatRadiusPx(3)).toBe(20);
    expect(heatRadiusPx(7)).toBe(36);
    expect(heatRadiusPx(99)).toBe(36);
  });
});
