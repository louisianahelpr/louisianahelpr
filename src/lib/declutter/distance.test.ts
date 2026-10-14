/**
 * Declutter Browse: nearest first, area + miles only (rows 5, 27).
 *
 * @mutate src/lib/declutter/distance.ts |     .sort((x, y) => (x.miles as number) - (y.miles as number)); |     ;
 * @mutate src/lib/declutter/distance.ts |     .filter((r) => maxMiles === null \|\| (r.miles as number) <= maxMiles) |     .filter(() => true)
 */
import { describe, expect, it } from "vitest";
import { formatPrice, milesBetween, milesLabel, nearestFirst } from "./distance";

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
    expect(formatPrice(4000)).toBe("$40");
    expect(formatPrice(1999)).toBe("$19.99");
  });
});
