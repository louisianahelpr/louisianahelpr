/**
 * The price sort key of the owner-list guides (Her, Him, Kids; owner 2026-11-21: "the guides should be able to be
 * sorted by price"). Each source row holds `sortPrice`, the price the owner saw. This orders the rows cheapest first
 * (ties keep their source order) and gives each one `priceRank`: its 1-based place in that order. A row with no usable
 * price (missing, not a number, 0 or less) goes after every priced row and gets `priceRank: null`; the page keeps such a
 * row last in BOTH orders (src/content/giftGuidePriceSort.ts). `priceRank` is a position; the shown price is the same
 * sortPrice (Amazon too since owner 11-21: "each item also needs a price"), so the order follows the shown prices.
 * Guard: src/test/giftGuidePriceSort1121.test.tsx.
 */

/** Whether a row's sortPrice is a usable price. */
export const hasSortPrice = (r) => typeof r.sortPrice === "number" && Number.isFinite(r.sortPrice) && r.sortPrice > 0;

/** The rows cheapest first, unknown prices last, each as { row, priceRank }. */
export function rankByPrice(rows) {
  const indexed = rows.map((row, i) => ({ row, i, known: hasSortPrice(row) }));
  indexed.sort((a, b) => {
    if (a.known !== b.known) return a.known ? -1 : 1;
    return (a.known ? a.row.sortPrice - b.row.sortPrice : 0) || a.i - b.i;
  });
  let rank = 0;
  return indexed.map(({ row, known }) => ({ row, priceRank: known ? ++rank : null }));
}
