/**
 * Canonical job-category → Lucide icon map.
 *
 * The codebase consensus is Lucide icons (used on JobCard, JobDetailDialog,
 * JobFilters, the PostJob category picker, the landing CategoryBento, and
 * the PhoneCluster mock). Emoji are reserved for per-sample-job decoration
 * in `src/data/sampleJobs.ts` — those are NOT category icons (a single
 * category has multiple different sample-job emojis), so they're left
 * alone.
 *
 * Why this file exists separately from `activityConstants.ts`:
 *   1. It removes the visual-layer dependency on a constants module that
 *      also exports `Application`/`Job` types and color tables — those
 *      lived together because that's where the maps were born, but the
 *      icon mapping is the cross-cutting one that needs to be importable
 *      from anywhere (landing pages, jobs board, post-a-task) without
 *      pulling in a giant constants module.
 *   2. It pairs cleanly with the `CategoryIcon` React component in
 *      `src/components/job/CategoryIcon.tsx` — the component does the
 *      JSX + a11y label work; this module does the data-layer work.
 *
 * `activityConstants.ts` re-exports `categoryIcons` from here so existing
 * importers keep working without churn.
 *
 * Adding a new `job_category` enum value:
 *   1. Add to the Postgres `job_category` enum (migration).
 *   2. Add an entry to CATEGORY_ICONS below.
 *   3. Add a matching entry to `categoryLabels` and `categoryColors` in
 *      `activityConstants.ts` — the existing cross-table test will fail
 *      until you do.
 */
import {
  Sparkles,
  Leaf,
  Truck,
  ShoppingBag,
  Wrench,
  Paintbrush,
  Package,
  PawPrint,
  Hammer,
  MoreHorizontal,
  Briefcase,
  CloudLightning,
  PartyPopper,
  type LucideIcon,
} from "lucide-react";

/**
 * Canonical icon mapping. Keys MUST match the `job_category` Postgres
 * enum exactly (see `src/integrations/supabase/types.ts`).
 *
 * Mapping rationale — picked to be visually distinct at 14px (the smallest
 * surface we render them on, the chip overlay on JobCard's avatar):
 *   cleaning    → Sparkles        (clean / fresh)
 *   yard_work   → Leaf            (foliage, lawn)
 *   moving      → Truck           (transport of bulky items)
 *   errands     → ShoppingBag     (a stop on the errand)
 *   handyman    → Wrench          (general fix-it tool)
 *   painting    → Paintbrush      (the implement, not the can)
 *   delivery    → Package         (parcel)
 *   pet_care    → PawPrint        (paw)
 *   assembly    → Hammer          (build / put together)
 *   storm_prep  → CloudLightning  (storm warning — Louisiana hurricane country)
 *   events      → PartyPopper     (celebration / Mardi Gras / LSU game day)
 *   other       → MoreHorizontal  (catch-all neutral glyph)
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  cleaning: Sparkles,
  yard_work: Leaf,
  moving: Truck,
  errands: ShoppingBag,
  handyman: Wrench,
  painting: Paintbrush,
  delivery: Package,
  pet_care: PawPrint,
  assembly: Hammer,
  storm_prep: CloudLightning,
  events: PartyPopper,
  other: MoreHorizontal,
};

/**
 * Neutral fallback. Used when a category slug is unknown — most often a
 * migration-in-flight where the DB has a new enum value the client
 * doesn't yet know about. `Briefcase` was picked because it's the
 * job-domain neutral; rendering `undefined` crashes the row.
 */
export const FALLBACK_CATEGORY_ICON: LucideIcon = Briefcase;

/**
 * Return the Lucide icon component for a given category slug, or the
 * neutral fallback for unknown values. Callers that want the JSX + a11y
 * label work should reach for the `<CategoryIcon />` component instead.
 *
 * @example
 *   const Icon = getCategoryIcon(job.category);
 *   return <Icon className="w-4 h-4" />;
 */
export function getCategoryIcon(category: string | null | undefined): LucideIcon {
  if (!category) return FALLBACK_CATEGORY_ICON;
  return CATEGORY_ICONS[category] ?? FALLBACK_CATEGORY_ICON;
}
