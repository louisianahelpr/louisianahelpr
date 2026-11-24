/**
 * THE MONSTER JAM GIFT GUIDE, /gift-guides/monster-jam (owner 2026-11-24: "lets put together a monster jam gift guide
 * that i can share on facebook"; she chose both a site page and a Facebook picture collage, "with every item we can
 * find"). Its rows live in scripts/gift-guide-monster-jam-1124.json, built from the lane's researched list
 * (~/.lh-shots/mj-guide-1124/items.json: every Monster Jam item found at Walmart, Target, Kohl's, Macy's and the
 * owner's own ShopMy adds, each link and price read 2026-11-24). Out-of-stock items, items with no price and items with
 * no photo are left out (listed under `skipped` in that file) so every row shows a photo and a price.
 *
 * Page rules (src/test/giftGuideMonsterJam1124.test.ts): the rows keep the list's own groups (Stocking stuffers under
 * $10 first, then Trucks, Remote control trucks ...), each group a section that opens expanded; no "shop similar".
 * scripts/gift-guide-picks.mjs runs applyMonsterJam1124 LAST, next to applyHer1121 and applyHimKids1121, so no earlier
 * rule or sweep drops or reorders these.
 */
// A JSON import (not readFileSync on import.meta.url) so the page guard can load it under jsdom too.
import FILE from "./gift-guide-monster-jam-1124.json" with { type: "json" };

export const MONSTER_JAM_GUIDE = "monster-jam";
/** The researched rows, in the page's order (`id` is the research list's, `was` the store's crossed-out price). */
export const MONSTER_JAM_ROWS_1124 = FILE.rows;

/** The chunk's picks (the ResearchedPick shape the other guides use; `id`, `was` and `age` stay in the rows file). */
export const monsterJamPicks1124 = () =>
  MONSTER_JAM_ROWS_1124.map(({ id: _id, was: _was, age: _age, ...p }) => ({ ...p, ownerPick: true, from: MONSTER_JAM_GUIDE }));

/** Puts the Monster Jam page's picks in place (the generator's last step). */
export function applyMonsterJam1124(pageList) {
  pageList[MONSTER_JAM_GUIDE] = monsterJamPicks1124();
  return { [MONSTER_JAM_GUIDE]: pageList[MONSTER_JAM_GUIDE].length };
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

/**
 * The Facebook collage's items (owner 11-24: a ready-to-post picture collage of the guide): every row but Amazon's
 * (Facebook rule: no Amazon items on the collage or the post; Amazon links are fine on the site page). Drawn by
 * scripts/gift-guide-monster-jam-collage.py into ~/Desktop/Louisiana Helpr Work/Social and Pinterest/Monster-Jam-guide-1124/.
 */
export const collageRows1124 = (rows = MONSTER_JAM_ROWS_1124) => rows.filter((r) => !isAmazonRow(r));
