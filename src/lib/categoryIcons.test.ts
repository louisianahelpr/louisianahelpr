/**
 * Validates the canonical category-icon map stays in sync with the
 * Postgres `job_category` enum (see `src/integrations/supabase/types.ts`).
 *
 * The enum list is READ FROM the generated `Constants` export, not copied
 * here — add a value to the DB enum, regenerate types, and this file starts
 * demanding an icon for it without anyone remembering to edit a mirror.
 */
import { describe, it, expect } from "vitest";
import { Briefcase, MoreHorizontal } from "lucide-react";

import { Constants } from "@/integrations/supabase/types";

import {
  CATEGORY_ICONS,
  FALLBACK_CATEGORY_ICON,
  getCategoryIcon,
} from "./categoryIcons";

// DERIVED, not hand-listed. `Constants` in the generated types file is a
// runtime value emitted by `supabase gen types` straight from the Postgres
// enum, so adding a `job_category` value in a migration and regenerating
// types makes this list grow on its own — and the coverage test below then
// fails until CATEGORY_ICONS grows with it. The previous version of this file
// duplicated the twelve values by hand with a comment asking the next person
// to "update both together", which is exactly the hand-listed-inventory
// shape that lets a new category render the Briefcase fallback in silence.
const JOB_CATEGORIES = Constants.public.Enums.job_category;

describe("CATEGORY_ICONS — canonical job-category → Lucide icon map", () => {
  it("has a non-empty enum to iterate (inventory floor)", () => {
    // Without this, a `Constants` shape change that emptied the list would
    // make every loop below iterate zero times and pass.
    expect(JOB_CATEGORIES.length).toBeGreaterThanOrEqual(12);
  });

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

// Drops one enum member from the icon map. Because JOB_CATEGORIES is now read
// from the generated `Constants` rather than a hand-typed mirror, the coverage
// test sees the hole instead of skipping it.
// @mutate src/lib/categoryIcons.ts | events: PartyPopper, | events_typo: PartyPopper,
//
// SECOND MUTATION — the one that proves the de-hand-listing mattered. It adds
// a value to the generated `job_category` enum (what regenerating types after
// a migration does) without touching CATEGORY_ICONS. The previous hand-typed
// mirror could not see this at all: it iterated its own twelve strings, so a
// thirteenth category rendered the Briefcase fallback with the suite green.
// @mutate src/integrations/supabase/types.ts |       job_category: [ |       job_category: ["appliance_repair",
