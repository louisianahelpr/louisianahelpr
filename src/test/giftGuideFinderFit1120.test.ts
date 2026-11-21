/**
 * The gift finder's close matches suit the person, and show one card per near-duplicate (gg-live-1120, live check
 * 11-20): Dad + Under $25 + Outdoorsy had no exact match and filled with a shower oil and pimple patches (gift types
 * "bath" and "skincare" from the budget guides), and Mom + Under $25 + Trendy showed two Stanley can coolers. The
 * finder still always shows a list (owner 11-20).
 *
 * Owner 11-21: the finder is off the landing and its budget guides are retired (src/content/giftGuideLive.mjs); the
 * tests that needed the budget guides' picks are gone, the fit rules stay.
 *
 * @mutate src/content/giftGuideExtras1120.ts |   if (who === "him" \|\| who === "dad") return !WOMENS.test(text) && !((WOMENS_TYPE.test(p.type ?? "") \|\| BEAUTY_NAME.test(p.name)) && !MENS.test(p.name)); |   if (who === "him" \|\| who === "dad") return !WOMENS.test(text);
 * @mutate src/content/giftGuideExtras1120.ts |       if (seen.has(p.href) \|\| near.has(key) \|\| (brand && brands.has(brand)) \|\| | if (seen.has(p.href) \|\|
 * @mutate src/content/giftGuideExtras1120.ts |   for (const tier of [own.filter(fits), lent | for (const tier of [pool.filter(fits), lent
 */
import { describe, expect, it } from "vitest";
import { guideBySlug, loadAllGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { FINDER_BUDGET_GUIDES, FINDER_BUDGETS, FINDER_VIBES, finderPool, giftFinder, nearDupKey, type FinderWho } from "@/content/giftGuideExtras1120";

await loadAllGuidePicks();
const picksOf = (slug: string) => guideBySlug(slug)?.picks ?? [];
const borrow = FINDER_BUDGET_GUIDES.flatMap(picksOf);
const run = (who: FinderWho, budget: 0 | 25 | 50 | 100, vibe: (typeof FINDER_VIBES)[number]["id"]) => giftFinder(finderPool(who, picksOf), budget, vibe, borrow, who);

/** Women's gift types, and the name words, that never go to Him or Dad as a close match (unless the name says men's). */
const WOMENS_TYPES = /^(skincare|makeup|lip|nails?|bath|body-care|hair-care|hair-tool|hair-accessory|fragrance mist|jewelry|lash)$/i;
const MENS_NAME = /\b(men'?s|mens|for men)\b/i;

describe("gift finder close matches suit the person (gg-live-1120)", () => {

  it("no Him/Dad close match is a women's gift type, and no Her/Mom close match is a men's item, for every budget and vibe", () => {
    let checked = 0;
    for (const who of ["him", "dad"] as const) for (const b of FINDER_BUDGETS) for (const v of FINDER_VIBES) {
      for (const p of run(who, b.id, v.id).close) {
        checked += 1;
        if ((WOMENS_TYPES.test(p.type ?? "") || /\b(shampoo|serum|body (wash|lotion|cream))\b/i.test(p.name)) && !MENS_NAME.test(p.name)) expect.fail(`${who} ${b.id} ${v.id}: ${p.name} (${p.type})`);
      }
    }
    for (const who of ["her", "mom"] as const) for (const b of FINDER_BUDGETS) for (const v of FINDER_VIBES) {
      for (const p of run(who, b.id, v.id).close) { checked += 1; expect(`${p.name} ${p.brand ?? ""}`, `${who} ${b.id} ${v.id}`).not.toMatch(/\b(men'?s|boys'?)\b/i); }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it("the near-duplicate key: same brand and gift type match; sizes and colours do not split a name", () => {
    const pick = (name: string, brand: string, type?: string) => ({ name, brand, href: name, store: "shopmy", ...(type ? { type } : {}) }) as CatalogPick;
    expect(nearDupKey(pick("Stanley Everyday Can Cooler Cup 10 oz", "Stanley", "can-cooler"))).toBe(nearDupKey(pick("Stanley The Everyday Slim Can Cooler Cup, 10 OZ", "STANLEY", "can-cooler")));
    expect(nearDupKey(pick("YETI Rambler 20 oz Tumbler, Navy", "YETI"))).toBe(nearDupKey(pick("YETI Rambler Tumbler, Black", "YETI")));
    expect(nearDupKey(pick("Stanley Quencher", "Stanley", "drinkware"))).not.toBe(nearDupKey(pick("Stanley Can Cooler", "Stanley", "can-cooler")));
  });
});
