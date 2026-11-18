/**
 * Gift guides, design audit round 2 (2026-11-18), the data fixes in the import (scripts/giftGuideRules.mjs):
 *   #1 a pick named with a web page title keeps its product part, or is hidden when it has none;
 *   #2 a pick that is only a store or brand name, a sale banner or a guide name is hidden;
 *   #5 Experiences guides hold only experiences, Gift Cards only gift cards (no free trial);
 *   lead decision: no knife in a general guide; no "Shop Louisiana" on Muck Boot or XTRATUF;
 *   #6 a stock line used on more than 3 products is blanked; #7 near-duplicate variants are folded;
 *   #8 the T3 Micro "Liquid error" photo is dropped; brands are cased (REI, UGG).
 * Each rule is checked on the rule itself and on every generated chunk.
 *
 * @mutate scripts/giftGuideRules.mjs |   if (parts.length > 1 && sameAsStore(parts[0].replace(/[®™]/g, ""))) return null; |
 * @mutate scripts/giftGuideRules.mjs | if (!first \|\| PROMO_NAME.test(first) \|\| | if (!first \|\|
 * @mutate scripts/giftGuideRules.mjs |   const kept = parts.filter((x) => !sameAsStore(x.replace(/[®™]/g, "")) && | const kept = parts.filter((x) => true &&
 * @mutate scripts/giftGuideRules.mjs |   if (slug === "gift-cards") return GIFT_CARD.test(p.name) && !NOT_A_GIFT.test(p.name); |
 * @mutate scripts/giftGuideRules.mjs |   if (EXPERIENCE_GUIDES.includes(slug)) return EXPERIENCE.test(p.name) && !NOT_A_GIFT.test(p.name); |
 * @mutate scripts/giftGuideRules.mjs |   if (/\bkni(fe\|ves)\b/i.test(p.name) && !KNIFE_OK_GUIDES.includes(slug)) return false; |
 * @mutate scripts/giftGuideRules.mjs | export const brokenImage = (u) => /liquid(%20\|\s\|\+)error/i.test(u) \|\| /[<>{}]/.test(u); | export const brokenImage = (u) => /[<>{}]/.test(u);
 * @mutate src/content/giftGuideCatalog.ts |  ${SEARCH_KEYWORDS[g.slug] ?? ""}`); | `);
 * @mutate src/content/giftGuideCatalog.ts | .sort(([a, i], [b, j]) => rank(a) - rank(b) \|\| i - j) | .sort(([, i], [, j]) => i - j)
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | {isShopMyCollection(pick.href) ? G.collectionOnShopMy : storeLabel(pick) ? | {false ? G.collectionOnShopMy : storeLabel(pick) ?
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SALES } from "@/content/giftGuidePicks";
import { SEARCH_KEYWORDS, searchGuides } from "@/content/giftGuideCatalog";
import { EXPERIENCE_GUIDES, KNIFE_OK_GUIDES, NOT_LOUISIANA_BUSINESS, PROMO_NAME, brokenImage, fitsGuide, productName } from "../../scripts/giftGuideRules.mjs";

const DIR = join(process.cwd(), "src/content/giftGuidePicks");
type Pick = { name: string; brand: string; line: string; href: string; image?: string; store?: string; louisianaFit?: true; sponsor?: true };
const CHUNKS: Record<string, Pick[]> = Object.fromEntries(
  readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => [f.replace(/\.json$/, ""), (JSON.parse(readFileSync(join(DIR, f), "utf8")) as { picks: Pick[] }).picks]),
);
const VIEW = readFileSync(join(process.cwd(), "src/pages/info/giftGuides/GiftGuideView.tsx"), "utf8");
/** Louisiana shops and 25 Days sponsors (no store page, not a ShopMy collection) keep their own words, on purpose. */
const local = (p: Pick) => !p.store && !p.href.startsWith("https://shopmy.us/");
const all = Object.entries(CHUNKS).flatMap(([slug, picks]) => picks.map((p) => ({ slug, p })));

