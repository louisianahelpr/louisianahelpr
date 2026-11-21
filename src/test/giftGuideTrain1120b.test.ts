/**
 * Gift guides train 1120b (lead 44, 2026-11-20), read from the shipped chunks, the deals files, the sponsor logo row's
 * data and the train's rule module (scripts/giftGuideTrain1120b.mjs, rules in scripts/gift-guide-train-1120b.json):
 *   - the re-audit's Highs are gone: blank or 404 photos, the BedJet in "Under $100", Milk Bar in the Louisiana sweets,
 *     the Walmart house brands in its deals box, the MX Master twice;
 *   - a national 25 Days sponsor holds at most ONE guide spot with the sponsor badge (owner 11-20 9:33 PM: a sponsor
 *     is guaranteed no spot; SRI Labs, Arey and Oyu Botanica live on the sponsors guide only), outside a guide's first
 *     row of cards except where the plan orders it there (owner 11-20 ~8:45 AM: not covers, not the Top 10);
 *   - "Our 25 Days sponsors": every lineup sponsor once, A to Z, each logo file on disk, links internal or https;
 *   - Microtel and Wingate appear nowhere; no gift over $500 is added; the rules themselves.
 *
 * @mutate scripts/giftGuideTrain1120b.mjs |   return rule.exact ? n === m : n.includes(m) |   return n.includes(m)
 * @mutate scripts/giftGuideTrain1120b.mjs |     const out = new Set(hit.slice(r.keep)); |     const out = new Set(hit.slice(r.keep + 1));
 */
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import { SALES } from "@/content/giftGuidePicks";
import { peopleGuideOf } from "@/content/giftGuidePeople.mjs";
import { STORE_PAGES_KEPT } from "@/content/giftGuideMerges.mjs";
import { DROPPED_SPONSORS } from "../../scripts/gift-guide-sponsor-logos.mjs";
import { applyDealsPage1120b, applyTrain1120b, isBrandPick, matches, placeInSection } from "../../scripts/giftGuideTrain1120b.mjs";

