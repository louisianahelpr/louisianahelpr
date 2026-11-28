// @mutate src/content/sponsorPage.ts | { brand: "Cure Hydration", prize: "Cure Hydration gift pack" }, | { brand: "Cure", prize: "Cure Hydration gift pack" },
// @mutate src/content/sponsorPage.ts | prize: "Escape room experience for 4 players (New Orleans): $205.70 digital gift card" | prize: "Escape room experience for 4 players (New Orleans, 1152 Camp St): $205.70 digital gift card"
// @mutate src/content/sponsorPage.ts | prize: "Louisiana tumbler + some stickers" | prize: "Louisiana tumbler + some stickers. Earlier: mug or tile"
// @mutate src/content/giftGuideSponsorLogos.json | {"name":"Fleurish Forever","slug":"fleurish-forever","group":"la","logo":"/gift-guides/sponsors/fleurish-forever.webp", | {"name":"Fleurish Forever","slug":"fleurish-forever","group":"la",
// @mutate src/content/giftGuideSponsorLogos.json | {"name":"Victoria Nicole Fine Art Portraits","slug":"victoria-nicole-fine-art-portraits","group":"la", | {"name":"Victoria Nicole Fine Art Portraits","slug":"victoria-nicole-fine-art-portraits","group":"la","logo":"/gift-guides/sponsors/victoria-nicole-fine-art-portraits.webp",
/**
 * 25 Days lineup sync, Thu 2026-11-26 (Desktop tracker ~/Desktop/Louisiana Helpr Tracker/data/sponsors.js, updatedAt
 * Thu Nov 26, 2026, 1:56 AM). Owner rule nothing-stale: the public lineup matches the tracker.
 *  - Cure Hydration (owner 11-26: credit it as a sponsor), Escape My Room and Fleurish Forever are in the lineup, have a
 *    business link, a logo on the gift-guides logo row (a clear cutout of their own logo, logos-from-socials) and a logo
 *    card on the 25 Days sponsors guide.
 *  - Victoria Nicole Fine Art Portraits stays on (owner 11-23) with no logo: her only saved image is a sample shoot.
 *  - Class guard: a tracker planning note never reaches a public prize ("owner 11-25: ...", "(... in hand)",
 *    ". Earlier: ...") and neither does a street address ("1152 Camp St"; the town is enough). The drift check
 *    (scripts/check-25days-lineup.mjs NOTE_PARENS) strips them; this reads every prize on the page.
 * The lineup's days are INTERNAL (sign-up tile counts); the public list stays undated A-Z.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sponsorPage } from "@/content/sponsorPage";
import { SPONSOR_GIFT_TYPES } from "@/content/giftGuideSponsorGiftTypes";

const ROOT = resolve(__dirname, "../..");
const SITE = "https://www.louisianahelpr.com";
const NEW = ["Cure Hydration", "Escape My Room", "Fleurish Forever"];
type Row = { name: string; logo?: string };
const rows = JSON.parse(readFileSync(join(ROOT, "src/content/giftGuideSponsorLogos.json"), "utf8")) as Row[];
const { picks } = JSON.parse(readFileSync(join(ROOT, "src/content/giftGuidePicks/25-days-sponsors.json"), "utf8")) as {
  picks: { name: string; href: string; image?: string; sponsor?: boolean }[];
};
const partners = sponsorPage.lineup.days.flatMap((d) => d.partners.map((p) => ({ day: d.day, brand: p.brand as string, prize: p.prize as string })));

/** Tracker planning notes and street addresses: never on the public page. */
const NOT_PUBLIC = [/\bowner \d{1,2}-\d{1,2}\b/i, /\bin hand\b/i, /\bEarlier:/, /\b\d+ [A-Z][a-z]+ (?:St|Ave|Blvd|Rd|Dr|Hwy)\b/];

describe("25 Days lineup matches the tracker after the 2026-11-26 changes", () => {
  it("the three new sponsors are in the lineup, linked, on the logo row with a logo and carded on the sponsors guide", () => {
    expect(NEW.length).toBeGreaterThan(2);
    for (const n of NEW) {
      expect(partners.some((p) => p.brand === n), n).toBe(true);
      expect(sponsorPage.lineup.links[n] ?? "", n).toMatch(/^https:\/\/www\.facebook\.com\//);
      const row = rows.find((r) => r.name === n);
      expect(row?.logo, n).toBeTruthy();
      expect(existsSync(join(ROOT, "public", row!.logo!)), n).toBe(true);
      const card = picks.find((p) => p.name === n);
      expect(card?.sponsor, n).toBe(true);
      expect(card?.href ?? "", n).toMatch(/^https:\/\//);
      expect(card?.image ?? "", n).toMatch(/^https:\/\/www\.louisianahelpr\.com\/gift-guides\/sponsor-picks\//);
      expect(existsSync(join(ROOT, "public", card!.image!.slice(SITE.length))), n).toBe(true);
      expect(SPONSOR_GIFT_TYPES[n], n).toBeTruthy();
    }
  });

  it("Victoria Nicole Fine Art Portraits is on (Dec 23) with no logo (her one image is a sample shoot)", () => {
    expect(partners.filter((p) => p.brand === "Victoria Nicole Fine Art Portraits").map((p) => p.day)).toEqual([23]);
    expect(rows.find((r) => r.name === "Victoria Nicole Fine Art Portraits")?.logo).toBeUndefined();
  });

  it("no public prize carries a tracker planning note or a street address (inventory floor)", () => {
    expect(partners.length).toBeGreaterThan(160);
    const bad = partners.filter((p) => NOT_PUBLIC.some((re) => re.test(p.prize) || re.test(p.brand))).map((p) => `${p.brand} | ${p.prize}`);
    expect(bad).toEqual([]);
  });
});