describe("design audit r2: names are products", () => {
  it("cuts a page title down to its product part, or hides it", () => {
    expect(productName("The Quencher H2.0 FlowState Tumbler | 40 OZ", ["Stanley"], "stanley1913")).toBe("The Quencher H2.0 FlowState Tumbler, 40 OZ");
    expect(productName("Cheirosa 62™ Candle | Sol de Janeiro", ["Sol de Janeiro"], "soldejaneiro")).toBe("Cheirosa 62™ Candle");
    expect(productName("Monthly Fruit Delivery | Fruit of the Month Club | Harry & David", ["Harry & David"], "harryanddavid")).toBe("Monthly Fruit Delivery");
    for (const raw of [
      "Home | HamiltonBeach.com", "Christmas Gift Baskets Delivered 2024 | Harry & David",
      "Cyber Monday Beauty Deals 2025 | Ulta Beauty", "Black Friday Sale", "Holiday Gift Guide",
      "Running Shoes, Clothing, & Accessories | Saucony US", "Not Found Page | Kay", "Jared | Jared",
    ]) expect(productName(raw, [], "example"), raw).toBeNull();
    expect(productName("Designer Gifts |Michael Kors", ["Michael Kors"], "michaelkors")).toBeNull();
    // Owner 11-18 PM: category and collection pages named like products (Our Top 10 #2 was the first) never ship.
    // @mutate scripts/giftGuideRules.mjs |   if (CATEGORY_NAME.test(first)) return null; |   if (false) return null;
    // @mutate scripts/giftGuideRules.mjs |   if (parts.length > 1 && /\b\w+s & [\w' ]*\w+s$/i.test(first)) return null; |   if (false) return null;
    for (const raw of ["Skincare Routine Tools & LED Face Masks | Shark Beauty", "Food Processors & Choppers Products | KitchenAid US",
      "Kitchen & Cooking Gifts | ZWILLING.COM", "DKNY Women's Clothing & Accessories | Modern & Sophisticated Style | Macy's", "The Holiday Collection",
      "Serums, Cosmetics & Haircare, & More", "Luxury Japanese Skincare Products | Tatcha", "Educational Toys & Learning Toys from Fat Brain Toys",
      "Gifts & Value Sets", "Stand Mixer Accessories | KitchenAid US", "Wolferman’s Bakery: English Muffins, Baked Goods & Breakfast Gifts"]) expect(productName(raw, [], "example"), raw).toBeNull();
    // ... while real products with "&" or "Accessories" stay.
    for (const raw of ["Barbie Dreamhouse Dollhouse Playset with Pool and Themed Accessories", "Brown & Blue Glass Vase", "Griddler Grill & Panini Press",
      "36-Piece Griddle Accessories", "Pine & Eucalyptus Classic Scented Candle"]) expect(productName(raw, [], "example"), raw).toBe(raw);
    expect(productName("Jared | Your Jewelry Store for Engagement Rings", [], "jared")).toBeNull();
    expect(productName("Old Navy | Affordable Clothing for Women, Men, Kids & Baby", [], "oldnavy")).toBeNull();
    expect(productName("Kohl's | Shop Clothing, Shoes, Home, Kitchen, Bedding, Toys & More", ["Kohl's"], "kohls")).toBeNull();
    // A store or brand alone is no product.
    expect(productName("Omaha Steaks", ["Omaha Steaks"], "omahasteaks")).toBeNull();
    expect(productName("Bass Pro Shops", ["Bass Pro Shops"], "basspro")).toBeNull();
    // A product's model year and a planner's year stay.
    expect(productName("Kindle 16 GB (2024)", ["Amazon"], "amazon")).toBe("Kindle 16 GB (2024)");
    expect(productName("2027 Dreambook + Planner", ["Erin Condren"], "erincondren")).toBe("2027 Dreambook + Planner");
  });
  it("no generated pick (outside Louisiana shops and sponsors) is a page title, a promo, or just its brand", () => {
    expect(all.length).toBeGreaterThan(5000);
    const bad = all.filter(({ p }) => !local(p) && !p.sponsor && (/\s\|\s?|\s?\|\s/.test(p.name) || PROMO_NAME.test(p.name) || (p.brand && p.brand.toLowerCase() === p.name.toLowerCase())));
    expect(bad.map(({ slug, p }) => `${slug}: ${p.name}`).slice(0, 10)).toEqual([]);
  });
});

