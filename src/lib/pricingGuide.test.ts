// pricingGuide is a small lookup table used by PostJob's budget input
// to suggest sane starting amounts per category. Tests guard against
// drift from the canonical category list (categoryLabels in
// activityConstants) and against impossible ranges (min > max).

import { describe, it, expect } from "vitest";
import { categoryPricing } from "./pricingGuide";
import { categoryLabels } from "@/components/activity/activityConstants";

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
