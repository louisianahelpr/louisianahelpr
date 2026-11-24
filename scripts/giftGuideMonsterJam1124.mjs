/**
 * THE MONSTER JAM GIFT GUIDE, /gift-guides/monster-jam (owner 2026-11-24: "lets put together a monster jam gift guide
 * that i can share on facebook"; she chose both a site page and a Facebook picture collage, "with every item we can
 * find"). Its rows live in scripts/gift-guide-themes/monster-jam.json, built from the lane's researched list
 * (~/.lh-shots/mj-guide-1124/items.json: every Monster Jam item found at Walmart, Target, Kohl's, Macy's and the
 * owner's own ShopMy adds, each link and price read 2026-11-24). Out-of-stock items, items with no price and items with
 * no photo are left out (listed under `skipped` in that file) so every row shows a photo and a price.
 *
 * Page rules (src/test/giftGuideMonsterJam1124.test.ts): the rows keep the list's own groups (Stocking stuffers under
 * $10 first, then Trucks, Remote control trucks ...), each group a section that opens expanded; no "shop similar".
 * scripts/gift-guide-picks.mjs puts these in place with every themed guide (applyThemeGuides1124, last).
 */
// The rows live with the other themed guides (scripts/giftGuideThemes1124.mjs, scripts/gift-guide-themes/monster-jam.json).
import { isAmazonRow, themePicks1124, themeRows1124 } from "./giftGuideThemes1124.mjs";

export { isAmazonRow };
export const MONSTER_JAM_GUIDE = "monster-jam";
/** The researched rows, in the page's order (`id` is the research list's, `was` the store's crossed-out price). */
export const MONSTER_JAM_ROWS_1124 = themeRows1124(MONSTER_JAM_GUIDE);

/** The chunk's picks (the ResearchedPick shape the other guides use; `id`, `was` and `age` stay in the rows file). */
export const monsterJamPicks1124 = () => themePicks1124(MONSTER_JAM_GUIDE);

/**
 * The Facebook collage's items (owner 11-24: a ready-to-post picture collage of the guide): every row but Amazon's
 * (Facebook rule: no Amazon items on the collage or the post; Amazon links are fine on the site page). Drawn by
 * scripts/gift-guide-monster-jam-collage.py into ~/Desktop/Louisiana Helpr Work/Social and Pinterest/Monster-Jam-guide-1124/.
 */
export const collageRows1124 = (rows = MONSTER_JAM_ROWS_1124) => rows.filter((r) => !isAmazonRow(r));
