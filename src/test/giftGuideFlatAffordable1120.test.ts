/**
 * Owner 11-20 night, read from the shipped chunks (src/content/giftGuidePicks) and the rules behind them:
 *   - "just remove the sections and make it one guide": the guide page draws no section heading and no section chips;
 *   - her tapped removals (scripts/gift-guide-owner-removals-1120.json) are on none of the guides she tapped them on;
 *   - "you're not spending 100 dollars on a gift for a friend": Friends & Coworkers holds nothing over $50, every other
 *     guide nothing over $100 except her own picks and keeps (store pages, budget tiers and the sponsors page aside);
 *   - "remove the color guides", "remove the pet guides": no chunk, no index row, and the catalog lists them as removed
 *     (GiftGuides.tsx sends a removed slug to the hub);
 *   - "we literally need just 1 crew dog in all guides": one Crew Dog item on the whole site, at most two of any brand a
 *     guide ("i said only 2 items from 1 brand": a hard two, her picks first, then the cheapest);
 *   - "a lot of the sponsor stuff does not fit in the guides": a 25 Days sponsor's items show only on the sponsors page
 *     and the Louisiana guides;
 *   - Fabletics photos are never the `model=p` photo.
 *
 * @mutate scripts/giftGuideOwner1120e.mjs |   if (slug === FRIENDS_GUIDE) return true; |   if (slug === FRIENDS_GUIDE) return false;
 * @mutate scripts/giftGuideRules.mjs |     if (ONE_ITEM_BRANDS[b]) { rows.forEach((r, n) => { if (ONE_ITEM_BRANDS[b] !== slug \|\| n > 0) cuts.add(r.p); }); continue; } |     if (ONE_ITEM_BRANDS[b]) continue;
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import { FRIENDS_GUIDE, FRIENDS_MAX, OWNER_KEPT, REMOVED_GUIDES_1120E, applyOwner1120e, overPrice, ownerKey, priceCapOf } from "../../scripts/giftGuideOwner1120e.mjs";
import { BRAND_MAX_1120E, brandCapCuts1120e, brandCapExempt1120e, brandOf1120e, sponsorBrands1120e, sponsorOff1120e } from "../../scripts/giftGuideRules.mjs";
import { FINDER_LOUISIANA_GUIDES } from "@/content/giftGuideExtras1120";
import { REMOVED_GUIDES } from "@/content/giftGuideCatalog";

type Pick = { name: string; brand?: string; href: string; image?: string; price?: number; ownerPick?: boolean; sectionId?: string; type?: string };
const DIR = "src/content/giftGuidePicks";
const CHUNKS = new Map<string, Pick[]>(readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, -5), (JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")) as { picks: Pick[] }).picks]));
const GUIDES = [...CHUNKS.entries()].filter(([slug]) => !slug.startsWith("store-"));
const SPEC = JSON.parse(readFileSync("scripts/gift-guide-owner-removals-1120.json", "utf8")) as { removals: Record<string, { key: string; name: string }[]> };
const kept = (p: Pick) => Boolean(p.ownerPick) || OWNER_KEPT.test(p.name);

describe("gift guides: one flat, affordable list (owner 11-20 night)", () => {
  it("the guide page draws one list: no section headings, no section chips", () => {
    const view = readFileSync("src/pages/info/giftGuides/GiftGuideView.tsx", "utf8");
    expect(view).toContain('<ol className="gg-list" data-gift-list="">');
    expect(view).not.toMatch(/gg-secnav|gg-sec-title|data-gift-section=/);
  });

  it("her tapped removals are on none of the guides she tapped them on", () => {
    expect(Object.keys(SPEC.removals).length).toBeGreaterThan(10);
    const back = Object.entries(SPEC.removals).flatMap(([slug, rows]) => {
      const keys = new Set(rows.map((r) => r.key));
      return (CHUNKS.get(slug) ?? []).filter((p) => keys.has(ownerKey(p.name))).map((p) => `${slug}: ${p.name}`);
    });
    expect(back).toEqual([]);
  });

  it("the items she removed everywhere (\"ok remove the ones i selected\", 10:20 PM) are on no guide and no store page", () => {
    const everywhere = new Set((SPEC as unknown as { everywhere: string[] }).everywhere);
    expect(everywhere.size).toBeGreaterThan(400);
    const back = [...CHUNKS.entries()].flatMap(([slug, picks]) => picks.filter((p) => everywhere.has(ownerKey(p.name))).map((p) => `${slug}: ${p.name}`));
    expect(back).toEqual([]);
    const pageList: Record<string, Pick[]> = { "store-yeti": [{ name: "Gone Mug", href: "x" }, { name: "Kept Mug", href: "y" }], "25-days-sponsors": [{ name: "Gone Mug", href: "x" }] };
    applyOwner1120e(pageList, { removals: {}, everywhere: ["gone-mug"] });
    expect(pageList["store-yeti"].map((p) => p.name)).toEqual(["Kept Mug"]);
    expect(pageList["25-days-sponsors"]).toEqual([]);
  });

  it("Friends & Coworkers holds nothing over $50, her picks included", () => {
    const friends = CHUNKS.get(FRIENDS_GUIDE) ?? [];
    expect(friends.length).toBeGreaterThan(3); // 8 after her 10:20 PM removals; never padded
    expect(FRIENDS_MAX).toBe(50);
    expect(friends.filter((p) => typeof p.price === "number" && p.price > FRIENDS_MAX).map((p) => `${p.name} $${p.price}`)).toEqual([]);
    expect(overPrice(FRIENDS_GUIDE, { name: "x", price: 51, ownerPick: true })).toBe(true);
    expect(overPrice(FRIENDS_GUIDE, { name: "x", price: 50 })).toBe(false);
  });

  it("no other guide holds an item over $100 unless she picked or kept it", () => {
    expect(priceCapOf("her")).toBe(100);
    expect(priceCapOf("store-hoka")).toBe(Infinity);
    expect(priceCapOf("gifts-by-budget")).toBe(Infinity);
    const over = GUIDES.flatMap(([slug, picks]) => picks.filter((p) => overPrice(slug, p)).map((p) => `${slug}: ${p.name} $${p.price}`));
    expect(over).toEqual([]);
    expect(overPrice("her", { name: "Plain Tote", price: 120 })).toBe(true);
    expect(overPrice("her", { name: "YETI Camino Carryall 35", price: 150 })).toBe(false);
    expect(overPrice("her", { name: "Plain Tote", price: 120, ownerPick: true })).toBe(false);
  });

  it("the color and pet guides are gone: no chunk, no index row, and their old links go to the hub", () => {
    expect(REMOVED_GUIDES_1120E).toEqual(expect.arrayContaining(["gifts-by-color", "pets", "dog-lover", "cat-person", "fish-lover", "pink-lover"]));
    expect(REMOVED_GUIDES_1120E.filter((s) => CHUNKS.has(s))).toEqual([]);
    expect(REMOVED_GUIDES_1120E.filter((s) => !(REMOVED_GUIDES as readonly string[]).includes(s))).toEqual([]);
    const index = readFileSync("src/content/giftGuideIndex.ts", "utf8");
    expect(index).not.toMatch(/group: "(Colors|Pets)"/);
    expect(REMOVED_GUIDES_1120E.filter((s) => new RegExp(`slug: "${s}"`).test(index))).toEqual([]);
    expect(readFileSync("public/sitemap.xml", "utf8")).not.toMatch(/gift-guides\/(gifts-by-color|pets)\b/);
    expect(readFileSync("src/pages/info/GiftGuides.tsx", "utf8")).toMatch(/if \(slug && !guide && !deals\) return <Navigate to="\/gift-guides" replace \/>/);
    const pageList: Record<string, Pick[]> = { pets: [{ name: "Dog Bed", href: "x" }], her: [{ name: "Mug", href: "y", price: 20 }] };
    applyOwner1120e(pageList, { removals: {} });
    expect(Object.keys(pageList)).toEqual(["her"]);
  });

  it("one Crew Dog item on the whole site, and at most two of a brand on a guide", () => {
    const crew = [...CHUNKS.entries()].flatMap(([slug, picks]) => picks.filter((p) => brandOf1120e(p) === "crewdog").map((p) => `${slug}: ${p.name}`));
    // At most one, and only on the sponsors page (she removed that one too at 10:20 PM, so none shows today).
    expect(crew.length).toBeLessThanOrEqual(1);
    expect(crew.filter((c) => !/^25-days-sponsors: /.test(c))).toEqual([]);
    expect(BRAND_MAX_1120E).toBe(2);
    const cut = GUIDES.filter(([slug]) => !brandCapExempt1120e(slug)).flatMap(([slug, picks]) => [...brandCapCuts1120e(slug, picks, kept)].map((p) => `${slug}: ${(p as Pick).name}`));
    expect(cut).toEqual([]);
    const rows: Pick[] = [{ name: "A", brand: "YETI", href: "a", price: 40 }, { name: "B", brand: "Yeti", href: "b", price: 20 }, { name: "C", brand: "YETI", href: "c", price: 30 }, { name: "Crew Dog Tee", brand: "Crew Dog", href: "d" }];
    expect([...brandCapCuts1120e("him", rows)].map((p) => (p as Pick).name).sort()).toEqual(["A", "Crew Dog Tee"]);
    expect([...brandCapCuts1120e("him", rows, (p: Pick) => p.name === "A")].map((p) => (p as Pick).name).sort()).toEqual(["C", "Crew Dog Tee"]);
    // "i said only 2 items from 1 brand" (10:07 PM): a hard two, so a third pick of hers leaves too (the dearest).
    expect([...brandCapCuts1120e("him", rows, () => true)].map((p) => (p as Pick).name).sort()).toEqual(["A", "Crew Dog Tee"]);
    const perBrand = GUIDES.filter(([slug]) => !brandCapExempt1120e(slug)).flatMap(([slug, picks]) => Object.entries(picks.reduce<Record<string, number>>((m, p) => { const b = brandOf1120e(p); if (b) m[b] = (m[b] ?? 0) + 1; return m; }, {})).filter(([, n]) => n > BRAND_MAX_1120E).map(([b, n]) => `${slug}: ${b} x${n}`));
    expect(perBrand).toEqual([]);
  });

  it("25 Days sponsor items show only on the sponsors page and the Louisiana guides", () => {
    const sponsors = sponsorBrands1120e(CHUNKS.get("25-days-sponsors"), (JSON.parse(readFileSync("scripts/gift-guide-train-1120b.json", "utf8")) as { nationalSponsors: { brand: string }[] }).nationalSponsors.map((x) => x.brand));
    expect(sponsors.has("hilma")).toBe(true);
    expect(sponsors.size).toBeGreaterThan(20);
    const louisiana = new Set<string>([...readFileSync("src/content/giftGuideIndex.ts", "utf8").matchAll(/group: "Louisiana"[^}]*?slug: "([^"]+)"/g)].map((m) => m[1]));
    for (const s of FINDER_LOUISIANA_GUIDES) expect(louisiana.has(s)).toBe(true);
    const strays = GUIDES.flatMap(([slug, picks]) => picks.filter((p) => sponsorOff1120e(slug, p, sponsors, louisiana)).map((p) => `${slug}: ${p.name}`));
    expect(strays).toEqual([]);
    expect(sponsorOff1120e("her", { name: "K18 Mask", brand: "K18 Hair" }, new Set(["k18hair"]), louisiana)).toBe(true);
    expect(sponsorOff1120e("shop-small-louisiana", { name: "K18 Mask", brand: "K18 Hair" }, new Set(["k18hair"]), louisiana)).toBe(false);
  });

  it("no Fabletics photo is the model=p photo", () => {
    const deals = readFileSync("src/content/giftGuideDeals.json", "utf8");
    const hits = [...CHUNKS.entries()].flatMap(([slug, picks]) => picks.filter((p) => /fabletics/i.test(p.image ?? "") && /[?&]model=p\b/.test(p.image ?? "")).map((p) => `${slug}: ${p.name}`));
    expect(hits).toEqual([]);
    expect(deals).not.toMatch(/cdn\.fabletics\.com[^"]*[?&]model=p\b/);
  });
});
