/**
 * GUIDES AUDIT 1126 (~/.lh-shots/guides-audit-1126): two fixes the audit asked for, each checked on the data the page reads.
 *  1. Prices that moved in Black Friday week (scripts/giftGuidePrices1126.mjs): each shows the price read on 11-26, dated
 *     11-26, on the committed Her / Him / Kids chunk AND from the builder, so it sits in the price section that price reads
 *     (the Maybelline set leaves Stocking stuffers under $10; the OOLY hair crayons join it). The expected rows are copied
 *     from the audit's reads, not from the module, so the check is two-way.
 *  2. Owner picks first in each price section on a themed guide: the chunk keeps the research's `ownerAdd`, and the page
 *     (src/content/giftGuideOwnerOrder.ts ownerAddsFirst, applied in GiftGuideView) puts those rows first inside each section, in the order they had.
 * @mutate scripts/giftGuideHer1121.mjs |   return rankByPrice(rows.map(withPrice1126)).map(({ row: r, priceRank }) => { |   return rankByPrice(rows).map(({ row: r, priceRank }) => {
 * @mutate scripts/giftGuidePrices1126.mjs |   B0HJ9ZJ8KM: 10.99, |   B0HJ9ZJ8KM: 6.99,
 * @mutate src/content/giftGuideOwnerOrder.ts |     out.push(...run.filter((p) => p.ownerAdd), ...run.filter((p) => !p.ownerAdd)); |     out.push(...run);
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const picks = sortable ? ownerAddsFirst(ordered) : ordered; |   const picks = ordered;
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRICES_1126, PRICES_AT_1126 } from "../../scripts/giftGuidePrices1126.mjs";
import { her1121Picks } from "../../scripts/giftGuideHer1121.mjs";
import { him1121Picks, kids1121Picks } from "../../scripts/giftGuideHimKids1121.mjs";
import { themeChunkPicks } from "../../scripts/giftGuideThemePicks.mjs";
import { ownerAddsFirst } from "@/content/giftGuideOwnerOrder";
import { KIDS_THEME_GUIDES_1124 } from "@/content/giftGuideLive.mjs";
import { blankComments } from "./helpers/blankNonCode";

type P = { name: string; href: string; price?: number; priceAt?: string; ownerAdd?: true };
const chunk = (slug: string): P[] => JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")).picks;

// [guide, link part, price read 11-26, name start]
const READ: [string, string, number, string][] = [
  ["her", "B0HJ9ZJ8KM", 10.99, "Maybelline Mascara Holiday Gift Set"],
  ["her", "B0BGS3L9XS", 38.99, "ReachMe Womens Sherpa"],
  ["her", "B0C246HFWN", 8.96, "Loritta Long Plaid Winter Scarf"],
  ["her", "B0F5K3B4Q7", 22.46, "She's Birdie"],
  ["her", "B0D19JDZJS", 21, "Too Faced Born This Way"],
  ["her", "B0H42QZ8BW", 27, "Sol de Janeiro"],
  ["her", "B0F41DGFXT", 31.87, "Matador Global Travel Adapter"],
  ["her", "B0FFMJMB6K", 26.39, "JEIBKOUY Oversized Camo Hoodie"],
  ["her", "B0G4M22BQL", 26.39, "Oversized Mockneck Striped Sweatshirt"],
  ["her", "B0CPB1MWMP", 39.99, "HEYDUDE Austin Lift"],
  ["her", "B0030F32L6", 6.16, "Pilot G2"],
  ["her", "B0HKQYLRBB", 19.99, "Personalized Striped Monogram Makeup Pouch"],
  ["him", "B0070XAL0E", 8.5, "Jack Black Intense Therapy"],
  ["him", "B08L12KVMB", 9.99, "Gun Cleaning Patches"],
  ["him", "B06VX42986", 26.95, "Palmetto Wood Shop"],
  ["him", "B002ZK45IQ", 5.59, "Gerber Shard"],
  ["him", "B003IWI66W", 13.99, "Bear Paws"],
  ["him", "B089F9YDFC", 15.99, "Ontel Battery Daddy"],
  ["him", "B086KY66PH", 17.98, "Hanes Men's Undershirt"],
  ["him", "B0CHVWCSQ8", 45.99, "Klola"],
  ["him", "B0HCVK9JTC", 32.94, "HOOEY"],
  ["him", "B0FQFB8FMG", 149, "Apple AirPods Pro 3"],
  ["him", "0935032509", 18.6, "Talk About Good II"],
  ["him", "p-108101578", 49.5, "Smathers & Branson Mallard Tervis Tumbler"],
  ["kids", "B0GHBKG64Q", 49.99, "Primal Hatch Megalodon"],
  ["kids", "B074YZWKMB", 50.95, "Little King LSU Tigers"],
  ["kids", "B0GT16T874", 11.98, "Taba Squishies"],
  ["kids", "B08199W8C1", 16.14, "Piggy Bank ATM"],
  ["kids", "p-109730393", 7.46, "OOLY Hair Doodlers"],
];

describe("11-26 price changes on Her, Him and Kids", () => {
  const built: Record<string, P[]> = { her: her1121Picks(), him: him1121Picks(), kids: kids1121Picks() };
  it("the module lists exactly the audit's reads", () => {
    expect(Object.keys(PRICES_1126).length).toBe(READ.length);
    expect(READ.length).toBeGreaterThan(25);
  });
  it.each(READ)("%s %s shows %d dated 11-26 (chunk and builder)", (g, key, price, name) => {
    for (const list of [chunk(g), built[g]]) {
      const hits = list.filter((p) => p.href.includes(key));
      expect(hits.length, name).toBe(1);
      expect(hits[0].name.startsWith(name), hits[0].name).toBe(true);
      expect([hits[0].price, hits[0].priceAt]).toEqual([price, PRICES_AT_1126]);
    }
  });
  it("the committed chunks are what the builders write", () => {
    for (const g of ["her", "him", "kids"]) expect(chunk(g)).toEqual(JSON.parse(JSON.stringify(built[g])));
  });
});

describe("owner picks first in each price section (themed guides)", () => {
  it("ownerAddsFirst leads each section run with the owner's rows, keeping each group's order", () => {
    const rows = [
      { n: 1, sectionId: "a" }, { n: 2, sectionId: "a", ownerAdd: true as const }, { n: 3, sectionId: "a" },
      { n: 4, sectionId: "b" }, { n: 5, sectionId: "b", ownerAdd: true as const }, { n: 6, sectionId: "b", ownerAdd: true as const },
    ];
    expect(ownerAddsFirst(rows).map((r) => r.n)).toEqual([2, 1, 3, 5, 6, 4]);
  });
  it("the page applies it to the sectioned list", () => {
    const src = blankComments(readFileSync("src/pages/info/giftGuides/GiftGuideView.tsx", "utf8"));
    expect(src).toContain("const picks = sortable ? ownerAddsFirst(ordered) : ordered;");
  });
  it.each([...KIDS_THEME_GUIDES_1124])("%s: the chunk marks the owner's own rows ownerAdd, and only those", (slug) => {
    const { rows } = JSON.parse(readFileSync(`scripts/gift-guide-themes/${slug}.json`, "utf8")) as { rows: (P & { ownerAdd?: boolean })[] };
    const mine = new Set(rows.filter((r) => r.ownerAdd).map((r) => r.href));
    const c = chunk(slug);
    expect(c.filter((p) => p.ownerAdd).map((p) => p.href).sort()).toEqual([...mine].sort());
    expect(c).toEqual(JSON.parse(JSON.stringify(themeChunkPicks(slug, rows as never))));
  });
  it("most theme guides carry owner adds (inventory floor)", () => {
    const n = [...KIDS_THEME_GUIDES_1124].filter((s) => chunk(s).some((p) => p.ownerAdd)).length;
    expect(n).toBeGreaterThan(5);
  });
});
