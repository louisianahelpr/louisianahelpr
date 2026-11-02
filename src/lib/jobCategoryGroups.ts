import { JOB_CATEGORY_LABELS, skillChipLabel, type JobCategory } from "./jobCategories";

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

/**
 * Each group's one short line on its Post a job tile: two or three examples of what it holds (owner,
 * 2026-10-27: the grid "needs better organization"; every tile now has the same icon, title, examples).
 * A group of several categories names three of its own categories; a one-category group names kinds of work in
 * that category, from the words the title auto-pick already maps to it (categoryFromTitle: mow, leaves,
 * hedge -> yard_work; mechanic, small engine -> auto_repair; walk, sitter, feed -> pet_care).
 * At most GROUP_EXAMPLES_MAX characters, so it never wraps past two lines on a 375 phone tile.
 * Guard: src/test/postJobCategoryGridOrderly.test.tsx.
 */
export const GROUP_EXAMPLES_MAX = 28;
const GROUP_EXAMPLES: Record<JobCategoryGroupId, string> = {
  home: "Cleaning, handyman, painting",
  yard: "Mowing, leaves, hedges",
  moving_errands: "Moving, errands, delivery",
  auto: "Car repair, small engines",
  pets: "Walking, sitting, feeding",
  events: "Setup, serving, cleanup",
  trades: "Electrical, plumbing, HVAC",
  other: "Anything not listed",
};

interface JobCategoryGroup {
  id: JobCategoryGroupId;
  label: string;
  /** The tile's one short line of examples (GROUP_EXAMPLES). */
  examples: string;
  items: { value: JobCategory; label: string }[];
}

/** Groups in board order, each with its categories in the canonical order. */
export const JOB_CATEGORY_GROUPS: JobCategoryGroup[] = GROUP_ORDER.map((id) => ({
  id,
  label: GROUP_LABELS[id],
  examples: GROUP_EXAMPLES[id],
  items: (Object.keys(JOB_CATEGORY_LABELS) as JobCategory[])
    .filter((v) => GROUP_OF[v] === id)
    .map((value) => ({ value, label: sentenceCaseLabel(JOB_CATEGORY_LABELS[value]) })),
})).filter((g) => g.items.length > 0);

/** The group a category sits in, or null for a value outside the enum. */
export function jobCategoryGroupOf(value: string): JobCategoryGroupId | null {
  return GROUP_OF[value as JobCategory] ?? null;
}

/** Is this browse filter value one of the 8 group ids? */
export function isJobCategoryGroupId(value: string | null | undefined): value is JobCategoryGroupId {
  return !!value && (GROUP_ORDER as string[]).includes(value);
}

/**
 * THE BROWSE CATEGORY FILTER (owner 2026-10-21: "the group a poster picks is
 * the group a Helpr filters by"). The filter sheet offers the 8 groups above,
 * the same list Post a job opens on; the value it stores (`?cat=`, saved
 * searches) is the group id. A value from before the groups (an old `?cat=`
 * link, a saved search holding one category) still means that one category.
 *
 * "events" and "other" are both a group id and a category value; each of
 * those groups holds exactly that one category, so either reading is the same.
 * The saved-search alert trigger reads the same rule server-side
 * (public.job_category_group, migration 20261021*_saved_search_alerts_by_group).
 */
export function categoriesForFilter(value: string): string[] {
  if (isJobCategoryGroupId(value)) {
    return (Object.keys(GROUP_OF) as JobCategory[]).filter((c) => GROUP_OF[c] === value);
  }
  return [value];
}

/** Does a job of `category` pass the browse category filter `value` (null = no filter)? */
export function categoryFilterMatches(value: string | null, category: string | null | undefined): boolean {
  if (!value) return true;
  if (!category) return false;
  return categoriesForFilter(value).includes(category);
}

/** The words for a filter value: the group's label, or the one category's sentence-case label. */
export function categoryFilterLabel(value: string): string {
  if (isJobCategoryGroupId(value)) return GROUP_LABELS[value];
  const label = JOB_CATEGORY_LABELS[value as JobCategory];
  return label ? sentenceCaseLabel(label) : value;
}

/**
 * A stored Title Case label in sentence case for the UI (spec §2: "Pressure
 * washing", "Auto & small engine"). Acronyms written in capitals stay ("HVAC").
 */
export function sentenceCaseLabel(label: string): string {
  return label
    .split(" ")
    .map((w, i) => (i === 0 || (w.length > 1 && w === w.toUpperCase()) ? w : w.toLowerCase()))
    .join(" ");
}

/**
 * A group's name where it labels a tile or a heading: the group label, shortened where it wraps at 375
 * ("Moving & errands"; lead 2026-10-21, the mock-up's own wording). Post a job's group tiles and Edit
 * profile's "I can help with" headings read it, so the two say the same words.
 */
const GROUP_TILE_LABEL: Partial<Record<JobCategoryGroupId, string>> = { moving_errands: "Moving & errands" };

export function groupTileLabel(g: { id: JobCategoryGroupId; label: string }): string {
  return GROUP_TILE_LABEL[g.id] ?? g.label;
}

/**
 * EDIT PROFILE'S "I CAN HELP WITH", GROUPED (owner, 2026-10-27: it "should be the same top categories from
 * the job posting"): the same groups, in the same order, as Post a job (JOB_CATEGORY_GROUPS), each with its
 * categories as skill chips. A chip's words are skillChipLabel's, unchanged: they are what is SAVED in
 * profiles.skills and what job matching reads ("Moving help", "Event help"). "Other" is not a chip: it is
 * the free-text field, shown under "Something else". Guard: src/test/profileSkillsGrouped.test.tsx.
 */
export interface SkillGroup {
  id: JobCategoryGroupId;
  label: string;
  skills: { value: JobCategory; label: string }[];
}
export const SKILL_GROUPS: SkillGroup[] = JOB_CATEGORY_GROUPS.map((g) => ({
  id: g.id,
  label: groupTileLabel(g),
  skills: g.items.filter((it) => it.value !== "other").map((it) => ({ value: it.value, label: skillChipLabel(it.value) })),
}));
