import type { Database } from "@/integrations/supabase/types";

/**
 * THE canonical job-category table: value → label → display order.
 *
 * Every surface that lists or labels a category (post-a-job picker, browse
 * filter chips, the map popup, admin, saved searches) reads from here. It
 * used to be four hand-maintained copies, which had drifted three ways:
 * different order, `storm_prep` rendering as "Storm prep" when filtering but
 * "Storm" when posting, and the browse filter offering categories the poster
 * couldn't select.
 *
 * ORDER is the post-a-job popularity order (most-requested first, "Other"
 * last as the escape hatch) — deliberate, and now shared everywhere.
 *
 * VALUES are the `job_category` Postgres enum and are fixed; this is a
 * presentation-layer table only. `JobCategory` is typed off the generated
 * enum so adding/removing a DB value fails the build here first.
 */
export type JobCategory = Database["public"]["Enums"]["job_category"];

export const JOB_CATEGORY_LABELS: Record<JobCategory, string> = {
  cleaning: "Cleaning",
  yard_work: "Yard Work",
  handyman: "Handyman",
  moving: "Moving",
  errands: "Errands",
  delivery: "Delivery",
  pet_care: "Pet Care",
  assembly: "Assembly",
  painting: "Painting",
  storm_prep: "Storm Prep",
  events: "Events",
  other: "Other",
};

/** Canonical ordered value list. */
export const JOB_CATEGORY_VALUES = Object.keys(JOB_CATEGORY_LABELS) as JobCategory[];

/** Canonical ordered `{ value, label }` list for pickers and chip rows. */
export const JOB_CATEGORIES: ReadonlyArray<{ value: JobCategory; label: string }> =
  JOB_CATEGORY_VALUES.map((value) => ({ value, label: JOB_CATEGORY_LABELS[value] }));

/** Label for a category value, falling back to the raw value. */
export function jobCategoryLabel(value: string): string {
  return JOB_CATEGORY_LABELS[value as JobCategory] ?? value;
}
