// activityConstants is a small lookup module — no logic. Tests
// validate cross-table consistency: a category present in one map
// MUST be present in all of them, otherwise the UI renders a missing
// icon, blank label, or no color (real bugs we've shipped twice
// before).

import { describe, it, expect } from "vitest";
import {
  categoryIcons,
  categoryLabels,
  categories,
  categoryColors,
  statusBadge,
} from "./activityConstants";
import { categoryHues, categoryHue } from "@/lib/categoryHues";

describe("category lookup tables — cross-table consistency", () => {
  it("every key in categoryIcons exists in categoryLabels", () => {
    for (const key of Object.keys(categoryIcons)) {
      expect(categoryLabels[key], `${key} missing from categoryLabels`).toBeDefined();
    }
  });

  it("every key in categoryLabels exists in categoryIcons", () => {
    for (const key of Object.keys(categoryLabels)) {
      expect(categoryIcons[key], `${key} missing from categoryIcons`).toBeDefined();
    }
  });

  it("every key in categoryLabels exists in categoryColors", () => {
    for (const key of Object.keys(categoryLabels)) {
      expect(categoryColors[key], `${key} missing from categoryColors`).toBeDefined();
    }
  });

  it("every category has all 3 color variants (badge, title, dot)", () => {
    for (const [key, color] of Object.entries(categoryColors)) {
      expect(color.badge, `${key}.badge missing`).toBeTruthy();
      expect(color.title, `${key}.title missing`).toBeTruthy();
      expect(color.dot, `${key}.dot missing`).toBeTruthy();
    }
  });

  // The map pins paint from `categoryHues` (a runtime HSL triplet) while
  // every card/chip paints from the Tailwind classes here. Tailwind's JIT
  // only sees static class strings, so the two representations have to be
  // written out separately — which is exactly how they drifted apart before
  // (errands was olive-lime on a card and gold on the map; storm_prep and
  // events had no map colour at all). These two tests are the tripwire.
  it("categoryHues covers exactly the same categories as categoryLabels", () => {
    expect(Object.keys(categoryHues).sort()).toEqual(Object.keys(categoryLabels).sort());
  });

  it("every categoryColors.dot is the categoryHues triplet for that category", () => {
    for (const [key, color] of Object.entries(categoryColors)) {
      // Tailwind arbitrary values use `_` where CSS uses a space.
      const expected = `bg-[hsl(${categoryHues[key].replace(/ /g, "_")})]`;
      expect(color.dot, `${key}.dot drifted from categoryHues`).toBe(expected);
    }
  });

  it("categoryHue falls back to 'other' for an unknown category", () => {
    expect(categoryHue("not_a_category")).toBe(categoryHue("other"));
    expect(categoryHue(null)).toBe(categoryHue("other"));
  });

  it("includes 'other' as the catch-all category — fallback for missing/unknown values", () => {
    expect(categoryIcons.other).toBeDefined();
    expect(categoryLabels.other).toBe("Other");
    expect(categoryColors.other).toBeDefined();
  });
});

describe("categories array (derived from categoryLabels)", () => {
  it("matches categoryLabels in count + values", () => {
    expect(categories).toHaveLength(Object.keys(categoryLabels).length);
    for (const { value, label } of categories) {
      expect(categoryLabels[value]).toBe(label);
    }
  });
});

describe("statusBadge", () => {
  it("includes every job status the state machine emits", () => {
    // From the BEFORE UPDATE OF status state-machine trigger (migrations
    // 20260504*), the canonical job statuses are:
    const required = [
      "open",
      "accepted",
      "in_progress",
      "revision_requested",
      "completed",
      "cancelled",
      "disputed",
    ];
    for (const status of required) {
      expect(statusBadge[status], `${status} missing from statusBadge`).toBeDefined();
    }
  });
});
