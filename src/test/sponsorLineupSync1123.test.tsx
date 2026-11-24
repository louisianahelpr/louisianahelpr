// @mutate src/content/sponsorPage.ts |           { brand: "Texas Beard Company", prize: "Beard Oil + Balm, winner's choice of scents" }, |           { brand: "Texas Beard Company", prize: "Beard Oil + Balm, winner's choice of scents" },\n          { brand: "RYSE", prize: "2 cases of RYSE Fuel (two 12-packs)" },
// @mutate src/content/sponsorPage.ts | { brand: "Teleflora", prize: | { brand: "Teleflora Inc", prize:
// @mutate src/content/sponsorPublicOff.mjs | "Sprinkle in Time Too", "Popsy Clothing"] | "Sprinkle in Time Too"]
// @mutate src/content/giftGuideSponsorLogos.json | {"name":"Kart Ranch","slug":"kart-ranch" | {"name":"Kart Ranch LLC","slug":"kart-ranch"
/**
 * 25 Days lineup sync, Mon 2026-11-23 (Desktop tracker ~/Desktop/Louisiana Helpr Tracker/data/sponsors.js and
 * Placements-1123.md Rounds 1-4). Owner rule nothing-stale: the public lineup matches the tracker.
 *  - RYSE: "2 cases of RYSE Fuel (two 12-packs)" per winner on exactly 10 days (Dec 1, 3, 4, 8, 9, 10, 11, 13, 15, 19),
 *    owner ~6:15 PM via lead. lineup.days is INTERNAL (sign-up tile counts); the public list stays undated.
 *  - Seven new sponsors are in the lineup, on the gift-guides logo row (no logo file yet: initials) and on the 25 Days
 *    sponsors guide as a logo card with a gift-type label (spec: scripts/gift-guide-holiday-b-1120.json sponsorLogoCards),
 *    except Adagio Teas, which is on the owner's guide blocklist (no guide card).
 *  - Popsy Clothing's sign-up form said "NOT OK on the wall": it is in src/content/sponsorPublicOff.mjs like Helping
 *    Hands and Sprinkle, so no public surface names it (lineup data, links, logo row).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sponsorPage } from "@/content/sponsorPage";
import { PUBLIC_OFF_SPONSORS } from "@/content/sponsorPublicOff.mjs";
import { SPONSOR_GIFT_TYPES } from "@/content/giftGuideSponsorGiftTypes";

const ROOT = resolve(__dirname, "../..");
const RYSE_DAYS = [1, 3, 4, 8, 9, 10, 11, 13, 15, 19];
const RYSE_PRIZE = "2 cases of RYSE Fuel (two 12-packs)";
const NEW = ["Artivism Dance Theatre", "Victoria Nicole Fine Art Portraits", "Kart Ranch", "Adagio Teas", "Adage Pilates Centre", "SEEN", "Teleflora"];

describe("25 Days lineup matches the tracker after the 2026-11-23 changes", () => {
  it("RYSE is on exactly its 10 days, each with the 2-case prize", () => {
    const days = sponsorPage.lineup.days;
    expect(days.length).toBe(25);
    const ryse = days.flatMap((d) => d.partners.filter((p) => p.brand === "RYSE").map((p) => ({ day: d.day, prize: p.prize })));
    expect(ryse.map((r) => r.day)).toEqual(RYSE_DAYS);
    for (const r of ryse) expect(r.prize, `Dec ${r.day}`).toBe(RYSE_PRIZE);
  });

  it("the seven new sponsors are in the lineup, the logo row and the sponsors guide (inventory floor)", () => {
    expect(NEW.length).toBeGreaterThan(6);
    const brands = new Set<string>(sponsorPage.lineup.days.flatMap((d) => d.partners.map((p): string => p.brand)));
    const rows = JSON.parse(readFileSync(join(ROOT, "src/content/giftGuideSponsorLogos.json"), "utf8")) as { name: string }[];
    const { picks } = JSON.parse(readFileSync(join(ROOT, "src/content/giftGuidePicks/25-days-sponsors.json"), "utf8")) as { picks: { name: string; href: string; sponsor?: boolean }[] };
    for (const n of NEW) {
      expect(brands.has(n), n).toBe(true);
      expect(rows.some((r) => r.name === n), n).toBe(true);
      const card = picks.find((p) => p.name === n);
      if (n === "Adagio Teas") {
        // On the owner's guide blocklist since 11-19 (scripts/giftGuideBlocklist.mjs): no guide card, lineup only.
        expect(card, n).toBeUndefined();
        continue;
      }
      expect(card?.sponsor, n).toBe(true);
      expect(card?.href ?? "", n).toMatch(/^https:\/\//);
      expect(SPONSOR_GIFT_TYPES[n], n).toBeTruthy();
    }
  });

  it("Popsy Clothing (NOT OK on the wall) is on no public surface", () => {
    expect(PUBLIC_OFF_SPONSORS).toContain("Popsy Clothing");
    const brands = sponsorPage.lineup.days.flatMap((d) => d.partners.map((p): string => p.brand));
    expect(brands.length).toBeGreaterThan(150);
    expect(brands.filter((b) => /popsy/i.test(b))).toEqual([]);
    expect(Object.keys(sponsorPage.lineup.links).filter((b) => /popsy/i.test(b))).toEqual([]);
    for (const f of ["src/content/giftGuideSponsorLogos.json", "src/content/giftGuidePicks/25-days-sponsors.json", "src/content/giftGuideSearchIndex.json"]) {
      expect(readFileSync(join(ROOT, f), "utf8"), f).not.toMatch(/popsy/i);
    }
  });
});
