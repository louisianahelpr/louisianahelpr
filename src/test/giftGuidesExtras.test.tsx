/**
 * The gift guides' extras (owner 2026-11-18): the date-driven shipping banner, the sidebar search, the hearts / My
 * list and the merged discount codes. The main page guard is src/test/giftGuidesPage.test.tsx.
 *
 * @mutate src/content/giftGuideShipping.ts |   if (month !== 12 \|\| day < 15) return SHIP_LINES.early; |   if (month !== 12 \|\| day <= 15) return SHIP_LINES.early;
 * @mutate src/content/giftGuideShipping.ts |   if (day <= 20) return SHIP_LINES.late; |   if (day < 20) return SHIP_LINES.late;
 * @mutate src/content/giftGuideShipping.ts |   if (day <= 25) return SHIP_LINES.instant; |   if (day <= 31) return SHIP_LINES.instant;
 * @mutate src/content/giftGuideShipping.ts | timeZone: "America/Chicago" | timeZone: "UTC"
 */
import { describe, expect, it } from "vitest";
import { SHIP_LINES, shippingLine } from "@/content/giftGuideShipping";

describe("gift guides: the shipping banner follows the date in Louisiana", () => {
  // Noon Chicago time is 18:00Z (CST, UTC-6).
  const at = (iso: string) => new Date(iso);
  it("before Dec 15, Dec 15–20, Dec 21–25, then hidden", () => {
    expect(shippingLine(at("2026-11-18T18:00:00Z"))).toBe(SHIP_LINES.early);
    expect(shippingLine(at("2026-12-14T18:00:00Z"))).toBe(SHIP_LINES.early);
    expect(shippingLine(at("2026-12-15T18:00:00Z"))).toBe(SHIP_LINES.late);
    expect(shippingLine(at("2026-12-20T18:00:00Z"))).toBe(SHIP_LINES.late);
    expect(shippingLine(at("2026-12-21T18:00:00Z"))).toBe(SHIP_LINES.instant);
    expect(shippingLine(at("2026-12-25T18:00:00Z"))).toBe(SHIP_LINES.instant);
    expect(shippingLine(at("2026-12-26T18:00:00Z"))).toBeNull();
    expect(shippingLine(at("2026-12-31T18:00:00Z"))).toBeNull();
    expect(shippingLine(at("2027-01-02T18:00:00Z"))).toBe(SHIP_LINES.early);
  });
  it("uses Louisiana's date, not UTC: 11 PM Chicago on Dec 14 is 05:00Z Dec 15", () => {
    expect(shippingLine(at("2026-12-15T05:00:00Z"))).toBe(SHIP_LINES.early);
    expect(shippingLine(at("2026-12-26T05:30:00Z"))).toBe(SHIP_LINES.instant);
  });
  it("the exact owner wording", () => {
    expect(Object.values(SHIP_LINES)).toEqual([
      "Order by Dec 15 for Christmas delivery",
      "Last days for Christmas shipping: choose fast shipping",
      "Last-minute? Gift cards and digital gifts arrive instantly",
    ]);
  });
});
