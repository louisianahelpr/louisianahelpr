// @mutate src/content/sponsorPage.ts | { brand: "Camellia Point Public House", prize: "$25 Camellia Point Public House gift card" }, | { brand: "Camellia Point", prize: "$25 Camellia Point Public House gift card" },
// @mutate src/content/sponsorPage.ts | "Jubilant Soapsetions": "https://www.facebook.com/jubilantsoapsetions", | "Jubilant Soapsetions": "https://jubilantsoapsetions.com/",
// @mutate src/content/giftGuideSponsorLogos.json | {"name":"Luminous Advanced Aesthetics","slug":"luminous-advanced-aesthetics","group":"la","logo":"/gift-guides/sponsors/luminous-advanced-aesthetics.webp", | {"name":"Luminous Advanced Aesthetics","slug":"luminous-advanced-aesthetics","group":"la",
// @mutate src/content/giftGuideSmallBiz.json | {"slug":"miss-claudias-vintage","name":"Miss Claudia's Vintage Clothing & Costumes", | {"slug":"miss-claudias-vintage","name":"Miss Claudia's",
// @mutate src/content/giftGuideSponsorGiftTypes.ts | "Jubilant Soapsetions": "Gift set", | "Jubilant Soapsetions Co": "Gift set",
/**
 * 25 Days lineup sync, Fri 2026-11-27 (Desktop tracker ~/Desktop/Louisiana Helpr Tracker/data/sponsors.js, updatedAt
 * Fri Nov 27, 2026, 8:16 PM). Owner rule nothing-stale: the public lineup matches the tracker.
 *  - Luminous Advanced Aesthetics, Miss Claudia's Vintage Clothing & Costumes, Camellia Point Public House and Jubilant
 *    Soapsetions are in the lineup with their Facebook page (from each business's own Instagram bio or website), a logo
 *    on the gift-guides logo row (logos-from-socials), a card on the 25 Days sponsors guide and a card on the Small
 *    Business Saturday page (all four are independent Louisiana businesses).
 *  - Never a giveaway day: their days are internal (sign-up tile counts); the sponsors guide and the Small Business
 *    Saturday page carry no day (owner rule 2026-11-17: don't tell sponsors their day until it is final).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sponsorPage } from "@/content/sponsorPage";
import { SPONSOR_GIFT_TYPES } from "@/content/giftGuideSponsorGiftTypes";

const ROOT = resolve(__dirname, "../..");
const SITE = "https://www.louisianahelpr.com";
const NEW = ["Luminous Advanced Aesthetics", "Miss Claudia's Vintage Clothing & Costumes", "Camellia Point Public House", "Jubilant Soapsetions"];
type Row = { name: string; logo?: string };
const rows = JSON.parse(readFileSync(join(ROOT, "src/content/giftGuideSponsorLogos.json"), "utf8")) as Row[];
const { picks } = JSON.parse(readFileSync(join(ROOT, "src/content/giftGuidePicks/25-days-sponsors.json"), "utf8")) as {
  picks: { name: string; href: string; image?: string; sponsor?: boolean; line?: string; gift?: string }[];
};
const smallBiz = JSON.parse(readFileSync(join(ROOT, "src/content/giftGuideSmallBiz.json"), "utf8")) as { name: string; href?: string; logo?: string; description: string; gift: string }[];
const partners = sponsorPage.lineup.days.flatMap((d) => d.partners.map((p) => ({ day: d.day, brand: p.brand as string })));
const DAY_WORDS = /\b(Dec(ember)?\.? ?\d{1,2}|day \d{1,2})\b/i;

describe("25 Days lineup matches the tracker after the 2026-11-27 placements", () => {
  it("the four new sponsors are in the lineup, linked, on the logo row, carded on the sponsors guide and on Small Business Saturday", () => {
    expect(NEW.length).toBeGreaterThan(3);
    for (const n of NEW) {
      expect(partners.filter((p) => p.brand === n).length, n).toBe(1);
      expect(sponsorPage.lineup.links[n] ?? "", n).toMatch(/^https:\/\/www\.facebook\.com\//);
      const row = rows.find((r) => r.name === n);
      expect(row?.logo, n).toBeTruthy();
      expect(existsSync(join(ROOT, "public", row!.logo!)), n).toBe(true);
      const card = picks.find((p) => p.name === n);
      expect(card?.sponsor, n).toBe(true);
      // Its own website when Small Business Saturday links one (guideAuditFixes1123 #2), else its Facebook page.
      expect(card?.href ?? "", n).toMatch(/^https:\/\//);
      expect(card?.href, n).toBe(smallBiz.find((b) => b.name === n)?.href);
      expect(existsSync(join(ROOT, "public", (card?.image ?? "").slice(SITE.length))), n).toBe(true);
      expect(`${card?.line} ${card?.gift}`, n).not.toMatch(DAY_WORDS);
      expect(SPONSOR_GIFT_TYPES[n], n).toBeTruthy();
      const sb = smallBiz.find((b) => b.name === n);
      expect(sb?.logo, n).toBeTruthy();
      expect(existsSync(join(ROOT, "public", sb!.logo!)), n).toBe(true);
      expect(`${sb!.description} ${sb!.gift}`, n).not.toMatch(DAY_WORDS);
    }
  });
});
