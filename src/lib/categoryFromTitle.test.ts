// Trade categories (owner decision T1, 2026-10-14): a title that names a trade
// pre-picks that trade, and the words that only name an OBJECT keep their old
// category (moving a fridge is moving, mopping a floor is cleaning, painting a
// fence is painting). First match wins, so the trade block sits first; these
// cases pin both halves of that ordering.
import { describe, it, expect } from "vitest";
import { categoryFromTitle } from "@/lib/categoryFromTitle";
import { JOB_CATEGORY_VALUES } from "@/lib/jobCategories";

const TRADE_TITLES: Array<[string, string]> = [
  ["Pressure wash my driveway", "pressure_washing"],
  ["Power washing the back porch", "pressure_washing"],
  ["Need an electrician for 2 outlets", "electrical"],
  ["Rewire a ceiling light", "electrical"],
  ["Plumber for a running toilet", "plumbing"],
  ["Fix leaky faucet", "plumbing"],
  ["Water heater not heating", "plumbing"],
  ["AC unit not cooling", "hvac"],
  ["Furnace tune-up", "hvac"],
  ["Roof leak over the kitchen", "roofing"],
  ["Replace missing shingles", "roofing"],
  ["Weld a broken trailer hitch", "welding"],
  ["Carpenter for door trim", "carpentry"],
  ["Hang kitchen cabinets", "carpentry"],
  ["Oil change in my driveway", "auto_repair"],
  ["Small engine tune-up", "auto_repair"],
  ["Lawn mower repair", "auto_repair"],
  ["Fix my dishwasher", "appliance_repair"],
  ["Dryer repair, no heat", "appliance_repair"],
  ["Install vinyl plank flooring", "flooring"],
  ["Lay tile in the bathroom", "flooring"],
  ["Pour a concrete pad", "concrete_masonry"],
  ["Brick wall repair", "concrete_masonry"],
  ["Fencing for the backyard", "fencing"],
  ["Repair a wood fence", "fencing"],
];

// Words that look like a trade object but are not trade work. Each must keep
// the category it had before the trade block existed.
const NOT_TRADES: Array<[string, string]> = [
  ["Move a fridge upstairs", "moving"],
  ["Mop the kitchen floor", "cleaning"],
  ["Paint the fence", "painting"],
  ["Clean the oven", "cleaning"],
  ["Mount a TV and hide the cables", "handyman"],
  ["Board up windows before the storm", "storm_prep"],
  ["Mow & edge the front yard", "yard_work"],
];

describe("categoryFromTitle: trade categories", () => {
  it.each(TRADE_TITLES)("%s -> %s", (title, expected) => {
    expect(categoryFromTitle(title)).toBe(expected);
  });

  it.each(NOT_TRADES)("%s stays %s", (title, expected) => {
    expect(categoryFromTitle(title)).toBe(expected);
  });

  it("every category the matcher can return is a real job_category value", () => {
    const all = [...TRADE_TITLES, ...NOT_TRADES].map(([t]) => categoryFromTitle(t));
    for (const c of all) expect(JOB_CATEGORY_VALUES as readonly string[]).toContain(c);
  });

  it("covers every trade category added in T1", () => {
    const trades = [
      "electrical", "plumbing", "hvac", "roofing", "welding", "carpentry", "auto_repair",
      "appliance_repair", "flooring", "concrete_masonry", "fencing", "pressure_washing",
    ];
    const hit = new Set(TRADE_TITLES.map(([, c]) => c));
    expect(trades.filter((t) => !hit.has(t))).toEqual([]);
    expect(trades.length).toBeGreaterThan(11);
  });
});

// A trade word that falls to the generic bucket: "Water heater not heating"
// would pre-pick Handyman instead of Plumbing.
// @mutate src/lib/categoryFromTitle.ts | water\s*heater\|unclog\|clogged)\b/i, "plumbing"], | water\s*heater\|unclog\|clogged)\b/i, "handyman"],
// The "repair <appliance>" pattern is what keeps "Fix my dishwasher" out of Handyman.
// @mutate src/lib/categoryFromTitle.ts | microwave)\b/i, "appliance_repair"], | microwave)\b/i, "handyman"],
