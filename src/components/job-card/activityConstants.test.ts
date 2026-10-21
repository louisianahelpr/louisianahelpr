// activityConstants is a small lookup module — no logic. Tests
// validate cross-table consistency: a category present in one map
// MUST be present in all of them, otherwise the UI renders a missing
// icon, blank label, or no color (real bugs we've shipped twice
// before).

// @mutate src/components/job-card/activityConstants.ts |   cleaning: ONE_CATEGORY_STYLE, |   cleaning: { badge: "x", title: "y", dot: "bg-[hsl(182_28%_44%)]" },
// @mutate src/lib/categoryHues.ts |   cleaning: ONE_OLIVE, |   cleaning: "182 28% 44%",
import { describe, it, expect } from "vitest";
import {
  categoryIcons,
  categoryLabels,
  categories,
  categoryColors,
  statusBadge,
} from "./activityConstants";
import { categoryHues, categoryHue } from "@/lib/categoryHues";
import { Constants } from "@/integrations/supabase/types";

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

  // Spec v2 §1 (audit #17, 2026-10-21): no per-category colours. Every category wears the one olive, on the
  // cards (badge / title / dot) and the map (categoryHues), so a category is told apart by icon and name only.
  it("every category wears the one olive, on cards and on the map", () => {
    expect(new Set(Object.values(categoryColors).map((c) => `${c.badge}|${c.title}|${c.dot}`)).size).toBe(1);
    expect(categoryColors.cleaning.dot).toBe("bg-primary");
    expect(new Set(Object.values(categoryHues)).size).toBe(1);
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
    // DERIVED from the generated enum. It used to be a hand-written list
    // of seven attributed to the 20260504 state-machine trigger, and it had
    // silently fallen one behind the enum (`pending_approval`) — so "every
    // job status the state machine emits" was a claim about the list, not
    // about the database.
    const required = Constants.public.Enums.job_status;
    // `required` is the readonly enum tuple; statusBadge is keyed by the DB
    // enum, so indexing lines up without a cast. The map being exhaustive is a
    // COMPILE error now — this loop stays as a readable statement of intent
    // and as a guard for anything the type cannot see.
    for (const status of required) {
      expect(statusBadge[status], `${status} missing from statusBadge`).toBeDefined();
    }
  });
});

