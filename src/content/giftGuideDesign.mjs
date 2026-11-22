/**
 * SAME DESIGN TOGETHER (owner 2026-11-22 on For Him's $35 Smathers & Branson picks: "put the ducks designs together, the
 * upland design together, just move them around so they're next to each other"). One rule for every order of the owner
 * lists (Her, Him, Kids and their views): items of the same brand and the same price that share a design word sit next
 * to each other, the group where its first (highest placed) member is. A row's design words are its name after the
 * brand, less the last two words (the item: "Key Fob", "Bottle Opener", "Can Cooler"), a trailing "s" dropped ("Decoys" =
 * "Decoy"); so Duck Decoys Key Fob joins Wood Duck Decoy Bottle Opener. Read by the import's price sort
 * (scripts/giftGuidePriceRank1121.mjs: ties only, so cheapest first holds) and by the page's click order
 * (src/content/giftGuideEarnOrder.ts: a much-clicked item brings its partners up with it).
 * Guard: src/test/giftGuideSameDesignTogether1122.test.ts.
 */
const words = (s) => String(s ?? "").toLowerCase().replace(/&/g, " ").split(/[^a-z0-9]+/).filter(Boolean);

/** The brand as a key ("" when there is none: such rows never group). */
const brandKey = (row) => words(row.brand).join(" ");

/** A row's design words: its name after the brand, less the last two words (the item), each without a trailing "s". */
export function designWords(row) {
  const brand = words(row.brand);
  const name = words(row.name);
  if (brand.length === 0 || brand.some((w, k) => name[k] !== w)) return new Set();
  return new Set(name.slice(brand.length, -2).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w)));
}

/**
 * `items` with each one's same-brand, same-price, same-design partners pulled right after the first of them, the rest
 * in their own order (stable). `view` reads an item's { name, brand, price }. Never mutates its input.
 */
export function designTogether(items, view) {
  const rows = items.map(view);
  const designs = rows.map(designWords);
  const brands = rows.map(brandKey);
  const placed = new Set();
  const out = [];
  for (let a = 0; a < items.length; a++) {
    if (placed.has(a)) continue;
    const group = [a];
    placed.add(a);
    // The group grows through any shared design word (transitively), each joiner keeping its own order.
    for (let g = 0; g < group.length; g++) {
      const m = group[g];
      for (let b = a + 1; b < items.length; b++) {
        if (placed.has(b) || !brands[b] || brands[b] !== brands[m] || rows[b].price !== rows[m].price) continue;
        if ([...designs[b]].some((w) => designs[m].has(w))) { group.push(b); placed.add(b); }
      }
    }
    out.push(...group.sort((x, y) => x - y).map((k) => items[k]));
  }
  return out;
}
