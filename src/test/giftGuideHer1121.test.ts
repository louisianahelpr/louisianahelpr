/**
 * For Her is EXACTLY the owner's 36 saves (owner 2026-11-21: 11 from her Amazon list, 11 from her Amazon cart, 14 from her
 * ShopMy links;
 * scripts/giftGuideHer1121.mjs). The generated page (src/content/giftGuidePicks/her.json) holds those links and no
 * other, in one flat list (no section), cheapest first; an Amazon pick never carries a price and keeps Amazon's own
 * photo; every ShopMy pick shows its checked price and a transparent cutout. The page shows no relationship chips and
 * no deals-and-codes box on For Her, and /mom, /wife ... still build from the same list.
 *
 * @mutate scripts/giftGuideHer1121.mjs |   return rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.sortPrice - b.r.sortPrice \|\| a.i - b.i).map(({ r }) => { |   return rows.map((r, i) => ({ r, i })).map(({ r }) => {
 * @mutate scripts/giftGuideHer1121.mjs |     if (!isAmazon(r)) Object.assign(p, { price, priceAt: HER_PRICE_AT }); |     Object.assign(p, { price, priceAt: HER_PRICE_AT });
 * @mutate scripts/giftGuideHer1121.mjs |     const p = { ...rest, image: isAmazon(r) ? r.image : cutoutPhoto(r.image), ownerPick: true, from: HER_GUIDE }; |     const p = { ...rest, image: r.image, ownerPick: true, from: HER_GUIDE };
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       {!isOwnerList(guide.slug) && <PeopleChips guide={guide} />} |       <PeopleChips guide={guide} />
 * @mutate src/content/giftGuidePeople.mjs | export const OWNER_LIST_GUIDES = ["her", "him", "kids"]; | export const OWNER_LIST_GUIDES = [];
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HER_1121, her1121Picks } from "../../scripts/giftGuideHer1121.mjs";
import { CUTOUT_BASE } from "../../scripts/giftGuideCutouts1120.mjs";
import { PEOPLE_GUIDES, isOwnerList } from "@/content/giftGuidePeople.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
type Pick = { name: string; href: string; image?: string; store?: string; price?: number; priceAt?: string; section?: string; sectionId?: string; rels?: string[]; band?: number };
const page = (JSON.parse(readFileSync(join(ROOT, "src", "content", "giftGuidePicks", "her.json"), "utf8")).picks ?? []) as Pick[];

/** The owner's saves, copied from her Desktop notes (Her-saved-amazon-1121.md, Her-saved-shopmy-1121.md), not from the module. */
const AMAZON_ASINS = ["B0D3L9BYFZ", "B0CPB1MWMP", "B0FVFV7V1R", "B0FFMJMB6K", "B0FDKC619F", "B0C246HFWN", "B0FPCH9S11", "B0HJVYHH35", "B0FKN7FGPY", "B0B1RWJ4QJ"];
/** Her Amazon cart saves (Her-saved-amazon-cart-1121.md; owner 2026-11-21: "we can have more than 25 items its fine"). */
const CART_ASINS = ["B0CWRFQCWF", "B0CCWSGSCT", "B0D82LVR3N", "B0CDF7GJ4Y", "B08X8P91FX", "B0C7LTPXBV", "B0D7TR9PBZ", "B0F5N7S36V", "B0H42QZ8BW", "B0H2D9Q7CV"];
const SHOPMY_PINS = ["p-108613972", "p-108613754", "p-108613500", "p-108613356", "p-108613192", "p-108612982", "p-108611500", "p-108610992", "p-108609900", "p-108607824", "p-107555566", "p-108605514", "p-108604684", "p-108604054"];
/**
 * Commission switches 11-21 (owner: "if the items on the guides can we fund at another place for higher commison just
 * change the link"; Desktop note Commission-switches-1121.md): the same item at the same price, moved from Amazon to a
 * better-paying store. TATCHA Kissu (Amazon B08D3FXF64, 10%) -> Tatcha 20%; L'OCCITANE Shea Butter Classics (Amazon
 * B0HFYLTJR7, 10%) -> Anthropologie 15%.
 */
const SWITCHED_PINS = ["p-108732256", "p-108732809"];
const SAVED = new Set([...[...AMAZON_ASINS, ...CART_ASINS].map((a) => `https://www.amazon.com/dp/${a}?tag=louisianahelpr-20`), ...[...SHOPMY_PINS, ...SWITCHED_PINS].map((p) => `https://go.shopmy.us/${p}`)]);
const isAmazon = (p: Pick) => p.store === "store-amazon" || /^https:\/\/(www\.)?amazon\.com\//.test(p.href);

