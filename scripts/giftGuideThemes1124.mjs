/**
 * THE THEMED KIDS GIFT GUIDES, /gift-guides/<slug> (owner 2026-11-24: Monster Jam first, then "Marvel, Bluey, KPop Demon
 * Hunters, Pokémon, Minecraft, Hot Wheels, Paw Patrol, Stitch/Disney, Sonic, Mario, Barbie, Gabby's Dollhouse,
 * Squishmallows, LEGO", each built exactly like Monster Jam). Each theme's rows live in
 * scripts/gift-guide-themes/<slug>.json (registry: scripts/gift-guide-themes/index.mjs), written from the research lane's
 * folder by `node scripts/theme-guide-import.mjs <slug> "<Theme name>" <research folder>`: every item found, each link
 * and price read on the research day. Out-of-stock items, items with no price and items with no photo are left out
 * (listed under `skipped`), so every row shows a photo and a price.
 *
 * Page rules (src/test/giftGuideThemes1124.test.tsx): the rows keep the list's own groups (Stocking stuffers under $10
 * first ...), each group a section that opens expanded; no "shop similar"; Amazon links are fine on the page.
 * scripts/gift-guide-picks.mjs runs applyThemeGuides1124 LAST, next to applyHer1121 and applyHimKids1121, so no earlier
 * rule or sweep drops or reorders these.
 */
import { THEME_FILES } from "./gift-guide-themes/index.mjs";

/** slug -> the theme's rows file ({ slug, name, sectionPrefix, builtFrom, rows, skipped }). */
export const THEME_ROWS_FILES_1124 = THEME_FILES;

/** The researched rows of one theme, in the page's order (`id` is the research list's, `was` the store's crossed-out price). */
export const themeRows1124 = (slug) => THEME_FILES[slug]?.rows ?? [];

/** One theme's chunk picks (the ResearchedPick shape the other guides use; `id`, `was` and `age` stay in the rows file). */
export const themePicks1124 = (slug, rows = themeRows1124(slug)) =>
  rows.map(({ id: _id, was: _was, age: _age, ...p }) => ({ ...p, ownerPick: true, from: slug }));

/** Puts every theme page's picks in place (the generator's last step). */
export function applyThemeGuides1124(pageList) {
  const out = {};
  for (const slug of Object.keys(THEME_FILES)) {
    pageList[slug] = themePicks1124(slug);
    out[slug] = pageList[slug].length;
  }
  return out;
}

/** True for an Amazon row (its store, or an amazon.com / amzn.to link). */
export const isAmazonRow = (r) => {
  let host = "";
  try {
    host = new URL(r.href).hostname;
  } catch {
    // A malformed link is no Amazon link; the store key still decides.
    host = "";
  }
  return r.store === "store-amazon" || host === "amazon.com" || host.endsWith(".amazon.com") || host === "amzn.to";
};
