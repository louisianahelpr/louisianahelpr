/**
 * Declutter Browse: nearest first, area + miles only (rows 5, 27).
 *
 * @mutate src/lib/declutter/distance.ts |   if (approximate) return `About ${Math.max(1, Math.round(miles))} mi away`; |   if (false) return `About ${Math.max(1, Math.round(miles))} mi away`;
 * @mutate src/lib/declutter/distance.ts |     .sort((x, y) => (x.miles as number) - (y.miles as number)); |     ;
 * @mutate src/lib/declutter/distance.ts |     .filter((r) => maxMiles === null \|\| (r.miles as number) <= maxMiles) |     .filter(() => true)
 * @mutate src/lib/declutter/distance.ts |   if (miles > MAX_SHOWN_MILES) return null; |   if (miles > 1e9) return null;
 */
import { describe, expect, it } from "vitest";
import { MAX_SHOWN_MILES, formatPrice, milesBetween, milesLabel, nearestFirst } from "./distance";

// Baton Rouge (30.45, -91.15), New Orleans (29.95, -90.07), Lafayette (30.22, -92.02).
const items = [
  { id: "nola", area_lat: 29.95, area_lng: -90.07 },
  { id: "laf", area_lat: 30.22, area_lng: -92.02 },
  { id: "br", area_lat: 30.45, area_lng: -91.15 },
];
const BR = { lat: 30.45, lng: -91.16 };

describe("Declutter nearest first (rows 5, 27)", () => {
  it("measures straight-line miles", () => {
    const m = milesBetween({ lat: 30.45, lng: -91.15 }, { lat: 29.95, lng: -90.07 });
    expect(m).toBeGreaterThan(65);
    expect(m).toBeLessThan(80);
  });

  it("orders nearest first and filters by distance", () => {
    expect(nearestFirst(items, BR, null).map((r) => r.item.id)).toEqual(["br", "laf", "nola"]);
    expect(nearestFirst(items, BR, 10).map((r) => r.item.id)).toEqual(["br"]);
  });

  it("without a location keeps the order and shows no miles", () => {
    const rows = nearestFirst(items, null, 5);
    expect(rows.map((r) => r.item.id)).toEqual(["nola", "laf", "br"]);
    expect(rows.every((r) => r.miles === null)).toBe(true);
  });

  it("labels and prices in plain words", () => {
    expect(milesLabel(0.4)).toBe("Less than 1 mi away");
    expect(milesLabel(12.6)).toBe("13 mi away");
    expect(milesLabel(null)).toBeNull();
    // A rough origin (ZIP/parish centre, coarse fix) says "About", never "Less than 1 mi".
    expect(milesLabel(0.4, true)).toBe("About 1 mi away");
    expect(milesLabel(12.6, true)).toBe("About 13 mi away");
    expect(milesLabel(null, true)).toBeNull();
    expect(formatPrice(4000)).toBe("$40");
    expect(formatPrice(1999)).toBe("$19.99");
  });

  it("lead 2026-10-28: no \"1835 mi away\" — a figure past MAX_SHOWN_MILES is not shown, from a real far-away position", () => {
    // The walkthrough's numbers: an item at Downtown, Baton Rouge (30.46, -91.19), the viewer's saved position Menlo Park, CA.
    const far = milesBetween({ lat: 37.4728, lng: -122.2444 }, { lat: 30.46, lng: -91.19 });
    expect(Math.round(far)).toBe(1835);
    expect(milesLabel(far)).toBeNull();
    expect(milesLabel(far, true)).toBeNull();
    // Inside Louisiana every figure still shows: Shreveport to New Orleans is the long way round (~280 mi).
    const span = milesBetween({ lat: 32.52, lng: -93.75 }, { lat: 29.95, lng: -90.07 });
    expect(span).toBeLessThan(MAX_SHOWN_MILES);
    expect(milesLabel(span)).toMatch(/^\d+ mi away$/);
    expect(MAX_SHOWN_MILES).toBeGreaterThan(250);
  });

  it("formats prices", () => {
    expect(formatPrice(4000)).toBe("$40");
    expect(formatPrice(1999)).toBe("$19.99");
  });
});
