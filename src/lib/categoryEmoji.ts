import type { JobCategory } from "./jobCategories";
import type { JobCategoryGroupId } from "./jobCategoryGroups";

/**
 * The emoji the Post a Job start screens draw (owner 2026-10-21: "she prefers the EMOJI icons from the
 * mock", ~/Desktop/helpr-postjob-flow-mockup.png). ONE map, so a category has exactly one emoji on
 * every start screen. Decorative: always rendered aria-hidden; the label is the accessible name.
 *
 * Typed as a Record over the generated enum, so a new category fails typecheck here until it gets one.
 */
export const CATEGORY_EMOJI: Record<JobCategory, string> = {
  cleaning: "🧹",
  handyman: "🛠️",
  assembly: "🔩",
  painting: "🎨",
  pressure_washing: "💦",
  declutter_help: "🗂️",
  storm_prep: "🌀",
  yard_work: "🌿",
  moving: "📦",
  errands: "🛍️",
  delivery: "🚚",
  auto_repair: "🚗",
  pet_care: "🐾",
  events: "🎉",
  electrical: "⚡",
  plumbing: "🚰",
  hvac: "❄️",
  roofing: "🏠",
  welding: "🔥",
  carpentry: "🪚",
  flooring: "🪵",
  concrete_masonry: "🧱",
  fencing: "🚧",
  appliance_repair: "🧺",
  other: "💬",
};

/** The 8 groups on screen 1 (mock-up order and glyphs). */
export const GROUP_EMOJI: Record<JobCategoryGroupId, string> = {
  home: "🏠",
  yard: "🌿",
  moving_errands: "📦",
  auto: "🚗",
  pets: "🐾",
  events: "🎉",
  trades: "🔧",
  other: "💬",
};

/** Step 0's four ways to start. */
export const START_EMOJI = { fresh: "✏️", templates: "📋", offer: "🤝", ai: "✨" } as const;

/** The emoji for a stored category value; "💬" (Other) for a value outside the enum. */
export function categoryEmoji(value: string): string {
  return CATEGORY_EMOJI[value as JobCategory] ?? CATEGORY_EMOJI.other;
}
