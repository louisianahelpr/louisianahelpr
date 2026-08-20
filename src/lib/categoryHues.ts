/**
 * Canonical solid hue per job category, as a bare HSL triplet.
 *
 * WHY THIS FILE EXISTS
 * The app had TWO independent category palettes that had silently drifted:
 *   1. `categoryColors` in `@/components/activity/activityConstants` —
 *      Tailwind arbitrary-value classes (badge / title / dot) used by every
 *      job card, category chip, filter chip and detail dialog.
 *   2. `categoryColors` in `@/components/browseMap/mapMarkers` — a separate
 *      set of hand-picked hex values used ONLY by the map pins.
 *
 * They agreed on nothing. Errands was olive-lime (`hsl(73 32% 40%)`) on every
 * card and warm gold (`#C7A75E`) on the map; painting was magenta on a card
 * and dusty rose on a pin; and the map map was missing `storm_prep` and
 * `events` entirely, so both fell through to the neutral grey fallback. A
 * helper filtering to one category saw one colour in the feed and a different
 * one on the map for the same job.
 *
 * The Tailwind classes can't be generated at runtime (the JIT only sees
 * static class strings), so the two representations have to be written out
 * separately. This module is the single source of the HUE, and
 * `activityConstants.test.ts` asserts each `categoryColors[k].dot` is exactly
 * `bg-[hsl(<triplet with _ separators>)]` — so the two can never drift again
 * without a red test.
 *
 * Adding a category: add it here, to `categoryLabels` + `categoryColors` in
 * activityConstants, and to `categoryIcons`. The tests enforce all three.
 */
export const categoryHues: Record<string, string> = {
  cleaning: "182 28% 44%",
  yard_work: "142 30% 40%",
  moving: "34 44% 47%",
  errands: "73 32% 40%",
  handyman: "19 46% 49%",
  painting: "330 40% 56%",
  delivery: "214 30% 51%",
  pet_care: "278 24% 57%",
  assembly: "6 42% 53%",
  storm_prep: "210 30% 47%",
  events: "43 46% 46%",
  other: "40 10% 55%",
};

/**
 * Paintable CSS colour for a category. Unknown categories fall back to
 * `other` rather than a hard-coded grey, so a category added to the DB
 * before the client knows about it still paints from the same palette.
 */
export function categoryHue(category: string | null | undefined): string {
  return `hsl(${categoryHues[category ?? ""] ?? categoryHues.other})`;
}
