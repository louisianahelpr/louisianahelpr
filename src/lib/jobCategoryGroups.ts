import { JOB_CATEGORY_LABELS, type JobCategory } from "./jobCategories";

/**
 * Post a Job step 1 (board 23): the category GROUPS a poster opens to find
 * the category they need. Presentation only; the stored value is still the
 * `job_category` enum value.
 *
 * Typed as a Record over the generated enum, so a new category (the mobile
 * services lane, a new trade) fails typecheck HERE until someone places it in
 * a group. It can never silently vanish from the picker.
 *
 * Board 23 also draws "Beauty and self-care"; no job category belongs to it
 * today, so that group is not listed (truth rule: no empty group). It joins
 * when its categories exist in the enum. "Trades" is not called "licensed":
 * welding and auto have no Louisiana trade license (detailsSectionConstants).
 */
export type JobCategoryGroupId =
  | "home"
  | "yard"
  | "moving_errands"
  | "auto"
  | "pets"
  | "events"
  | "trades"
  | "other";

const GROUP_OF: Record<JobCategory, JobCategoryGroupId> = {
  cleaning: "home",
  handyman: "home",
  assembly: "home",
  painting: "home",
  pressure_washing: "home",
  declutter_help: "home",
  storm_prep: "home",
  yard_work: "yard",
  moving: "moving_errands",
  errands: "moving_errands",
  delivery: "moving_errands",
  auto_repair: "auto",
  pet_care: "pets",
  events: "events",
  electrical: "trades",
  plumbing: "trades",
  hvac: "trades",
  roofing: "trades",
  welding: "trades",
  carpentry: "trades",
  flooring: "trades",
  concrete_masonry: "trades",
  fencing: "trades",
  appliance_repair: "trades",
  other: "other",
};

const GROUP_LABELS: Record<JobCategoryGroupId, string> = {
  home: "Home",
  yard: "Yard",
  moving_errands: "Moving and errands",
  auto: "Auto",
  pets: "Pets",
  events: "Events",
  trades: "Trades",
  other: "Something else",
};

const GROUP_ORDER: JobCategoryGroupId[] = ["home", "yard", "moving_errands", "auto", "pets", "events", "trades", "other"];

interface JobCategoryGroup {
  id: JobCategoryGroupId;
  label: string;
  items: { value: JobCategory; label: string }[];
}

/** Groups in board order, each with its categories in the canonical order. */
export const JOB_CATEGORY_GROUPS: JobCategoryGroup[] = GROUP_ORDER.map((id) => ({
  id,
  label: GROUP_LABELS[id],
  items: (Object.keys(JOB_CATEGORY_LABELS) as JobCategory[])
    .filter((v) => GROUP_OF[v] === id)
    .map((value) => ({ value, label: JOB_CATEGORY_LABELS[value] })),
})).filter((g) => g.items.length > 0);

/** The group a category sits in, or null for a value outside the enum. */
export function jobCategoryGroupOf(value: string): JobCategoryGroupId | null {
  return GROUP_OF[value as JobCategory] ?? null;
}
