/**
 * SAME DESIGN TOGETHER (owner 2026-11-22 on For Him's $35 Smathers & Branson picks: "put the ducks designs together, the
 * upland design together, just move them around so they're next to each other"). Within one price, the rows of one
 * brand that share a design word (scripts/giftGuidePriceRank1121.mjs designWords: the name after the brand, less the
 * item's last two words) sit next to each other; cheapest first still holds across every page. Checked on the module's
 * output and on the generated pages of Her, Him and Kids (the only owner lists), so a split pair anywhere fails.
 * Measured 2026-11-22: Him's Wood Duck Decoy Bottle Opener sat 5 rows after the Duck Decoys Key Fob (the Redfish and
 * Upland Shoot pairs between them); Her and Kids had no split pair.
 *
 * @mutate scripts/giftGuidePriceRank1121.mjs |     ordered.push(...(indexed[i].known ? designTogether(indexed.slice(i, j)) : indexed.slice(i, j))); |     ordered.push(...indexed.slice(i, j));
 * @mutate scripts/giftGuidePriceRank1121.mjs |   return new Set(name.slice(brand.length, -2).map((w) => (w.length > 3 ? w.replace(/s$/, "") : w))); |   return new Set(name.slice(brand.length, -2));
 * @mutate src/content/giftGuidePicks/him.json | "Smathers & Branson Wood Duck Decoy Bottle Opener" | "Smathers & Branson Wood Duck Decoy Bottle Opener "
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { designWords, rankByPrice } from "../../scripts/giftGuidePriceRank1121.mjs";
import { him1121Picks, kids1121Picks } from "../../scripts/giftGuideHimKids1121.mjs";
import { her1121Picks } from "../../scripts/giftGuideHer1121.mjs";

type Pick = { name: string; brand?: string; price?: number; priceRank?: number | null };
const ROOT = join(__dirname, "..", "..");
const page = (slug: string) => (JSON.parse(readFileSync(join(ROOT, "src", "content", "giftGuidePicks", `${slug}.json`), "utf8")).picks ?? []) as Pick[];
const brandKey = (p: Pick) => (p.brand ?? "").toLowerCase().replace(/&/g, " ").split(/[^a-z0-9]+/).filter(Boolean).join(" ");

/** Every same-price, same-brand pair that shares a design word but has a row of another design between them. */
function splitPairs(rows: Pick[]): string[] {
  const out: string[] = [];
  for (let a = 0; a < rows.length; a++) {
    for (let b = a + 2; b < rows.length && rows[b].price === rows[a].price; b++) {
      if (!brandKey(rows[a]) || brandKey(rows[a]) !== brandKey(rows[b])) continue;
      const da = designWords(rows[a]);
      if (![...designWords(rows[b])].some((w) => da.has(w))) continue;
      // Every row between them must belong to the same design group (share a word with one of the two).
      const between = rows.slice(a + 1, b).filter((m) => brandKey(m) !== brandKey(rows[a]) || ![...designWords(m)].some((w) => da.has(w) || designWords(rows[b]).has(w)));
      if (between.length) out.push(`${rows[a].name} ... ${rows[b].name} (split by ${between.map((m) => m.name).join(", ")})`);
    }
  }
  return out;
}

describe("same brand, same design, same price: next to each other (owner 2026-11-22)", () => {
  it("design words are the name after the brand without the item's last two words", () => {
    expect([...designWords({ brand: "Smathers & Branson", name: "Smathers & Branson Duck Decoys Needlepoint Key Fob" })]).toEqual(["duck", "decoy", "needlepoint"]);
    expect([...designWords({ brand: "Smathers & Branson", name: "Smathers & Branson Wood Duck Decoy Bottle Opener" })]).toEqual(["wood", "duck", "decoy"]);
    expect([...designWords({ brand: "Smathers & Branson", name: "Smathers & Branson Upland Shoot Can Cooler" })]).toEqual(["upland", "shoot"]);
    // No brand, or a name that does not start with it: no design (never grouped).
    expect(designWords({ brand: "", name: "Men's Fuzzy Cloud Socks" }).size).toBe(0);
    expect(designWords({ brand: "Yoosteel", name: "Birthstone Bracelet" }).size).toBe(0);
  });

  it("the sort pulls a same-design row up to its group and moves nothing else", () => {
    const rows = [
      { name: "Acme Duck Decoys Key Fob", brand: "Acme", sortPrice: 35 },
      { name: "Acme Redfish Bottle Opener", brand: "Acme", sortPrice: 35 },
      { name: "Other Duck Decoys Key Fob", brand: "Other", sortPrice: 35 },
      { name: "Acme Wood Duck Decoy Bottle Opener", brand: "Acme", sortPrice: 35 },
      { name: "Acme Redfish Key Fob", brand: "Acme", sortPrice: 35 },
      { name: "Acme Duck Decoys Card Wallet", brand: "Acme", sortPrice: 65 },
      { name: "Cheap Thing", brand: "Acme", sortPrice: 5 },
    ];
    const out = rankByPrice(rows);
    expect(out.map((o) => o.row.name)).toEqual([
      "Cheap Thing",
      "Acme Duck Decoys Key Fob", "Acme Wood Duck Decoy Bottle Opener",
      "Acme Redfish Bottle Opener", "Acme Redfish Key Fob",
      "Other Duck Decoys Key Fob",
      "Acme Duck Decoys Card Wallet",
    ]);
    expect(out.map((o) => o.priceRank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("For Him: the duck, redfish and upland Smathers & Branson pairs are next to each other, cheapest first intact", () => {
    for (const rows of [him1121Picks() as Pick[], page("him")]) {
      const names = rows.map((p) => p.name);
      for (const [a, b] of [
        ["Smathers & Branson Duck Decoys Needlepoint Key Fob", "Smathers & Branson Wood Duck Decoy Bottle Opener"],
        ["Smathers & Branson Redfish Bottle Opener", "Smathers & Branson Redfish Key Fob"],
        ["Smathers & Branson Upland Shoot Key Fob", "Smathers & Branson Upland Shoot Can Cooler"],
      ]) {
        expect(names.indexOf(a), a).toBeGreaterThanOrEqual(0);
        expect(Math.abs(names.indexOf(a) - names.indexOf(b)), `${a} / ${b}`).toBe(1);
      }
      const prices = rows.map((p) => p.price as number);
      expect(prices).toEqual([...prices].sort((x, y) => x - y));
    }
  });

  it("no split same-design pair on Her, Him or Kids (module and generated page alike)", () => {
    const lists: [string, Pick[]][] = [
      ["her module", her1121Picks() as Pick[]], ["him module", him1121Picks() as Pick[]], ["kids module", kids1121Picks() as Pick[]],
      ["her page", page("her")], ["him page", page("him")], ["kids page", page("kids")],
    ];
    let pairsSeen = 0;
    for (const [label, rows] of lists) {
      expect(rows.length, label).toBeGreaterThan(40);
      expect(splitPairs(rows), label).toEqual([]);
      for (let k = 1; k < rows.length; k++) if (rows[k].price === rows[k - 1].price && brandKey(rows[k]) && brandKey(rows[k]) === brandKey(rows[k - 1]) && [...designWords(rows[k])].some((w) => designWords(rows[k - 1]).has(w))) pairsSeen++;
    }
    // The Him module and page each hold at least the 4 Smathers & Branson pairs at $35 (ducks, redfish, upland, LSU).
    expect(pairsSeen).toBeGreaterThanOrEqual(8);
  });
});