type Pick = { name: string; brand?: string; href: string; image?: string; section?: string; sectionId?: string; sponsor?: boolean; store?: string; commission?: number | null; price?: number };
type Deal = { title: string; href: string; ends?: string; items?: { name: string; href: string }[] };
const DIR = "src/content/giftGuidePicks";
const CHUNKS = new Map<string, { picks: Pick[]; deals?: Deal[] }>(readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"))]));
const picks = (slug: string) => CHUNKS.get(slug)?.picks ?? [];
const SPEC = JSON.parse(readFileSync("scripts/gift-guide-train-1120b.json", "utf8"));
const guideChunks = [...CHUNKS].filter(([s]) => !s.startsWith("store-") && s !== "25-days-sponsors");

describe("gift guides train 1120b", () => {
  it("the re-audit's Highs are gone", () => {
    // Amazon's 43-byte placeholder photos (images/P/<asin> for these four ASINs) and the 404/403 photos.
    const all = [...CHUNKS.values()].flatMap((c) => c.picks);
    for (const asin of ["B07482WH6L", "B074F3LQ8Y", "B0D8PJXM78", "B0DL3JZ4L9"]) expect(all.some((p) => (p.image ?? "").includes(`/images/P/${asin}`)), asin).toBe(false);
    expect(all.some((p) => /img\.tjmaxx\.com/.test(p.image ?? "")), "TJX blocks hotlinked photos").toBe(false);
    expect(all.some((p) => /skeletool_cx/i.test(p.image ?? "")), "Skeletool CX photo 404").toBe(false);
    const splurge = picks("splurge");
    expect(splurge.find((p) => /BedJet/.test(p.name))?.section).toBe("$100 & Up");
    expect(picks("louisiana-food-gifts").some((p) => /milk bar/i.test(p.name))).toBe(false);
    expect(picks("work-life").some((p) => /MX Master/.test(p.name))).toBe(false);
    expect(guideChunks.flatMap(([, c]) => c.picks).filter((p) => /MX Master 3S/.test(p.name))).toHaveLength(1);
  });

  it("the Walmart deals box holds no house brand, furniture or marketplace single, and the sidebar no dropped deal", () => {
    const deals = CHUNKS.get("store-walmart")?.deals ?? [];
    const text = JSON.stringify(deals);
    expect(text).not.toMatch(/Better Homes|Holiday Time|Athletic Works|Free Assembly|Vibrant Life|Mainstays|Great Value|\bonn\.|Time and Tru/i);
    expect(deals.some((d) => !d.items && /mavely\.app\.link/.test(d.href))).toBe(false);
    expect(deals.some((d) => d.title === "Festive Dining Room Picks")).toBe(false);
    const kept = new Set(deals.map((d) => d.href));
    expect(SALES.filter((s) => s.slug === "store-walmart" && !kept.has(s.href))).toEqual([]);
    expect(SALES.find((s) => s.store === "Georgia Boot")).toMatchObject({ ends: "2026-11-25", slug: "store-georgia-boot" });
  });

  it("a national 25 Days sponsor holds at most one guide spot, badged; a sponsors-only brand holds none and stays on the sponsors guide", () => {
    // Owner 11-20 9:33 PM: being a 25 Days sponsor guarantees no spot on a regular guide ("there are more popular
    // items ... even if they are our sponsor they can be removed"). A spot the plan keeps is still one spot, badged.
    // The plan (the owner's standard, later than her 8:45 AM first-row rule) orders these four into a first row.
    // EXACT: a sponsor that moves down, or a new one that moves up, changes this list.
    const FIRST_ROW_BY_PLAN = new Set(["RYSE", "Boston Mints", "Rock Bottom Golf", "Sky & Sol"]);
    const sponsorsGuide = picks("25-days-sponsors");
    let held = 0;
    for (const s of SPEC.nationalSponsors as { brand: string; guide: string; sponsorsOnly?: boolean }[]) {
      const spots = guideChunks.flatMap(([slug, c]) => c.picks.filter((p) => isBrandPick(p, s.brand) || (s.brand === "FELCO North America" && /felco/i.test(p.name))).map((p) => ({ slug, p })));
      if (s.sponsorsOnly) {
        expect(spots.map((x) => `${x.slug}: ${x.p.name}`), s.brand).toEqual([]);
        expect(sponsorsGuide.filter((p) => isBrandPick(p, s.brand)).length, s.brand).toBe(1);
        continue;
      }
      expect(spots.length, s.brand).toBeLessThanOrEqual(1);
      if (!spots.length) continue;
      held += 1;
      // For Her / For Him (owner 11-20 evening): a sponsor placed on Mom or Dad sits on For Her or For Him.
      expect(spots[0].slug, s.brand).toBe(peopleGuideOf(s.guide) ?? s.guide);
      const { p } = spots[0];
      expect(p.sponsor, s.brand).toBe(true);
      const list = picks(peopleGuideOf(s.guide) ?? s.guide);
      // Not in a guide's first row (its first 8 cards), except where the plan itself orders it there.
      expect(list.indexOf(p) < 8, s.brand).toBe(FIRST_ROW_BY_PLAN.has(s.brand));
      expect(p.image, s.brand).toMatch(/^https:\/\//);
    }
    // Not vacuous: the plan still keeps most sponsors' spots.
    expect(held).toBeGreaterThanOrEqual(20);
    expect((SPEC.nationalSponsors as { brand: string; sponsorsOnly?: boolean }[]).filter((x) => x.sponsorsOnly).map((x) => x.brand).sort()).toEqual(["Arey", "Oyu Botanica", "SRI Labs"]);
  });

  it("the sponsor logo row lists every lineup sponsor once, A to Z, with real logo files and safe links", () => {
    const rows = JSON.parse(readFileSync("src/content/giftGuideSponsorLogos.json", "utf8")) as { name: string; slug: string; logo?: string; href: string; external?: boolean }[];
    const src = readFileSync("src/content/sponsorPage.ts", "utf8");
    const lineup = new Set([...src.matchAll(/\{ brand: "([^"]+)", prize:/g)].map((m) => m[1]).filter((b) => b !== "Louisiana Helpr" && !DROPPED_SPONSORS.has(b)));
    // Holiday audit B (11-20): a sponsor the owner dropped (R&R Wedding Co.) has no logo here, even while the public
    // lineup still lists it.
    expect(rows.length).toBe(lineup.size);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(rows.length);
    expect(rows.map((r) => r.name)).toEqual([...rows.map((r) => r.name)].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
    for (const r of rows) {
      if (r.logo) expect(existsSync(`public${r.logo}`), r.logo).toBe(true);
      expect(r.href, r.name).toMatch(r.external ? /^https:\/\// : /^\/gift-guides\//);
      expect(JSON.stringify(r), r.name).not.toMatch(/\bdec(ember)?\s*\d|\bday \d/i);
    }
    // The declined logo stays off (Sprinkle in Time Too declined logo use).
    expect(rows.find((r) => /sprinkle/i.test(r.name))?.logo).toBeUndefined();
  });

  it("Microtel and Wingate appear nowhere; store pages keep 10-15 picks (two dated exceptions)", () => {
    const everything = [...CHUNKS.values()].map((c) => JSON.stringify(c)).join("\n") + readFileSync("src/content/giftGuideSponsorLogos.json", "utf8") + readFileSync("src/content/giftGuideDeals.json", "utf8");
    expect(everything).not.toMatch(/microtel|wingate/i);
    // 2026-11-20: TJ Maxx's photos are hotlink-blocked (6 out) and JCPenney's house-brand picks are out; both wait for
    // a refill. EXACT: a refill lowers or clears these.
    const SHORT: Record<string, number> = {};
    for (const s of STORE_PAGES_KEPT) {
      const n = picks(s).length;
      if (SHORT[s] !== undefined) expect(n, s).toBe(SHORT[s]);
      else expect(n, s).toBeGreaterThanOrEqual(10);
    }
  });

  it("the rules: match, keep, type caps, moves into a section, sponsors once, the deals page", () => {
    expect(matches({ name: "Breville Bambino Plus Espresso Machine" }, { match: "Breville Bambino Espresso Machine", exact: true })).toBe(false);
    expect(matches({ name: "Café Du Monde Beignet Mix" }, { match: "Cafe Du Monde Beignet" })).toBe(true);
    const list = [{ name: "A", href: "a", section: "One" }, { name: "B", href: "b", section: "Two" }, { name: "C", href: "c", section: "Two", sectionId: "two" }];
    expect(placeInSection(list, { name: "X", href: "x" }, "Two").map((p: { name: string }) => p.name)).toEqual(["A", "B", "C", "X"]);
    expect(placeInSection(list, { name: "X", href: "x" }, "Two")[3]).toMatchObject({ section: "Two", sectionId: "two" });
    const pages: Record<string, Pick[]> = {
      g: [{ name: "Owala FreeSip Pink", href: "1", commission: 9 }, { name: "Owala FreeSip Blue", href: "2", commission: 8 }, { name: "Mug", href: "3", type: "mug", commission: 7 } as Pick, { name: "Mug 2", href: "4", type: "mug", commission: 6 } as Pick, { name: "Mug 3", href: "5", type: "mug", commission: 5 } as Pick],
      h: [{ name: "Thing", href: "6", section: "Top picks" }, { name: "Other", href: "7", section: "Later" }, { name: "LMNT Variety Pack", brand: "LMNT", href: "8", section: "Later" }],
      "25-days-sponsors": [{ name: "LMNT Variety Pack", brand: "LMNT", href: "https://drinklmnt.com/", image: "https://x/l.jpg" }],
    };
    const spec = {
      keep: [{ guide: "g", match: "Owala FreeSip", keep: 1 }],
      typeCaps: [{ guide: "g", type: "mug", max: 2 }],
      nationalSponsors: [{ brand: "LMNT", guide: "g", fromSponsorsGuide: "LMNT", line: "Electrolytes." }],
      cuts: [{ guide: "h", match: "Nothing here" }],
    };
    const r = applyTrain1120b(pages, {}, spec, { sponsorsGuide: "25-days-sponsors", readJson: () => [], sales: [] });
    expect(pages.g.map((p) => p.name)).toEqual(["Owala FreeSip Pink", "Mug", "Mug 2", "LMNT Variety Pack"]);
    expect(pages.g[3]).toMatchObject({ sponsor: true, commission: 0, line: "Electrolytes." });
    expect(pages.h.some((p) => /LMNT/.test(p.name))).toBe(false);
    expect(r.missing).toEqual(["cut: h Nothing here"]);
    const d = applyDealsPage1120b([{ brand: "Casper", category: "Home", item: "Casper Snug Mattress" }, { brand: "Huk", category: "Outdoors", item: "Boots" }], {
      drop: [{ brand: "Casper", item: "Snug Mattress" }], add: [{ brand: "Georgia Boot", category: "Outdoors", item: "Boot" }],
    });
    expect(d.deals.map((x: { brand: string }) => x.brand)).toEqual(["Huk", "Georgia Boot"]);
  });

  it("the BF/CM deals page: the weak featured items are out and Georgia Boot is in Outdoors", () => {
    const deals = JSON.parse(readFileSync("src/content/giftGuideDeals.json", "utf8")) as { brand: string; category: string; item?: string; ends?: string }[];
    expect(deals.some((x) => /Snug Mattress|iPhone 17|Skeletool CX|Barista Express/.test(x.item ?? ""))).toBe(false);
    expect(deals.find((x) => x.brand === "Georgia Boot")).toMatchObject({ category: "Outdoors", ends: "2026-11-25" });
  });
});