describe("design audit r2: what each guide holds", () => {
  it("Experiences hold experiences, Gift Cards hold gift cards, knives only in the kitchen guides", () => {
    expect(fitsGuide("gift-cards", { name: "Starbucks eGift Card" })).toBe(true);
    expect(fitsGuide("gift-cards", { name: "Try Prime free (30-day trial)" })).toBe(false);
    expect(fitsGuide("gift-cards", { name: "Walmart+ membership" })).toBe(false);
    expect(fitsGuide("swamp-and-bayou-tours", { name: "Cellular Trail Camera" })).toBe(false);
    expect(fitsGuide("swamp-and-bayou-tours", { name: "Cajun Pride Swamp Tour Ticket" })).toBe(true);
    expect(fitsGuide("dad", { name: "8-Inch Japanese Chef Knife" })).toBe(false);
    expect(fitsGuide("under-100", { name: "14-Piece Knife Block Set with Sharpener" })).toBe(false);
    expect(fitsGuide("home-cook", { name: "8-Inch Japanese Chef Knife" })).toBe(true);
    expect(fitsGuide("store-imarku", { name: "8-Inch Japanese Chef Knife" })).toBe(true);
    for (const { slug, p } of all) {
      if (slug.startsWith("store-")) continue;
      if (!KNIFE_OK_GUIDES.includes(slug)) expect(/\bkni(fe|ves)\b/i.test(p.name), `${slug}: ${p.name}`).toBe(false);
      if (EXPERIENCE_GUIDES.includes(slug) || slug === "gift-cards") expect(fitsGuide(slug, p), `${slug}: ${p.name}`).toBe(true);
    }
    expect(CHUNKS["gift-cards"]?.length ?? 0).toBeGreaterThan(0);
  });
  it("Muck Boot and XTRATUF keep their picks but carry no Shop Louisiana flag", () => {
    const boots = all.filter(({ p }) => [p.brand, p.store].some((x) => x && NOT_LOUISIANA_BUSINESS.test(x.replace(/^store-/, "").replace(/-/g, " "))));
    expect(boots.length).toBeGreaterThan(20);
    expect(boots.filter(({ p }) => p.louisianaFit).map(({ slug, p }) => `${slug}: ${p.name}`)).toEqual([]);
  });
});

describe("design audit r2: lines, variants, photos, brands", () => {
  it("no stock line sits on more than 3 different products; no near-duplicate variants in one guide", () => {
    const byLine = new Map<string, Set<string>>();
    for (const { p } of all) if (p.line) byLine.set(p.line, (byLine.get(p.line) ?? new Set()).add(p.name.toLowerCase()));
    expect([...byLine].filter(([, s]) => s.size > 3).map(([l, s]) => `${s.size}x ${l}`).slice(0, 5)).toEqual([]);
    for (const [slug, picks] of Object.entries(CHUNKS)) {
      if (slug.startsWith("store-")) continue;
      const keys = picks.map((p) => `${p.brand.toLowerCase().replace(/[^a-z0-9]/g, "")} ${p.name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "").slice(0, 24)}`);
      expect(keys.filter((k, i) => keys.indexOf(k) !== i), slug).toEqual([]);
    }
  });
  it("no 'Liquid error' photo (T3 Micro) and no mis-cased REI/UGG brand ships", () => {
    expect(brokenImage("https://t3micro.com/collections/Liquid%20error%20(snippets/social-meta-tags.liquid")).toBe(true);
    expect(brokenImage("https://cdn.shopify.com/s/files/1/a.jpg")).toBe(false);
    expect(all.filter(({ p }) => p.image && brokenImage(p.image))).toEqual([]);
    expect(all.filter(({ p }) => ["Rei", "Ugg", "Laneige", "Xtratuf"].includes(p.brand))).toEqual([]);
  });
  it("a ShopMy collection row says 'Collection on ShopMy', never names the collection as one product's store", () => {
    expect(all.filter(({ p }) => p.href.startsWith("https://shopmy.us/collections/")).length).toBeGreaterThan(100);
    expect(VIEW).toContain('{isShopMyCollection(pick.href) ? G.collectionOnShopMy : storeLabel(pick) ? G.onStore(storeLabel(pick)) : ""}');
  });
});

