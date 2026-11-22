/**
 * The price sort key of the owner-list guides (Her, Him, Kids; owner 2026-11-21: "the guides should be able to be
 * sorted by price"). Each source row holds `sortPrice`, the price the owner saw. This orders the rows cheapest first
 * (ties keep their source order) and gives each one `priceRank`: its 1-based place in that order. A row with no usable
 * price (missing, not a number, 0 or less) goes after every priced row and gets `priceRank: null`; the page keeps such a
 * row last in BOTH orders (src/content/giftGuidePriceSort.ts). `priceRank` is a position; the shown price is the same
 * sortPrice (Amazon too since owner 11-21: "each item also needs a price"), so the order follows the shown prices.
 *
 * SAME DESIGN TOGETHER (owner 2026-11-22 on For Him's $35 Smathers & Branson picks: "put the ducks designs together, the
 * upland design together, just move them around so they're next to each other"): within one price, rows of the same
 * brand that share a design word sit next to each other, the group where its first row was (the rule and its design
 * words: src/content/giftGuideDesign.mjs). Only ties move: cheapest first still holds across the page.
 * Guard: src/test/giftGuidePriceSort1121.test.tsx, src/test/giftGuideSameDesignTogether1122.test.ts.
 */
import { designTogether } from "../src/content/giftGuideDesign.mjs";

/** Whether a row's sortPrice is a usable price. */
export const hasSortPrice = (r) => typeof r.sortPrice === "number" && Number.isFinite(r.sortPrice) && r.sortPrice > 0;

/** The rows cheapest first, unknown prices last, each as { row, priceRank }. */
export function rankByPrice(rows) {
  const indexed = rows.map((row, i) => ({ row, i, known: hasSortPrice(row) }));
  indexed.sort((a, b) => {
    if (a.known !== b.known) return a.known ? -1 : 1;
    return (a.known ? a.row.sortPrice - b.row.sortPrice : 0) || a.i - b.i;
  });
  const ordered = [];
  for (let i = 0; i < indexed.length; ) {
    let j = i + 1;
    while (j < indexed.length && indexed[j].known && indexed[i].known && indexed[j].row.sortPrice === indexed[i].row.sortPrice) j++;
    ordered.push(...(indexed[i].known ? designTogether(indexed.slice(i, j), (x) => ({ name: x.row.name, brand: x.row.brand, price: x.row.sortPrice })) : indexed.slice(i, j)));
    i = j;
  }
  let rank = 0;
  return ordered.map(({ row, known }) => ({ row, priceRank: known ? ++rank : null }));
}
