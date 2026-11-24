/**
 * The owner's 48 Amazon beauty picks for Her (owner 2026-11-24 ~11:20 AM CT: "Add Amazon beauty to Her: A1 … A48";
 * scripts/giftGuideAmazonBeauty1124.mjs). The list below is copied from her Desktop review page
 * ("Louisiana Helpr Tracker/reviews/amazon-beauty-33-1124.html": ASIN and price) and the campaigns she accepted
 * (~/.lh-shots/amazon-cc-beauty-1124-handoff.md: rate and last day per brand), not from the module, so each check is
 * two-way: every one is on the generated For Her page exactly once, as an owner pick at the campaign's rate with its
 * last day, at the price read on amazon.com 11-24, with Amazon's own photo; and none of them is on the deals feed
 * (Amazon links never go on Facebook).
 * @mutate scripts/giftGuideHer1121.mjs | ...HER_ADDS_1124, ...HER_AMAZON_BEAUTY_1124]; | ...HER_ADDS_1124];
 * @mutate scripts/giftGuideAmazonBeauty1124.mjs | ["B0HFQ324TF", 45, | ["B0HFQ324TF", 54,
 * @mutate scripts/giftGuideAmazonBeauty1124.mjs | "Kiehl's", "skincare", 30, L, "A rich avocado | "Kiehl's", "skincare", 3, L, "A rich avocado
 * @mutate scripts/giftGuideAmazonBeauty1124.mjs | const L = "2026-12-16"; | const L = "2026-12-31";
 * @mutate scripts/giftGuideAmazonBeauty1124.mjs |   ...(campaignEnds ? { campaignEnds } : {}), |   ...{},
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HER_AMAZON_BEAUTY_1124_ROWS } from "../../scripts/giftGuideAmazonBeauty1124.mjs";
import { her1121Picks } from "../../scripts/giftGuideHer1121.mjs";

type Pick = { name: string; brand: string; href: string; image?: string; store?: string; price?: number; priceAt?: string; commission?: number | null; campaignEnds?: string; ownerPick?: true; type?: string };
const her = (JSON.parse(readFileSync("src/content/giftGuidePicks/her.json", "utf8")) as { picks: Pick[] }).picks;

/** Rate and last day per brand campaign (Creator Connections, read 11-24). Summer Fridays showed no end date. */
const CAMPAIGN: Record<string, [number, string | undefined]> = {
  "Lancôme": [30, "2026-12-16"], "Kiehl's": [30, "2026-12-16"], "Estée Lauder": [30, "2026-12-31"], Clinique: [30, "2026-12-31"],
  "Bobbi Brown": [30, "2026-12-31"], "Too Faced": [30, "2026-12-31"], "Summer Fridays": [15, undefined],
};
/** A1 ... A48 from her review page: [ASIN, price, brand]. */
const PAGE: [string, number, string][] = [
  ["B0HFQ324TF", 45, "Lancôme"], ["B0GQ14CTW7", 99, "Lancôme"], ["B0CS4LRHHS", 95.9, "Lancôme"], ["B092W4P1N9", 23.8, "Lancôme"],
  ["B00IMU2IPA", 51, "Estée Lauder"], ["B005IQ866G", 63, "Estée Lauder"], ["B0D6L6TWJC", 19.2, "Estée Lauder"], ["B00PWVIQKI", 23.8, "Clinique"],
  ["B004EHOTJS", 34.3, "Kiehl's"], ["B06X9DFBNK", 43.4, "Lancôme"], ["B0HB6Z65TX", 40, "Summer Fridays"], ["B0D19JDZJS", 30, "Too Faced"],
  ["B07KWM3JXN", 46.9, "Clinique"], ["B00E1HJLEY", 97.3, "Kiehl's"], ["B0DNLC5T7S", 9.6, "Lancôme"], ["B0081KINZK", 65.1, "Bobbi Brown"],
  ["B0009OAIBI", 51, "Estée Lauder"], ["B0012RSTIA", 31.5, "Estée Lauder"], ["B0HB6KB3BW", 56.1, "Summer Fridays"], ["B096CFPBLY", 25.9, "Clinique"],
  ["B0DBVZX9YH", 25.2, "Lancôme"], ["B0GQJRMLG4", 25.2, "Lancôme"], ["B0F22N1MNV", 25.2, "Lancôme"], ["B000P20PU8", 35.7, "Clinique"],
  ["B0G319B1CR", 23.8, "Lancôme"], ["B0DFDSRCHY", 23.8, "Clinique"], ["B0H9ZVR21B", 34.3, "Kiehl's"], ["B0BJBT1WQJ", 43.4, "Kiehl's"],
  ["B077Y7CTR8", 31.5, "Kiehl's"], ["B002LK0GAQ", 42, "Kiehl's"], ["B0GQJPHLK7", 20.3, "Lancôme"], ["B0GZ8BDMHS", 19.6, "Estée Lauder"],
  ["B0FTHLKL42", 19.2, "Estée Lauder"], ["B0DY1WSW83", 34, "Summer Fridays"], ["B0DM3S16NM", 32.5, "Lancôme"], ["B000S97MAY", 28, "Kiehl's"],
  ["B00EKT4MCY", 15.4, "Kiehl's"], ["B08P541DPH", 14, "Estée Lauder"], ["B016Z69QF2", 18.2, "Kiehl's"], ["B007GOQYR6", 25.2, "Bobbi Brown"],
  ["B0CTL1F8LW", 22.4, "Lancôme"], ["B00DNGVPZW", 11.2, "Too Faced"], ["B083PXLPHC", 19.6, "Too Faced"], ["B074G4J1KK", 9.6, "Lancôme"],
  ["B08LHFXTX7", 17.5, "Lancôme"], ["B07Q6J2C9C", 16.8, "Clinique"], ["B07V5X4KDZ", 16.8, "Kiehl's"], ["B0FZXN4HN9", 16.06, "Clinique"],
];

