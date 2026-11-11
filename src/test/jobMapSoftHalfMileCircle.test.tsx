/**
 * Owner 2026-11-10 (OWNER-DECISIONS 10:45 AM, lead's scope call 7:35 PM): "Job map: soft ~half-mile circle instead of
 * a pin". The job's location map (JobLocationPreview: the job detail sheet and the guest /jobs/:id) draws ONE soft
 * circle of half a mile (805 m) around the rounded point, never a pin, and the true address stays inside it: rounding
 * to 2 decimals moves the centre at most ~736 m at 30 deg N.
 *
 * @mutate src/components/dashboard/jobDetailDialog/JobLocationPreview.tsx | const MASK_RADIUS_M = 805; | const MASK_RADIUS_M = 1100;
 * @mutate src/components/dashboard/jobDetailDialog/JobLocationPreview.tsx | const CIRCLE_STROKE_OPACITY = 0.3; | const CIRCLE_STROKE_OPACITY = 0.55;
 * @mutate src/components/dashboard/jobDetailDialog/JobLocationPreview.tsx | const maskCoordinate = (v: number) => Math.round(v * 10 ** MASK_DECIMALS) / 10 ** MASK_DECIMALS; | const maskCoordinate = (v: number) => v;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "ready" }));
import { JobLocationPreview } from "@/components/dashboard/jobDetailDialog/JobLocationPreview";

// A real Louisiana point (New Iberia), deliberately off the 0.01 grid.
const TRUE_LAT = 30.00349;
const TRUE_LNG = -91.81847;

type Circle = { coord: { lat: number; lng: number }; radius: number; style: Record<string, number> };
function installMapKit() {
  const overlays: Circle[] = [];
  const annotations: unknown[] = [];
  (window as unknown as { mapkit: unknown }).mapkit = {
    Geocoder: class { lookup(_p: string, cb: (e: null, d: unknown) => void) { cb(null, { results: [{ coordinate: { latitude: TRUE_LAT, longitude: TRUE_LNG } }] }); } },
    Coordinate: class { constructor(public lat: number, public lng: number) {} },
    CoordinateSpan: class { constructor(public a: number, public b: number) {} },
    CoordinateRegion: class { constructor(public c: unknown, public s: unknown) {} },
    Map: class {
      region: unknown;
      addAnnotation(a: unknown) { annotations.push(a); }
      addOverlay(o: Circle) { overlays.push(o); }
      destroy() {}
    },
    CircleOverlay: class { style: Record<string, number>; constructor(public coord: { lat: number; lng: number }, public radius: number, o?: { style: { o: Record<string, number> } }) { this.style = o?.style.o ?? {}; } },
    Style: class { constructor(public o: Record<string, number>) {} },
    FeatureVisibility: { Hidden: "hidden" },
  };
  return { overlays, annotations };
}

/** Metres between two points (equirectangular; exact enough at this scale). */
function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const k = 111_320;
  const dy = (aLat - bLat) * k;
  const dx = (aLng - bLng) * k * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  return Math.hypot(dx, dy);
}

afterEach(() => { delete (window as unknown as { mapkit?: unknown }).mapkit; });

describe("job map: a soft half-mile circle, never a pin (owner 11-10)", () => {
  it("draws one circle of 805 m with a light wash and a faint edge, and no pin", async () => {
    const mk = installMapKit();
    render(<JobLocationPreview address="123 Main St, New Iberia, LA 70560" />);
    await waitFor(() => expect(mk.overlays.length).toBe(1));
    const [c] = mk.overlays;
    expect(c.radius).toBe(805);
    expect(c.style.fillOpacity).toBeLessThanOrEqual(0.15);
    expect(c.style.strokeOpacity).toBeLessThanOrEqual(0.3);
    expect(c.style.lineWidth).toBeLessThanOrEqual(1);
    expect(mk.annotations).toHaveLength(0);
  });

  it("the circle is centred on the rounded point, and the true address is inside it", async () => {
    const mk = installMapKit();
    render(<JobLocationPreview address="123 Main St, New Iberia, LA 70560" />);
    await waitFor(() => expect(mk.overlays.length).toBe(1));
    const [c] = mk.overlays;
    expect(c.coord.lat).toBe(30);
    expect(c.coord.lng).toBe(-91.82);
    expect(metres(c.coord.lat, c.coord.lng, TRUE_LAT, TRUE_LNG)).toBeLessThan(c.radius);
    // The worst case anywhere in Louisiana (29 deg N, the widest east-west step): half a 0.01 cell each way.
    expect(metres(29, -90, 29.005, -90.005)).toBeLessThan(805);
  });
});
