// pricingGuide is a small lookup table used by PostJob's budget input
// to suggest sane starting amounts per category. Tests guard against
// drift from the canonical category list (categoryLabels in
// activityConstants) and against impossible ranges (min > max).

import { describe, it, expect } from "vitest";
import { categoryPricing, getSmartPrice } from "./pricingGuide";
import { categoryLabels } from "@/components/job-card/activityConstants";

describe("categoryPricing data validation", () => {
  it("includes a price entry for every category in categoryLabels", () => {
    for (const key of Object.keys(categoryLabels)) {
      expect(categoryPricing[key], `${key} missing from categoryPricing`).toBeDefined();
    }
  });

  it("does NOT have orphan price entries (every key in categoryPricing exists in categoryLabels)", () => {
    for (const key of Object.keys(categoryPricing)) {
      expect(categoryLabels[key], `${key} in categoryPricing but not in categoryLabels`).toBeDefined();
    }
  });

  it("every range has min <= max (catches typos like 80/40 swapped)", () => {
    for (const [key, range] of Object.entries(categoryPricing)) {
      expect(range.min, `${key}: min must be <= max`).toBeLessThanOrEqual(range.max);
    }
  });

  it("every min is positive (no zero or negative budgets suggested)", () => {
    for (const [key, range] of Object.entries(categoryPricing)) {
      expect(range.min, `${key}: min must be > 0`).toBeGreaterThan(0);
    }
  });

  it("range labels match the canonical categoryLabels", () => {
    for (const [key, range] of Object.entries(categoryPricing)) {
      expect(range.label).toBe(categoryLabels[key]);
    }
  });
});

/**
 * Everything above grades the TABLE. The thing that spends the table is
 * `getSmartPrice`, and it had no test: it is what Smart Price mode writes into
 * the budget field on PostJob, so its answer is the number a poster is charged
 * and a helpr is paid unless they overtype it. A midpoint quietly becoming a
 * min or a max moves every Smart Price job by tens of dollars in one direction
 * and nothing in this file — or anywhere else — would have said so.
 */
describe("getSmartPrice — the number Smart Price puts in the budget field", () => {
  it("is the MIDPOINT of the band, rounded to the nearest $5", () => {
    expect(getSmartPrice("cleaning")).toBe(55); // (25 + 80) / 2 = 52.5 → 55
    expect(getSmartPrice("moving")).toBe(125); // (50 + 200) / 2 = 125
    expect(getSmartPrice("storm_prep")).toBe(215); // (80 + 350) / 2 = 215
    expect(getSmartPrice("errands")).toBe(35); // (15 + 50) / 2 = 32.5 → 35
  });

  it("is strictly inside the band for every category — never the floor, never the ceiling", () => {
    const keys = Object.keys(categoryPricing);
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      const suggested = getSmartPrice(key);
      const { min, max } = categoryPricing[key];
      expect(suggested, `${key}`).not.toBeNull();
      expect(suggested!, `${key}: suggested ${suggested} is at or below the band floor ${min}`).toBeGreaterThan(min);
      expect(suggested!, `${key}: suggested ${suggested} is at or above the band ceiling ${max}`).toBeLessThan(max);
    }
  });

  it("lands on a $5 step, so the field never prefills an odd amount", () => {
    for (const key of Object.keys(categoryPricing)) {
      expect(getSmartPrice(key)! % 5, `${key}`).toBe(0);
    }
  });

  it("returns null for an unknown category instead of a number", () => {
    // PostJob falls back to leaving the field alone. A 0 or a NaN here would
    // prefill a budget nobody chose.
    expect(getSmartPrice("not_a_category")).toBeNull();
    expect(getSmartPrice("")).toBeNull();
  });
});

// The money line: Smart Price must suggest the MIDDLE of the market band. Quote
// the floor and every Smart Price poster underpays their helpr by up to $135
// (storm_prep 215 → 80); quote the ceiling and they overpay by as much.
// @mutate src/lib/pricingGuide.ts | Math.round(((pricing.min + pricing.max) / 2) / 5) * 5 | Math.round(pricing.min / 5) * 5
// An unknown category must not prefill anything.
// @mutate src/lib/pricingGuide.ts | if (!pricing) return null; | if (!pricing) return 0;
