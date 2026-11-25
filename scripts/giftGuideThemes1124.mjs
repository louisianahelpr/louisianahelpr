/**
 * THE THEMED KIDS GIFT GUIDES, /gift-guides/<slug> (owner 2026-11-24: Monster Jam first, then "Marvel, Bluey, KPop Demon
 * Hunters, Pokémon, Minecraft, Hot Wheels, Paw Patrol, Stitch/Disney, Sonic, Mario, Barbie, Gabby's Dollhouse,
 * Squishmallows, LEGO", each built exactly like Monster Jam). Each theme's rows live in
 * scripts/gift-guide-themes/<slug>.json (registry: scripts/gift-guide-themes/index.mjs), written from the research lane's
 * folder by `node scripts/theme-guide-import.mjs <slug> "<Theme name>" <research folder>`: every item found, each link
 * and price read on the research day. Out-of-stock items, items with no price and items with no photo are left out
 * (listed under `skipped`), so every row shows a photo and a price.
 *
 * Page rules (src/test/giftGuideThemes1124.test.tsx, giftGuideThemeLayout1124.test.tsx): laid out as For Kids (owner
 * 11-24 ~7 PM: "add a filter like the main 3 guides ... sorted like the main 3 guides"): the main guides' price sections,
 * Stocking stuffers under $10 first, each open on arrival, and Kids' Filter (age, price, for, sort); no "shop similar";
 * Amazon links are fine on the page.
 * scripts/gift-guide-picks.mjs runs applyThemeGuides1124 LAST, next to applyHer1121 and applyHimKids1121, so no earlier
 * rule or sweep drops or reorders these.
 */
import { THEME_FILES } from "./gift-guide-themes/index.mjs";
import { KIDS_THEME_MOVES_1124 } from "./giftGuideKidsThemeMoves1124.mjs";
import { themeChunkPicks } from "./giftGuideThemePicks.mjs";

/** slug -> the theme's rows file ({ slug, name, sectionPrefix, builtFrom, rows, skipped }). */
export const THEME_ROWS_FILES_1124 = THEME_FILES;

/** The researched rows of one theme, in the page's order (`id` is the research list's, `was` the store's crossed-out price). */
export const themeRows1124 = (slug) => THEME_FILES[slug]?.rows ?? [];

/**
 * One theme's chunk picks (the ResearchedPick shape the other guides use; `id`, `was`, `age` and the research's own
 * groups stay in the rows file): cheapest first with `priceRank` and the age in years, no category sections, so the page
 * lays it out as For Kids (owner 11-24 ~7 PM; the rule: scripts/giftGuideThemePicks.mjs).
 */
export const themePicks1124 = (slug, rows = themeRows1124(slug)) => themeChunkPicks(slug, rows);

/**
 * The Kids picks that leave Kids for their theme page (scripts/giftGuideKidsThemeMoves1124.mjs): only a move whose theme
 * is live and whose theme rows hold the same product (`themeId`), so the pick is never off both pages.
 */
export const kidsThemeMovesLive1124 = () =>
  KIDS_THEME_MOVES_1124.filter(([, , to, id, held]) => !held && id && themeRows1124(to).some((r) => r.id === id))
    .map(([href, name, to, id]) => ({ href, name, to, id }));

/** Puts every theme page's picks in place (the generator's last step). The moved Kids picks leave in kids1121Picks. */
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
