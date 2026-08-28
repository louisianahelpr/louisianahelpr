/**
 * CategoryIcon — single source of truth for rendering the per-category
 * Lucide glyph that appears on JobCard, JobDetailDialog, JobFilters,
 * and the PostJob category picker.
 *
 * The icon mapping itself lives in `src/lib/categoryIcons.ts` (the
 * canonical map) so non-activity surfaces (landing pages, marketing
 * mockups) can reuse it without dragging in the activity constants
 * module. This component centralizes:
 *   1. The fallback path — every consumer was duplicating
 *      `categoryIcons[job.category] ?? categoryIcons.other`. Forgetting
 *      the fallback rendered `undefined` and crashed the row.
 *   2. The accessible label — readers had no idea what the small icon
 *      glyph represented. We attach `aria-label={categoryLabels[c]}` so
 *      assistive tech announces "Cleaning" instead of an unnamed SVG.
 *   3. A typed `JobCategory` union derived from the canonical labels
 *      map, so TS now catches typos (e.g. `"yardwork"` vs `"yard_work"`).
 */
import type { LucideProps } from "lucide-react";

import { categoryLabels } from "@/components/activity/activityConstants";
import { getCategoryIcon } from "@/lib/categoryIcons";

/**
 * Canonical job-category union — re-exported from `@/lib/jobCategories`,
 * which types it off the GENERATED Postgres enum
 * (`Database["public"]["Enums"]["job_category"]`).
 *
 * This file used to declare its own hand-typed literal union, with a comment
 * claiming it was "derived from categoryLabels keys" and that a
 * `keyof typeof` extraction "keeps it honest". No such extraction existed —
 * it was a frozen list, and it had drifted: the database has 12 categories,
 * the list had 10, missing `storm_prep` and `events`. Both are live category
 * values, so this union was rejecting valid data.
 *
 * Re-exported rather than deleted so existing importers keep working; there
 * is now exactly one definition, and it cannot drift from the database
 * because it is generated from it.
 */
export type { JobCategory } from "@/lib/jobCategories";
import type { JobCategory } from "@/lib/jobCategories";

export interface CategoryIconProps extends Omit<LucideProps, "ref"> {
  /**
   * Category slug. Accepts `string` so callers passing a raw
   * `job.category` from Supabase (typed as `string` by the generator)
   * compile without a cast — but the fallback to `Briefcase` handles
   * unknown values defensively.
   */
  category: JobCategory | string;
}

/**
 * Render the Lucide icon mapped to a job category. Falls back to a
 * neutral Briefcase glyph for any unknown slug so a stray category from
 * the DB (e.g. a migration in-flight) never crashes the row.
 */
export function CategoryIcon({
  category,
  "aria-label": ariaLabel,
  ...iconProps
}: CategoryIconProps) {
  const Icon = getCategoryIcon(category);
  // Prefer an explicit caller label, fall back to the canonical English
  // label, then to the raw slug. Decorative-only usage (where the label
  // sits next to the icon) should pass `aria-hidden` and we'll drop the
  // label entirely.
  const hidden =
    iconProps["aria-hidden"] === true || iconProps["aria-hidden"] === "true";
  const accessibleLabel = hidden
    ? undefined
    : ariaLabel ?? categoryLabels[category] ?? category;
  return (
    <Icon
      {...iconProps}
      aria-label={accessibleLabel}
      role={accessibleLabel ? "img" : undefined}
    />
  );
}
