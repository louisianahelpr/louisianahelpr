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
 * brand that share a design word sit next to each other, the group where its first row was. A row's design words are
 * its name's words after the brand, without the last two (the item: "Key Fob", "Bottle Opener", "Can Cooler"), a
 * trailing "s" dropped ("Decoys" = "Decoy"); so Duck Decoys Key Fob joins Wood Duck Decoy Bottle Opener, and Upland
 * Shoot Key Fob joins Upland Shoot Can Cooler. Only ties move: cheapest first still holds across the page.
 * Guard: src/test/giftGuidePriceSort1121.test.tsx, src/test/giftGuideSameDesignTogether1122.test.ts.
 */

/** Whether a row's sortPrice is a usable price. */
export const hasSortPrice = (r) => typeof r.sortPrice === "number" && Number.isFinite(r.sortPrice) && r.sortPrice > 0;

const words = (s) => String(s ?? "").toLowerCase().replace(/&/g, " ").split(/[^a-z0-9]+/).filter(Boolean);

/** A row's design words: its name after the brand, less the last two words (the item), each without a trailing "s". */
export function designWords(row) {
  const brand = words(row.brand);
  const name = words(row.name);
  if (brand.length === 0 || brand.some((w, k) => name[k] !== w)) return new Set();
  return new Set(name.slice(brand.length, -2).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w)));
}

/** One run of same-price rows, same-brand rows that share a design word pulled next to each other (stable). */
function designTogether(run) {
  const placed = new Set();
  const out = [];
  const designs = run.map((x) => designWords(x.row));
  const brandOf = run.map((x) => words(x.row.brand).join(" "));
  for (let a = 0; a < run.length; a++) {
    if (placed.has(a)) continue;
    const group = [a];
    placed.add(a);
    // The group grows through any shared design word (transitively), each joiner in its own order.
    for (let g = 0; g < group.length; g++) {
      for (let b = a + 1; b < run.length; b++) {
        if (placed.has(b) || !brandOf[b] || brandOf[b] !== brandOf[group[g]]) continue;
        if ([...designs[b]].some((w) => designs[group[g]].has(w))) { group.push(b); placed.add(b); }
      }
    }
    out.push(...group.sort((x, y) => x - y).map((k) => run[k]));
  }
  return out;
}

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
    ordered.push(...(indexed[i].known ? designTogether(indexed.slice(i, j)) : indexed.slice(i, j)));
    i = j;
  }
  let rank = 0;
  return ordered.map(({ row, known }) => ({ row, priceRank: known ? ++rank : null }));
}
