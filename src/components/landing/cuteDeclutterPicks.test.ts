/**
 * Owner 11-18 on the landing's "Popular on Declutter" grid: "Are they actually popular? Show cuter things like the Vera
 * Bradley bag, lamp, sunglasses pillow cover Basket stockings etc". The titles below are real live prod listings
 * (read-only SQL 11-18): declutter_popular_items(24)'s first eight, then the owner's examples. The grid must lead with
 * the cute ones, never show a test listing, and show the same thing once.
 *
 * @mutate src/components/landing/cuteDeclutterPicks.ts |   kept.sort((a, b) => b.score - a.score \|\| a.rank - b.rank); |   kept.sort((a, b) => a.rank - b.rank);
 * @mutate src/components/landing/cuteDeclutterPicks.ts |     if (isTestListingTitle(row.title)) return; |
 * @mutate src/components/landing/cuteDeclutterPicks.ts |   return /^seed\s*test\b/i.test(t) \|\| /\(\s*test\b[^)]*\)/i.test(t); |   return false;
 * @mutate src/components/landing/cuteDeclutterPicks.ts |     if (seen.has(key)) return; |
 * @mutate src/components/landing/cuteDeclutterPicks.ts |   for (const re of PLAIN) if (re.test(title)) s -= 4; |
 * @mutate src/components/landing/FreshDeclutterSection.tsx |         const ranked = pickCuteFirst(rows); |         const ranked = rows;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { cuteScore, isTestListingTitle, pickCuteFirst } from "./cuteDeclutterPicks";

const POPULAR_TOP = [
  ["Kinetic Sand SquishBlossom Set, 8 oz Box", "toys_games"],
  ["Clear Acrylic Number 8 Stand or Display Piece", "party_events"],
  ["RENEO Wearable Heating Pad for Knee in Box", "health_beauty"],
  ["Colorful Sandwich and Cookie Cutter Set in Package", "kitchen"],
  ["VISTOP 77 Inch Non-Slip Splash Pad for Kids and Dogs", "outdoor_garden"],
  ["Black Curling Iron Set in Box with Cord", "health_beauty"],
  ["Adjustable Hospital Bed with Mattress and Half Side Rails", "furniture"],
  ["Hydraulic Patient Lift with Sling Bar on Wheels", "health_beauty"],
] as const;
const OWNER_EXAMPLES = [
  ["Vera Bradley Style Quilted Duffel Bag, Green and Teal Floral", "jewelry_accessories"],
  ["Table Lamp With Scalloped Shade and Marble and Brass Base", "home_decor"],
  ["Cordless Gold Table Lamp with Striped Shade", "home_decor"],
  ["Polarized Aviator-Style Sunglasses with Brown Lenses", "jewelry_accessories"],
  ["Green Floral Block Print Ruffle Pillow Covers", "bedding_bath"],
  ["Pair of cream knit Christmas stockings with red velvet bows", "holiday_seasonal"],
  ["Large Woven Seagrass and Rope Basket", "home_decor"],
] as const;
const row = ([title, category]: readonly [string, string], i: number) => ({ id: `r${i}`, title, category });

describe("the landing's Declutter grid leads with cute, giftable pieces (owner 11-18)", () => {
  it("every owner example outranks every plain popular item", () => {
    expect(OWNER_EXAMPLES.length).toBeGreaterThan(6);
    const plainBest = Math.max(...POPULAR_TOP.map(([t, c]) => cuteScore(t, c)));
    for (const [t, c] of OWNER_EXAMPLES) expect(cuteScore(t, c), t).toBeGreaterThan(plainBest);
    for (const [t, c] of POPULAR_TOP) expect(cuteScore(t, c), t).toBeLessThanOrEqual(0);
  });

  it("pickCuteFirst puts the cute ones first even when they come last in popular order, keeping popular order within a tier", () => {
    const rows = [...POPULAR_TOP, ...OWNER_EXAMPLES].map(row);
    const out = pickCuteFirst(rows);
    expect(out.length).toBe(rows.length);
    const firstSeven = out.slice(0, OWNER_EXAMPLES.length).map((r) => r.title).sort();
    expect(firstSeven).toEqual(OWNER_EXAMPLES.map(([t]) => t).sort());
    // The plain rows follow, all of them (the plainer, the lower).
    expect(out.slice(OWNER_EXAMPLES.length).map((r) => r.title).sort()).toEqual(POPULAR_TOP.map(([t]) => t).sort());
    // Within one score the popular order holds, whichever way round they come.
    const a = row(["Round basket", "home_decor"], 0);
    const b = row(["Square basket", "home_decor"], 1);
    expect(cuteScore(a.title, a.category)).toBe(cuteScore(b.title, b.category));
    expect(pickCuteFirst([a, b]).map((r) => r.id)).toEqual(["r0", "r1"]);
    expect(pickCuteFirst([b, a]).map((r) => r.id)).toEqual(["r1", "r0"]);
  });

  it("never a test listing, by title, wherever it sits", () => {
    for (const t of ["SEED TEST Woven basket", "SEED TEST Table lamp", "SEED TEST Throw pillows (pair)", "seed test lamp", "Wooden step stool (TEST listing)", "Box of mason jars (TEST free item)"]) {
      expect(isTestListingTitle(t), t).toBe(true);
    }
    for (const [t] of [...OWNER_EXAMPLES, ...POPULAR_TOP]) expect(isTestListingTitle(t), t).toBe(false);
    const rows = [row(["SEED TEST Woven basket", "home_decor"], 0), row(["SEED TEST Table lamp", "home_decor"], 1), ...OWNER_EXAMPLES.map(row)];
    const out = pickCuteFirst(rows);
    expect(out.length).toBe(OWNER_EXAMPLES.length);
    expect(out.some((r) => /seed test/i.test(r.title))).toBe(false);
  });

  it("the same thing listed twice shows once", () => {
    const out = pickCuteFirst([
      row(["Vera Bradley Style Quilted Duffel Bag, Green and Teal", "jewelry_accessories"], 0),
      row(["Vera Bradley Style Quilted Duffel Bag, Green and Teal Floral", "jewelry_accessories"], 1),
      row(["Large Woven Seagrass and Rope Basket", "home_decor"], 2),
    ]);
    expect(out.map((r) => r.id)).toEqual(["r0", "r2"]);
  });

  it("the landing's loader ranks with pickCuteFirst, loaded lazily (not in the landing's page chunk)", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/landing/FreshDeclutterSection.tsx"), "utf8"));
    expect(src).toContain('const { pickCuteFirst } = await import("./cuteDeclutterPicks");');
    expect(src).toContain("const ranked = pickCuteFirst(rows);");
    expect(src).not.toMatch(/^import [^;]+ from "\.\/cuteDeclutterPicks";/m);
  });
});