describe("For Her = the owner's saves (11-21)", () => {
  it("the page holds exactly her 36 links, once each, and nothing else", () => {
    expect(SAVED.size).toBe(36);
    expect(page.length).toBe(36);
    expect(new Set(page.map((p) => p.href))).toEqual(SAVED);
  });

  it("the generated page is exactly what the module builds (re-run scripts/gift-guide-picks.mjs after a change)", () => {
    expect(page).toEqual(her1121Picks());
  });

  it("is one flat list, cheapest first by the price she saw", () => {
    for (const p of page) {
      expect(p.section, p.name).toBeUndefined();
      expect(p.sectionId, p.name).toBeUndefined();
      // No budget band either: the budget chips stay off this list.
      expect(p.band, p.name).toBeUndefined();
    }
    const seen = new Map(HER_1121.map((r) => [r.href, r.sortPrice]));
    const prices = page.map((p) => seen.get(p.href) as number);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(page[0].name).toMatch(/leggings/i);
    expect(page[page.length - 1].name).toMatch(/currentbody/i);
    // The module sorts by itself: fed in reverse, it still lists cheapest first.
    const again = her1121Picks([...HER_1121].reverse()).map((p) => seen.get(p.href) as number);
    expect(again).toEqual([...again].sort((a, b) => a - b));
  });

  it("an Amazon pick never carries a price and keeps Amazon's own photo; a ShopMy pick shows its checked price and a cutout", () => {
    const amazon = page.filter(isAmazon);
    const shopmy = page.filter((p) => !isAmazon(p));
    expect(amazon.length).toBe(20);
    expect(shopmy.length).toBe(16);
    for (const p of amazon) {
      expect(p.price, p.name).toBeUndefined();
      expect(p.priceAt, p.name).toBeUndefined();
      expect(p.image, p.name).toMatch(/^https:\/\/m\.media-amazon\.com\/images\/I\//);
    }
    for (const p of shopmy) {
      expect(p.price, p.name).toBeGreaterThan(0);
      expect(p.priceAt, p.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.image?.startsWith(CUTOUT_BASE), `${p.name}: ${p.image}`).toBe(true);
      const file = join(ROOT, "public", "gift-guides", "cutouts", String(p.image).slice(CUTOUT_BASE.length));
      expect(existsSync(file), file).toBe(true);
      const head = readFileSync(file).subarray(0, 32);
      expect(head.subarray(12, 16).toString("latin1") === "VP8X" && (head[20] & 0x10) !== 0, `${file} has no alpha`).toBe(true);
    }
  });

  it("no relationship chips or deals box on For Her and its relationship pages; each relationship page still has picks", () => {
    const her = PEOPLE_GUIDES.find((g) => g.slug === "her");
    expect(isOwnerList("her")).toBe(true);
    expect(isOwnerList("him")).toBe(true);
    expect(isOwnerList("kids")).toBe(true);
    expect(isOwnerList("teens")).toBe(false);
    for (const r of her?.rels ?? []) {
      expect(isOwnerList(r.slug), r.slug).toBe(true);
      expect(page.filter((p) => p.rels?.includes(r.slug)).length, r.slug).toBeGreaterThan(10);
    }
    expect(isOwnerList("dad")).toBe(true);
    const view = blankComments(readFileSync(join(ROOT, "src", "pages", "info", "giftGuides", "GiftGuideView.tsx"), "utf8"));
    expect(view).toContain("{!isOwnerList(guide.slug) && <PeopleChips guide={guide} />}");
    expect(view).toMatch(/after=\{isOwnerList\(guide\.slug\) \? null : <DealsAndCodes/);
  });

  it("the generator sets For Her after the final sweep (so no rule can drop one of hers) and before writing the pages", () => {
    const gen = blankComments(readFileSync(join(ROOT, "scripts", "gift-guide-picks.mjs"), "utf8"));
    const sweep = gen.indexOf("console.log(`gift-guide-picks: final sweep");
    const last = gen.lastIndexOf("applyHer1121(pageList, storeList)");
    const write = gen.indexOf("writeFileSync(new URL(`${slug}.json`, chunkDir)");
    expect(sweep).toBeGreaterThan(0);
    expect(last).toBeGreaterThan(sweep);
    expect(write).toBeGreaterThan(last);
  });
});
