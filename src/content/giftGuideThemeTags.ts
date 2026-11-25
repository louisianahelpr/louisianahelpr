import { PICK_CHUNKS } from "@/content/giftGuidePicks";
import { tagKey, type KidGender, type KidTags } from "@/content/giftGuideKidsFilter";

/**
 * A themed kids guide's Filter tags (owner 2026-11-24 ~7 PM: "add a filter like the main 3 guides"), loaded on its page
 * only, like For Kids' tag file (never on a guide page's first paint: the /gift-guides/:slug critical-path budget, Q178).
 * Read from the theme's own picks chunk (already in hand on its page): the age in years the import wrote from the
 * research (scripts/giftGuideThemePicks.mjs; none when it states none), and Girls or Boys only where the product's own
 * name says so ("Bluey Girls Holiday Cozy Crew Socks"), else Everyone (never a guess toward one).
 * Guard: src/test/giftGuideThemeLayout1124.test.tsx.
 */
const nameGender = (name: string): KidGender => {
  const girls = /\bgirls?'?\b/i.test(name);
  const boys = /\bboys?'?\b/i.test(name);
  return girls === boys ? "everyone" : girls ? "girls" : "boys";
};

export const tagsFromPicks = (picks: readonly { href: string; name: string; ageMin?: number; ageMax?: number }[]): KidTags =>
  Object.fromEntries(picks.map((p) => [tagKey(p.href), { name: p.name, gender: nameGender(p.name),
    ...(typeof p.ageMin === "number" ? { ageMin: p.ageMin, ...(typeof p.ageMax === "number" ? { ageMax: p.ageMax } : {}) } : {}) }]));

/** The theme's tags, from its picks chunk. */
export const themeTags = async (slug: string): Promise<KidTags> => {
  const chunk = await PICK_CHUNKS[`./giftGuidePicks/${slug}.json`]();
  return tagsFromPicks(chunk.picks);
};
