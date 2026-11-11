/**
 * Declutter Browse: nearest first, area + miles only (rows 5, 27).
 *
 * @mutate src/lib/declutter/distance.ts |   if (approximate) return `About ${Math.max(1, Math.round(miles))} mi away`; |   if (false) return `About ${Math.max(1, Math.round(miles))} mi away`;
 * @mutate src/lib/declutter/distance.ts |   if (long === "Less than 1 mi away") return "Under 1 mi"; |
 * @mutate src/lib/declutter/distance.ts |   return long.replace(/ away$/, ""); |   return long;
 * @mutate src/lib/declutter/distance.ts |     .sort((x, y) => (x.miles as number) - (y.miles as number) \|\| tie(x.item, y.item)); |     ;
 * @mutate src/lib/declutter/distance.ts |     .filter((r) => maxMiles === null \|\| (r.miles as number) <= maxMiles) |     .filter(() => true)
 * @mutate src/lib/declutter/distance.ts |   if (miles > MAX_SHOWN_MILES) return null; |   if (miles > 1e9) return null;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { MAX_SHOWN_MILES, formatPrice, milesBetween, milesLabel, nearestFirst, milesLabelShort } from "./distance";

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

  // F205 (UI audit 11-09): a tie (one coarse point, one live_at) is drawn in the cold load's first answer's order
  // whichever read it came from, so the full list replacing that answer moves no card.
  // @mutate src/lib/declutter/distance.ts | (x.miles as number) - (y.miles as number) \|\| tie(x.item, y.item) | (x.miles as number) - (y.miles as number)
  // @mutate src/lib/declutter/distance.ts |     return rx - ry; |     return 0;
  // @mutate src/components/declutter/DeclutterBrowseView.tsx | nearestFirst(others, from, from ? maxMiles : null, firstOrder) | nearestFirst(others, from, from ? maxMiles : null)
  it("a tie at one spot is newest first, then in the first answer's order, whatever order the read returned", () => {
    const at = "2026-11-08T17:28:13.691+00:00";
    const spot = { area_lat: 30.21, area_lng: -92.03 };
    const tie = [
      { id: "c", live_at: at, ...spot },
      { id: "a", live_at: at, ...spot },
      { id: "new", live_at: "2026-11-09T10:00:00+00:00", ...spot },
      { id: "b", live_at: at, ...spot },
      { id: "not-in-first", live_at: at, ...spot },
    ];
    const reversed = [...tie].reverse();
    const first = new Map(["b", "c", "a"].map((id, n) => [id, n]));
    const near = { lat: 30.45, lng: -91.15 };
    const want = ["new", "b", "c", "a", "not-in-first"];
    expect(nearestFirst(tie, near, null, first).map((r) => r.item.id)).toEqual(want);
    expect(nearestFirst(reversed, near, null, first).map((r) => r.item.id)).toEqual(want);
    expect(nearestFirst(tie, null, null, first).map((r) => r.item.id)).toEqual(want);
    expect(nearestFirst(reversed, null, null, first).map((r) => r.item.id)).toEqual(want);
    // No first answer: newest first, and a full tie keeps the order it came in (the server's, when it IS the answer).
    expect(nearestFirst(tie, near, null).map((r) => r.item.id)).toEqual(["new", "c", "a", "b", "not-in-first"]);
    // Distance still comes first: a nearer item leads whatever its age.
    const nearer = { id: "z-old", live_at: "2026-01-01T00:00:00+00:00", area_lat: 30.45, area_lng: -91.15 };
    expect(nearestFirst([...tie, nearer], near, null, first)[0].item.id).toBe("z-old");
  });

  it("Browse hands nearestFirst the first answer's order (the preview it shows while the full list loads)", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../../components/declutter/DeclutterBrowseView.tsx"), "utf8"));
    expect(src).toContain("new Map(capped.items.map((it, n) => [String(it.id), n]))");
    expect(src).toContain("nearestFirst(others, from, from ? maxMiles : null, firstOrder)");
  });

  it("labels and prices in plain words", () => {
    expect(milesLabel(0.4)).toBe("Less than 1 mi away");
    expect(milesLabel(12.6)).toBe("13 mi away");
    expect(milesLabel(null)).toBeNull();
    // A rough origin (ZIP/parish centre, coarse fix) says "About", never "Less than 1 mi".
    expect(milesLabel(0.4, true)).toBe("About 1 mi away");
    expect(milesLabel(12.6, true)).toBe("About 13 mi away");
    expect(milesLabel(null, true)).toBeNull();
    // Audit 11-10 F321: the card's short form keeps the figure and "About", and drops "away".
    expect(milesLabelShort(0.4)).toBe("Under 1 mi");
    expect(milesLabelShort(12.6)).toBe("13 mi");
    expect(milesLabelShort(0.4, true)).toBe("About 1 mi");
    expect(milesLabelShort(12.6, true)).toBe("About 13 mi");
    expect(milesLabelShort(null)).toBeNull();
    expect(milesLabelShort(2000)).toBeNull();
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
