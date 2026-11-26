/**
 * Kids Black Friday sweep 11-24 (scripts/giftGuideAmazonPrices1124.mjs): every Amazon pick on For Kids was re-read on its
 * amazon.com/dp page; the ones whose price changed show the price read, dated that day, on both the committed chunk and the
 * builder. The expected rows are copied from the read (~/.lh-shots/kids-bf-sweep-1124/amazon-reads.jsonl), not from the
 * module, so the check is two-way.
 * @mutate scripts/giftGuideHimKids1121.mjs |   rankByPrice(rows.map(withReread1124).map((r) => { | rankByPrice(rows.map((r) => r).map((r) => {
 * @mutate scripts/giftGuideAmazonPrices1124.mjs |   "B0GH39S2GJ": 49.99, |   "B0GH39S2GJ": 83,
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AMAZON_PRICES_1124, AMAZON_PRICES_AT_1124, amazonPrice1124 } from "../../scripts/giftGuideAmazonPrices1124.mjs";
import { kids1121Picks } from "../../scripts/giftGuideHimKids1121.mjs";
import { KIDS_THEME_MOVES_1124 } from "../../scripts/giftGuideKidsThemeMoves1124.mjs";

const READ: [string, number, string][] = [
  ["B0CBT2N7N1", 14.28, "UNO Show 'em No Mercy Card Game in Tin"],
  ["B09GXDQ122", 11.63, "Would You Rather Book for Kids"],
  ["B0G441FJ3G", 18.05, "Polly Pocket Dream Treat Unicorn Compact"],
  ["B0DB9JTTJQ", 21.21, "CreateOn Crayola Holiday Glitter Magnetic Tiles"],
  ["B0GGTL1S8X", 19.99, "MAGNA-TILES microMAGS"],
  ["B0G497FGT6", 20.99, "GUI GUI Mega Slime Haul"],
  ["B0CSP7M219", 21.84, "Hatchimals Alive Rainbow Hatchery"],
  ["B0HGX9TVW6", 22.53, "Skillmatics Aqua Puffs Christmas Ornaments"],
  ["B00FFJZ010", 24.99, "Stomp Rocket Ultra LED"],
  ["B0FX3KW535", 29.97, "Tickle Me Elmo Giggle Max"],
  ["B0CSJQHF6W", 32.95, "Bitzee Disney Digital Pet"],
  ["B0G2T2Q1RH", 39.99, "LEGO Gingerbread House"],
  ["B081RJ8DW1", 86.99, "Gskyer Telescope"],
  ["B0GH39S2GJ", 49.99, "PAW Patrol Dino Movie Megasaurus Vehicle"],
  ["B0G3RKYTMS", 169.17, "Bluey Light and Surprise Heeler House"],
  ["B0G2T1VN17", 174.98, "LEGO City Lava Land Roller Coaster Park 60501"],
  ["B0G4SCX27Q", 382.49, "Meta Quest 3S VR Headset, 256GB"],
  ["B0DZ77D5HL", 379, "Apple iPad 11-inch (A16, 128GB, Wi-Fi)"],
];

type Pick = { name: string; href: string; price?: number; priceAt?: string; store?: string };
const chunk = (JSON.parse(readFileSync("src/content/giftGuidePicks/kids.json", "utf8")) as { picks: Pick[] }).picks;

describe("Kids Amazon prices re-read 11-24", () => {
  it("the module holds exactly the prices read", () => {
    expect(READ.length).toBeGreaterThan(15); // inventory floor: 18 changed on 2026-11-24
    expect(AMAZON_PRICES_1124).toEqual(Object.fromEntries(READ.map(([a, p]) => [a, p])));
    expect(amazonPrice1124("https://www.amazon.com/dp/B0GH39S2GJ?tag=louisianahelpr-20")).toBe(49.99);
    expect(amazonPrice1124("https://www.amazon.com/dp/B000000000?tag=louisianahelpr-20")).toBeUndefined();
  });
  it("each re-read pick shows that price, dated the read day, on the chunk and the builder", () => {
    for (const list of [chunk, kids1121Picks() as Pick[]]) {
      for (const [asin, price, name] of READ) {
        // A pick that moved to its themed guide (scripts/giftGuideKidsThemeMoves1124.mjs) is no longer on Kids.
        if (KIDS_THEME_MOVES_1124.some(([href]) => href.includes(`/dp/${asin}`))) continue;
        const hits = list.filter((p) => p.href.includes(`/dp/${asin}`));
        expect(hits.length, name).toBe(1);
        expect(hits[0], name).toMatchObject({ name, price, priceAt: AMAZON_PRICES_AT_1124, store: "store-amazon" });
      }
    }
  });
});