describe("design audit r2: sales and search", () => {
  it("#10 the Sales list has one line per link, and Gilt is one store", () => {
    expect(SALES.length).toBeGreaterThan(50);
    const hrefs = SALES.map((x) => x.href);
    expect(hrefs.filter((h, i) => hrefs.indexOf(h) !== i)).toEqual([]);
    expect([...new Set(SALES.filter((x) => /gilt/i.test(x.store)).map((x) => x.store))].length).toBeLessThan(2);
  });
  it("#11 'lsu', 'saints', 'boots' and 'nurse' find their guides; a title match ranks first", () => {
    const slugs = (q: string) => searchGuides(q).map((g) => g.slug);
    expect(Object.keys(SEARCH_KEYWORDS).length).toBeGreaterThan(5);
    expect(slugs("lsu")).toContain("purple-and-gold-lover");
    expect(slugs("saints")).toContain("game-day");
    expect(slugs("boots")).toContain("store-muck-boot");
    expect(slugs("nurse")).toEqual(expect.arrayContaining(["rns", "lpns"]));
    expect(slugs("mom")[0]).toBe("mom");
    // Every guide titled with the word comes before any guide that only matches through its lead or row.
    const inTitle = searchGuides("mom").map((g) => /mom/i.test(g.title));
    expect(inTitle.filter(Boolean).length).toBeGreaterThan(1);
    expect(inTitle.lastIndexOf(true)).toBeLessThan(inTitle.indexOf(false) === -1 ? Infinity : inTitle.indexOf(false));
    expect(inTitle.indexOf(false)).toBeGreaterThan(-1);
  });
});

describe("gift guides: featured order and Our Top 10 (owner 11-18 PM: \"This can't possibly be the top gifts\")", () => {
  const SCRIPT = readFileSync(join(process.cwd(), "scripts/gift-guide-picks.mjs"), "utf8");
  it("a guide's featured picks lead, Our Top 10 comes from the featured file, and no guide opens on two XTRATUF boots", () => {
    // @mutate scripts/gift-guide-picks.mjs |   const v = readJson("_featured-order.json"); |   const v = null;
    expect(SCRIPT).toContain('const v = readJson("_featured-order.json");');
    // @mutate scripts/gift-guide-picks.mjs | const topPicks = [...new Map([...featuredTop, ...lovedTop] | const topPicks = [...new Map([...lovedTop]
    expect(SCRIPT).toContain("const topPicks = [...new Map([...featuredTop, ...lovedTop]");
    expect(SCRIPT).toContain("for (const slug of Object.keys(guides)) guides[slug] = featuredFirst(slug, guides[slug]);");
    let guides = 0;
    for (const [slug, picks] of Object.entries(CHUNKS)) {
      if (slug.startsWith("store-")) continue;
      guides += 1;
      expect(picks.slice(0, 12).filter((p) => /^xtratuf$/i.test(p.brand)).length, slug).toBeLessThanOrEqual(1);
    }
    expect(guides).toBeGreaterThan(150);
  });
});
