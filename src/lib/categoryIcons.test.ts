/**
 * Validates the canonical category-icon map stays in sync with the
 * Postgres `job_category` enum (see `src/integrations/supabase/types.ts`).
 *
 * If you add or rename an enum value, update the JOB_CATEGORIES list
 * below — this test will then guide you to also update CATEGORY_ICONS.
 */
import { describe, it, expect } from "vitest";
import { Briefcase, MoreHorizontal } from "lucide-react";

import {
  CATEGORY_ICONS,
  FALLBACK_CATEGORY_ICON,
  getCategoryIcon,
} from "./categoryIcons";

// Mirror of the `job_category` enum in
// `src/integrations/supabase/types.ts`. The reason we duplicate the list
// rather than reflect it from the generated types file is that the
// generated types are a long union (not an iterable runtime value), so
// there's nothing to iterate at test time. Update both together.
const JOB_CATEGORIES = [
  "cleaning",
  "yard_work",
  "moving",
  "errands",
  "handyman",
  "painting",
  "delivery",
  "pet_care",
  "assembly",
  "storm_prep",
  "events",
  "other",
] as const;

describe("CATEGORY_ICONS — canonical job-category → Lucide icon map", () => {
  it("maps every job_category enum value to a defined Lucide icon", () => {
    for (const category of JOB_CATEGORIES) {
      const icon = CATEGORY_ICONS[category];
      expect(icon, `${category} missing from CATEGORY_ICONS`).toBeDefined();
    }
  });

  it("has no extra keys beyond the job_category enum (drift guard)", () => {
    const enumSet = new Set<string>(JOB_CATEGORIES);
    for (const key of Object.keys(CATEGORY_ICONS)) {
      expect(
        enumSet.has(key),
        `${key} is in CATEGORY_ICONS but not in job_category enum`
      ).toBe(true);
    }
  });

  it("uses distinct icon components per category — no two share a glyph", () => {
    const seen = new Map<string, string>();
    for (const [category, Icon] of Object.entries(CATEGORY_ICONS)) {
      // displayName is the Lucide-set identifier (e.g. "Sparkles")
      const name = (Icon as { displayName?: string }).displayName ?? Icon.name;
      const prior = seen.get(name);
      expect(
        prior,
        `${category} and ${prior} both map to the same icon (${name})`
      ).toBeUndefined();
      seen.set(name, category);
    }
  });
});

describe("getCategoryIcon — fallback behavior", () => {
  it("returns the mapped icon for known categories", () => {
    // Spot-check three categories so we don't repeat the enum list.
    expect(getCategoryIcon("cleaning")).toBe(CATEGORY_ICONS.cleaning);
    expect(getCategoryIcon("yard_work")).toBe(CATEGORY_ICONS.yard_work);
    expect(getCategoryIcon("other")).toBe(CATEGORY_ICONS.other);
  });

  it("returns Briefcase fallback for unknown slugs", () => {
    expect(getCategoryIcon("not_a_real_category")).toBe(Briefcase);
    expect(getCategoryIcon("")).toBe(Briefcase);
    expect(FALLBACK_CATEGORY_ICON).toBe(Briefcase);
  });

  it("returns Briefcase fallback for null / undefined", () => {
    expect(getCategoryIcon(null)).toBe(Briefcase);
    expect(getCategoryIcon(undefined)).toBe(Briefcase);
  });

  it("'other' maps to MoreHorizontal — the catch-all enum value (distinct from the unknown-slug fallback)", () => {
    // The "other" enum value is a real category posters can pick; the
    // unknown-slug fallback (Briefcase) is for migration-in-flight / bad
    // data. These two intentionally differ.
    expect(getCategoryIcon("other")).toBe(MoreHorizontal);
    expect(getCategoryIcon("other")).not.toBe(Briefcase);
  });
});
