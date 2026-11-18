/**
 * JOB CATEGORY TINTS (owner 2026-11-17, signed-in tweaks item 5): every job row's category tile was the same grey-olive
 * square with a big line icon. The tile is now smaller and each category wears ONE soft tint from a small palette
 * (a light background, a darker icon of the same hue), the same tint for that category everywhere. The colours are CSS
 * tokens (--cat-tint-<name>-bg / -fg in src/index.css, light and dark), so the theme switch needs no JS, and each
 * pair passes contrast in both themes (guard: src/test/jobCategoryTints.test.ts).
 *
 * Plain .mjs so the pre-boot Browse shell (src/lib/browseShellCards.mjs) paints the very same tile as the real card.
 * This is the tile only: the category LABEL keeps the one olive (activityConstants' ONE_CATEGORY_STYLE).
 */

/** The palette, in the order the tokens are declared. */
export const JOB_CATEGORY_TINT_NAMES = ["sage", "sky", "amber", "rose", "violet", "teal", "stone"];

/** Each job category's tint; a category not listed (a new enum value) wears "stone". */
export const JOB_CATEGORY_TINT = {
  yard_work: "sage",
  storm_prep: "sage",
  fencing: "sage",
  cleaning: "sky",
  pressure_washing: "sky",
  plumbing: "sky",
  handyman: "amber",
  carpentry: "amber",
  assembly: "amber",
  flooring: "amber",
  roofing: "amber",
  welding: "amber",
  concrete_masonry: "amber",
  pet_care: "rose",
  events: "rose",
  errands: "rose",
  painting: "violet",
  electrical: "violet",
  hvac: "violet",
  appliance_repair: "violet",
  moving: "teal",
  delivery: "teal",
  auto_repair: "teal",
  declutter_help: "teal",
  other: "stone",
};

/** The tint name for a category ("stone" for anything unknown). */
export function jobCategoryTintName(category) {
  return Object.prototype.hasOwnProperty.call(JOB_CATEGORY_TINT, category) ? JOB_CATEGORY_TINT[category] : "stone";
}

/** The tile's background and its icon colour, as CSS values over the theme tokens. */
export function jobCategoryTint(category) {
  const name = jobCategoryTintName(category);
  return { background: `hsl(var(--cat-tint-${name}-bg))`, color: `hsl(var(--cat-tint-${name}-fg))` };
}