describe("Her: the owner's 48 Amazon beauty picks (11-24)", () => {
  it("the module holds exactly her 48, in her page's order", () => {
    expect(PAGE.length).toBe(48);
    expect(HER_AMAZON_BEAUTY_1124_ROWS.map((r) => r[0])).toEqual(PAGE.map((r) => r[0]));
  });

  // Both the generated page and what the module builds now (so a module edit fails here before anyone regenerates).
  it.each([["her.json", her], ["her1121Picks()", her1121Picks() as Pick[]]] as const)("each is on For Her once (%s): owner pick, tagged Amazon link, campaign rate and last day, 11-24 price, Amazon's photo, no model year", (_label, list) => {
    expect(list.length).toBeGreaterThan(220); // 229 measured 2026-11-24 (246 before the owner's 11-24 trim of 17)
    for (const [asin, price, brand] of PAGE) {
      const rows = list.filter((p) => p.href.includes(`/dp/${asin}`));
      expect(rows.length, asin).toBe(1);
      const p = rows[0];
      expect(p.href, asin).toBe(`https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`);
      expect(p.store, asin).toBe("store-amazon");
      expect(p.ownerPick, asin).toBe(true);
      expect(p.brand, asin).toBe(brand);
      expect(p.name.startsWith(brand), `${asin}: ${p.name}`).toBe(true);
      expect(p.name, asin).not.toMatch(/\b20\d\d\b/);
      expect([p.commission, p.campaignEnds], `${asin} ${brand}`).toEqual(CAMPAIGN[brand]);
      expect(p.price, asin).toBe(price);
      expect(p.priceAt, asin).toBe("2026-11-24");
      expect(p.image, asin).toMatch(/^https:\/\/m\.media-amazon\.com\/images\/I\/[^/]+\._SL500_\.jpg$/);
      expect(p.type, asin).toMatch(/^[a-z-]+$/);
    }
  });

  it("none of them is on the deals feed (Amazon links never go on Facebook)", () => {
    const deals = readFileSync("src/content/giftGuideDeals.json", "utf8");
    expect(deals.length).toBeGreaterThan(1000);
    for (const [asin] of PAGE) expect(deals.includes(asin), asin).toBe(false);
  });
});
