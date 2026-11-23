// @mutate src/content/sponsorPage.ts | "Pixie Dust Biodegradable Glitter (New Orleans)": "https://www.instagram.com/biodegradable_glitter/", | "Pixie Dust Biodegradable Glitter (New Orleans)": "",
// @mutate src/content/giftGuideSponsorLogos.json | "logo":"/gift-guides/sponsors/sweet-bee-organics.webp", | "logo":"/gift-guides/sponsors/sweet-bee-organics-missing.webp",
// @mutate src/content/giftGuideSponsorGiftTypes.ts |   "Wildcat Brothers Distilling": "Gift set", |   "Wildcat Brothers": "Gift set",
// @mutate src/content/giftGuidePicks/25-days-sponsors.json | "href":"https://chattanoogabeard.co/" | "href":"https://www.facebook.com/chattanoogabeardco"
// @mutate scripts/check-25days-lineup.mjs |   s = s.replace(EMAIL_CLAUSE, ""); |   s = s.replace(EMAIL_CLAUSE, s);
/**
 * The six sponsors the owner placed on 2026-11-22 (10:35-10:50 PM, 25 Days Sponsor Tracker): Ethan's Closet, The Charmed
 * Page Bookstore, Wildcat Brothers Distilling, Pixie Dust Biodegradable Glitter, Chattanooga Beard Co. and Sweet Bee
 * Organics are on every public 25 Days surface, the same way as every other sponsor (owner rule 2026-11-18: nothing stale):
 *  - the public lineup (/25days), with a link to their own Facebook or Instagram page;
 *  - the gift-guides logo row, with a logo file from their own site, socials or sign-up upload (logos-from-socials);
 *  - the 25 Days sponsors guide, as a logo card linking their own website, with a gift-type label.
 * And the drift check keeps an emailed hand-over clause ("winner emails info@... for codes") off the public prize.
 * Never a day: the page shows no day for any sponsor (src/test/sponsor25daysPublicNoDates.test.tsx).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sponsorPage } from "@/content/sponsorPage";
import { SPONSOR_GIFT_TYPES } from "@/content/giftGuideSponsorGiftTypes";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** [lineup brand, logo-row / guide name, own website host] */
const NEW: [string, string, string][] = [
  ["Ethan's Closet Children's Boutique & Little Feet", "Ethan's Closet Children's Boutique & Little Feet", "www.ethansclosetccb.com"],
  ["The Charmed Page Bookstore", "The Charmed Page Bookstore", "charmedpagebooks.com"],
  ["Wildcat Brothers Distilling", "Wildcat Brothers Distilling", "wildcatbrothers.com"],
  ["Pixie Dust Biodegradable Glitter (New Orleans)", "Pixie Dust Biodegradable Glitter", "pixiedust.eco"],
  ["Chattanooga Beard Co.", "Chattanooga Beard Co.", "chattanoogabeard.co"],
  ["Sweet Bee Organics", "Sweet Bee Organics", "sweetbeeorganics.com"],
];

describe("the sponsors placed 2026-11-22 are on every public 25 Days surface", () => {
  it("in the lineup with a link to their own page (inventory floor: six sponsors)", () => {
    expect(NEW.length).toBeGreaterThan(5);
    const brands = new Set<string>(sponsorPage.lineup.days.flatMap((d) => d.partners.map((p) => p.brand)));
    const links: Record<string, string> = sponsorPage.lineup.links;
    for (const [brand] of NEW) {
      expect(brands.has(brand), brand).toBe(true);
      expect(links[brand] ?? "", brand).toMatch(/^https:\/\/www\.(facebook|instagram)\.com\/[^@\s]+$/);
    }
  });

  it("in the logo row with a logo file that ships", () => {
    const rows = JSON.parse(read("src/content/giftGuideSponsorLogos.json")) as { name: string; logo?: string }[];
    for (const [, name] of NEW) {
      const row = rows.find((r) => r.name === name);
      expect(row?.logo, name).toBeTruthy();
      expect(existsSync(join(ROOT, "public", String(row?.logo))), name).toBe(true);
    }
  });

  it("on the sponsors guide as a card linking their own website, with a gift type", () => {
    const { picks } = JSON.parse(read("src/content/giftGuidePicks/25-days-sponsors.json")) as { picks: { name: string; href: string; image?: string; sponsor?: boolean }[] };
    for (const [, name, host] of NEW) {
      const card = picks.find((p) => p.name === name);
      expect(card?.sponsor, name).toBe(true);
      expect(new URL(String(card?.href)).host, name).toBe(host);
      expect(card?.image ?? "", name).toMatch(/\/gift-guides\/sponsors\/[a-z0-9-]+\.webp$/);
      expect(SPONSOR_GIFT_TYPES[name], name).toBeTruthy();
    }
  });

  it("no public prize carries an email, and the drift check drops the emailed hand-over clause", () => {
    for (const d of sponsorPage.lineup.days) for (const p of d.partners) expect(p.prize, `Dec ${d.day} ${p.brand}`).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    const src = blankComments(read("scripts/check-25days-lineup.mjs"));
    expect(src).toMatch(/const EMAIL_CLAUSE = /);
    expect(src).toMatch(/s = s\.replace\(EMAIL_CLAUSE, ""\);/);
  });
});
