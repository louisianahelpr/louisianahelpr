/**
 * Guide audits links-1122n/11 + content-1123/8 (sponsor cards with no photo) and links-1122n/12 (sponsor cards that
 * link to our own /25days page instead of the sponsor). 2026-11-24: Kart Ranch, Artivism Dance Theatre, Adage Pilates
 * Centre, SEEN and Teleflora get their logo (from each one's own site, owner rule logos-from-socials) as a clear
 * cutout in public/gift-guides/sponsor-picks/; Adage Pilates Centre and Teleflora link their own website.
 * What is left has no business page or logo we could find, so the lists below are EXACT (both ways): a new imageless or
 * /25days card fails, and fixing one fails until it leaves the list.
 *   - No photo: Bake & Brush (the only FB page found is unconfirmed as hers), Summar T. Photography (no business page),
 *     Victoria Nicole Fine Art Portraits (the one photo we have is a dark sample shoot, not a logo; owner's call).
 *   - Our /25days page: those three plus Breads and Sweets by Babs and Bayou Grace Outfitters (no page found).
 * The generator keeps them: scripts/gift-guide-holiday-b-1120.json sponsorLogoCards (image + href).
 *
 * @mutate src/content/giftGuidePicks/25-days-sponsors.json | "href":"https://www.teleflora.com/","image":"https://www.louisianahelpr.com/gift-guides/sponsor-picks/teleflora-logo.webp", | "href":"https://www.louisianahelpr.com/25days",
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Row = { name: string; brand?: string; href: string; image?: string; store?: string };
const CHUNK = JSON.parse(readFileSync("src/content/giftGuidePicks/25-days-sponsors.json", "utf8")) as { picks: Row[] };
const SPEC = JSON.parse(readFileSync("scripts/gift-guide-holiday-b-1120.json", "utf8")) as {
  sponsorLogoCards: Record<string, { gift: string; href?: string; image?: string }>;
};
const OUR_PAGE = "https://www.louisianahelpr.com/25days";
const SITE = "https://www.louisianahelpr.com";

describe("25 Days sponsor cards: a photo and the sponsor's own link", () => {
  it("only the sponsors with no logo found have no photo", () => {
    expect(CHUNK.picks.length).toBeGreaterThan(80);
    expect(CHUNK.picks.filter((p) => !p.image).map((p) => p.name).sort()).toEqual(
      ["Bake & Brush", "Summar T. Photography", "Victoria Nicole Fine Art Portraits"],
    );
  });

  it("only the sponsors with no page found link to our /25days page", () => {
    expect(CHUNK.picks.filter((p) => p.href === OUR_PAGE).map((p) => p.name).sort()).toEqual(
      ["Bake & Brush", "Bayou Grace Outfitters", "Breads and Sweets by Babs", "Summar T. Photography", "Victoria Nicole Fine Art Portraits"],
    );
  });

  it("every logo the cards and the generator name is a file we ship, and the generator agrees with the guide", () => {
    const ours = [...CHUNK.picks.map((p) => p.image), ...Object.values(SPEC.sponsorLogoCards).map((g) => g.image)]
      .filter((u): u is string => !!u && u.startsWith(`${SITE}/gift-guides/`));
    expect(ours.length).toBeGreaterThan(20);
    for (const u of ours) expect(existsSync(`public${u.slice(SITE.length)}`), u).toBe(true);
    for (const brand of ["Kart Ranch", "Artivism Dance Theatre", "Adage Pilates Centre", "SEEN", "Teleflora"]) {
      const card = CHUNK.picks.find((p) => p.brand === brand && p.store === "sponsor")!;
      expect(card.image, brand).toBe(SPEC.sponsorLogoCards[brand].image);
      expect(card.href, brand).toBe(SPEC.sponsorLogoCards[brand].href);
    }
  });
});
