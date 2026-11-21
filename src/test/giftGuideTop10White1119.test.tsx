/**
 * OWNER REQUESTS 11-19 ON THE GIFT GUIDES (screenshots): "remove the white around these images" (product photos sat in
 * white squares inside the cream cards), "be sure there are the top 10 best sellers" (the Top 10 showed nurse clogs and
 * compression socks: the fit audit's bare "top-10" names replaced the featured file's { guide, name } pairs, so nothing
 * resolved and "most loved" career picks filled the row), "all items and buttons need to be on the same row spacing"
 * (Shop buttons at different heights), and the content rules that followed: banned brands (Ying Mart, Brooklyn Delhi,
 * eCreamery, AimHave, Minteefy, Mosaic Weighted Blankets), no model years, food only on food guides (moved to Treats &
 * Food Gifts), no magazines, women's Sperrys, Life is Good, Bass Pro home decor or off-brand decor on the people guides,
 * nixplay canvas / photo book, the Ring doorbell and CHORD's plaid cap where they do not belong, and no shared top-12
 * pick between sibling guides (mom / wife ...). Reads the rules, the styles, PickThumb and every generated chunk.
 * Owner 11-21: the landing shows no Top 10 any more (only Her, Him and Kids are live,
 * src/content/giftGuideLive.mjs), so its landing-note test is gone; TOP_PICKS's own rules stay.
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | img.gg-thumb{background:transparent;border:0;mix-blend-mode:multiply} | img.gg-thumb{background:transparent;border:0}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | .gg-topcard .gg-photo{border-radius:14px;background:#fff} | .gg-topcard .gg-photo{border-radius:14px}
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | onLoad={(e) => { if (photoFailed(e.currentTarget)) setFailed(true); }} | onLoad={() => undefined}
 * @mutate scripts/giftGuideRules.mjs |   if (decorOff(slug, p) \|\| foodOff(slug, p) \|\| | if (decorOff(slug, p) \|\|
 * @mutate scripts/giftGuideRules.mjs |   if (OLD_YEAR_BARE.test(n)) return ""; |   if (false) return "";
 * @mutate scripts/giftGuideRules.mjs | export const drugstoreOff = (slug, p) => !slug.startsWith("store-") && | export const drugstoreOff = (slug, p) => false &&
 * @mutate scripts/giftGuideBlocklist.mjs |   "Ying Mart", "YingMart", "Brooklyn Delhi", | "YingMart",
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";
import { PickThumb } from "@/pages/info/giftGuides/GiftGuideView";
import { TOP_PICKS } from "@/content/giftGuidePicks";
import { GUIDE_INDEX } from "@/content/giftGuideIndex";
import { blockedBrand } from "../../scripts/giftGuideBlocklist.mjs";
import {
  FOOD_GUIDES, GUIDE_GROUPS, SIBLING_FAMILIES, SIBLING_TOP, TREATS_GUIDE, decorOff, foodOff, isFood, lifeIsGoodOff, magazineOff, modelYearName,
  namesModelYear, outdoorDecorOff, personalGiftOff, siblingOverlap, sperryOff, drugstoreOff, characterCollab, resaleOrUkShop, kidsCrocsOff, masonOff, redoneOff, lashOff, veraBradleyOff, hikingOff, cheapSockOff, barwareOff, fashionSneakerOff, LASH, legoOff, farmRioOff, isFoodSub, foodSubOff, iceCreamOff, crockPotOff, DIGITAL_FRAME, PHOTO_PRODUCT, JIGSAW, groceryCandyOff,
} from "../../scripts/giftGuideRules.mjs";
import type { CatalogPick } from "@/content/giftGuideCatalog";
import { sectionChunks, sectionPageOf } from "./helpers/giftGuideSections";

for (const g of GUIDE_INDEX) GUIDE_GROUPS.set(g.slug, g.group);
type Pick = { name: string; brand?: string; href: string; image?: string; price?: number; store?: string; ownerPick?: true };
// Big batch 1120: each merged guide's section under its old slug (helpers/giftGuideSections.ts).
const chunk = (slug: string): Pick[] => sectionPageOf<Pick>(slug);
const slugs = Object.keys(sectionChunks());
const guides = slugs.filter((s) => !s.startsWith("store-") && s !== "25-days-sponsors");
// The owner's own picks (ownerPick) are exempt from every rule (owner 11-19).
const offenders = (rule: (slug: string, p: Pick) => boolean) =>
  guides.flatMap((s) => chunk(s).filter((p) => !p.ownerPick && rule(s, p)).map((p) => `${s}: ${p.name}`));

// Owner 11-20 ("none of the images should have a background"): the photo box is white now, not cream; the photo still
// multiplies onto it, so a white product shot shows no box at all (giftGuideCalmCards1120.test.tsx guards the class).
describe("gift guides 11-19/11-20: photos sit on a plain white box with no border", () => {
  it("the white is on the photo box and the photo multiplies onto it; the store tile keeps its own look", () => {
    expect(GIFT_GUIDES_CSS).toContain("img.gg-thumb{background:transparent;border:0;mix-blend-mode:multiply}");
    expect(GIFT_GUIDES_CSS).toContain(".gg-topcard .gg-photo{border-radius:14px;background:#fff}");
    expect(GIFT_GUIDES_CSS).toContain(".gg-list .gg-photo{border-radius:12px;background:#fff}");
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-topcard \.gg-thumb\{[^}]*background:/);
    expect(GIFT_GUIDES_CSS).not.toMatch(/\.gg-letter\{[^}]*mix-blend-mode/);
  });

  it("a photo wraps in .gg-photo; a blank or tiny loaded photo falls back to the store tile", () => {
    const pick = { name: "Theragun Mini", href: "https://go.shopmy.us/p-1", image: "https://example.com/a.jpg", store: "amazon" } as unknown as CatalogPick;
    const { container } = render(<PickThumb pick={pick} size={148} />);
    const img = container.querySelector(".gg-photo > img.gg-thumb") as HTMLImageElement;
    expect(img).not.toBeNull();
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 1 });
    fireEvent.load(img);
    expect(container.querySelector("img.gg-thumb")).toBeNull();
    expect(container.querySelector("[data-gift-letter]")).not.toBeNull();
  });

  it("a real photo stays", () => {
    const pick = { name: "Theragun Mini", href: "https://go.shopmy.us/p-1", image: "https://example.com/a.jpg", store: "amazon" } as unknown as CatalogPick;
    const { container } = render(<PickThumb pick={pick} />);
    const img = container.querySelector("img.gg-thumb") as HTMLImageElement;
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 600 });
    fireEvent.load(img);
    expect(container.querySelector("img.gg-thumb")).not.toBeNull();
  });
});

describe("gift guides 11-19: every Shop button sits on the same line in a row", () => {
  it("each grid card is a full-height flex column with the Shop button pushed to its foot (tablet and desktop)", () => {
    expect(GIFT_GUIDES_CSS.match(/\.gg-list\{display:grid;[^}]*align-items:stretch\}/g)?.length).toBe(2);
    expect(GIFT_GUIDES_CSS.match(/\.gg-list>li\{position:relative;display:flex;flex-direction:column;height:100%;border-top:0\}/g)?.length).toBe(2);
    expect(GIFT_GUIDES_CSS.match(/\.gg-list \.gg-shop-btn\{display:inline-flex;align-self:flex-start;width:auto;margin:0;margin-top:auto\}/g)?.length).toBe(2);
    // Every photo is the same square, and the heart stays on it.
    expect(GIFT_GUIDES_CSS.match(/\.gg-list \.gg-thumb\{width:100%;height:auto;aspect-ratio:1\/1/g)?.length).toBe(2);
    expect(GIFT_GUIDES_CSS).toContain(".gg-list .gg-heart-pick{position:absolute;top:6px;right:6px");
  });
});

describe("gift guides 11-19: the Top 10 is ten real holiday best-sellers", () => {
  it("lists the owner's best-sellers, short brand-first names, photos, one per brand, no career items", () => {
    // Big batch 1120 (owner-approved "Top 10 This Week"): ranked by go-link clicks, then commission x popularity
    // (scripts/gift-guide-picks.mjs weeklyTop); the owner's keep, the Ninja CREAMi, stays in it.
    expect(TOP_PICKS.length).toBe(10);
    expect(TOP_PICKS.map((p) => p.name)).toContain("Ninja CREAMi Ice Cream Maker");
    for (const p of TOP_PICKS) {
      expect(p.image, p.name).toMatch(/^https:\/\//);
      expect(p.name.length, p.name).toBeLessThanOrEqual(40);
      expect(`${p.name} ${p.line}`, p.name).not.toMatch(/\b(nurs\w*|scrubs?|compression|dansko|bombas|clogs?|stethoscope|badge reel|teacher|shift)\b/i);
      expect(p.href, p.name).not.toMatch(/\.co\.uk|\/gb\/|selfridges/i);
    }
    const brands = TOP_PICKS.map((p) => p.name.split(" ")[0].toLowerCase());
    expect(new Set(brands).size).toBe(10);
  });
});

describe("gift guides 11-19: the owner's content rules hold on every guide", () => {
  it("bans Ying Mart, Brooklyn Delhi, eCreamery, AimHave, Minteefy and Mosaic Weighted Blankets everywhere, store pages included", () => {
    for (const brand of ["Ying Mart", "YingMart", "Brooklyn Delhi", "eCreamery", "AimHave", "Minteefy", "Mosaic Weighted Blankets", "Dragontree", "Deme by Gabriella", "CHORD", "Life is Good", "The Jacket Maker", "Diamond Art Club", "Lubiwood", "nixplay", "onn.", "Mainstays", "Hyper Tough", "Holiday Time", "Great Value", "Time and Tru", "George"]) expect(blockedBrand({ brand }), brand).toBe(true);
    expect(blockedBrand({ name: "x", href: "https://www.awin1.com/cread.php?ued=https%3A%2F%2Fx.com", brand: "TangMosaic" })).toBe(false);
    const hits = slugs.flatMap((s) => chunk(s).filter((p) => blockedBrand(p)).map((p) => `${s}: ${p.name}`));
    expect(hits).toEqual([]);
    expect(slugs.flatMap((s) => chunk(s).filter((p) => /brooklyn ?delhi/i.test(`${p.brand ?? ""} ${p.name}`) || /brooklyndelhi/i.test(p.href)).map((p) => `${s}: ${p.name}`))).toEqual([]);
    // Photo books, custom photo products and digital frames: at most 2 site-wide (owner 2026-11-19).
    expect(guides.flatMap((s) => chunk(s).filter((p) => DIGITAL_FRAME.test(`${p.name} ${p.brand ?? ""}`) || PHOTO_PRODUCT.test(p.name) || PHOTO_PRODUCT.test((p.brand ?? "").trim()))).length).toBeLessThanOrEqual(2);
    expect(guides.flatMap((s) => chunk(s).filter((p) => JIGSAW.test(p.name))).length).toBeLessThanOrEqual(3);
    expect(slugs.flatMap((s) => chunk(s).filter((p) => /life is good/i.test(`${p.brand ?? ""} ${p.name}`)).map((p) => `${s}: ${p.name}`)).length).toBeLessThanOrEqual(2);
    for (const s of ["store-ying-mart", "store-brooklyn-delhi", "store-ecreamery-ice-cream-and-gifts", "store-aimhave", "store-minteefy", "store-mosaic-weighted-blankets"]) expect(slugs).not.toContain(s);
  });

  it("no shown name carries a model year; old models and old editions are gone", () => {
    expect(modelYearName("Amazon Kindle Paperwhite 16GB (2024 model)")).toBe("Amazon Kindle Paperwhite 16GB");
    expect(modelYearName("Kindle 16 GB (2024)")).toBe("Kindle 16 GB");
    expect(modelYearName("Tidify Car Front Seat Organizer [2025 UPDATED]")).toBe("Tidify Car Front Seat Organizer");
    expect(modelYearName("2026 TruFeel Golf Balls, 12 Pack")).toBe("TruFeel Golf Balls, 12 Pack");
    expect(modelYearName("Moleskine Classic 12 Month 2026 Weekly Planner")).toBe("Moleskine Classic 12 Month 2026 Weekly Planner");
    expect(modelYearName("BaBylissPRO Nano Titanium 2000-Watt Blow Dryer")).toBe("BaBylissPRO Nano Titanium 2000-Watt Blow Dryer");
    for (const old of ["Yoto Mini (2024 Edition) + Disney Pixar Bundle", "YOTO Player (3rd Gen.) + Starter", "First Aid For the USMLE Step 1 2020", "Southern Living 2025 Annual Recipes"]) expect(modelYearName(old), old).toBe("");
    const names = slugs.flatMap((s) => chunk(s).map((p) => p.name));
    expect(names.length).toBeGreaterThan(740); // audits A+B combined (11-20): 1,402 to 1,456 rows measured on ~30 guides + 26 store pages
    expect(names.filter((n) => namesModelYear(n))).toEqual([]);
  });

  it("food shows only on food guides and in Treats & Food Gifts", () => {
    for (const n of ["Fresh Baked Assorted Cookies Tin", "GODIVA Holiday Luxury Gift Set", "Pumpkin Milk Bar® Pie", "Holiday Dessert Board", "Cajun Seasoning"]) {
      expect(foodOff("mom", { name: n, brand: /godiva/i.test(n) ? "GODIVA" : /milk bar/i.test(n) ? "Milk Bar" : "" }), n).toBe(true);
    }
    expect(isFood({ name: "Birthday Musical Cookie Tin Gift Set", brand: "Levain Bakery" })).toBe(true);
    for (const n of ["Ninja CREAMi Ice Cream Maker", "Candy Land", "King Cake Slice Baseball Hat", "Woofmas Holiday Cookies for Dogs, 4.5 oz"]) expect(isFood({ name: n }), n).toBe(false);
    expect(foodOff("dad", { name: "Red Wine Mixed Pack", brand: "Maker Wine" })).toBe(true);
    expect(foodOff("wine-lover", { name: "Red Wine Mixed Pack", brand: "Maker Wine" })).toBe(false);
    expect(isFood({ name: "Rabbit Wine Bottle Opener" })).toBe(false);
    expect(foodOff("home-cook", { name: "Cajun Seasoning" })).toBe(false);
    expect(foodOff("store-milk-bar", { name: "Pumpkin Milk Bar® Pie", brand: "Milk Bar" })).toBe(false);
    expect(foodOff("mail-carrier-and-delivery-drivers", { name: "Nabisco Snacks Variety Pack", price: 12 })).toBe(false);
    expect(FOOD_GUIDES).toContain(TREATS_GUIDE);
    expect(offenders(foodOff)).toEqual([]);
    // Follow-up 1120: the 0% food shops left (owner 11-20), so Treats & Food Gifts holds none of its own now; its section of
    // Louisiana Food Gifts (Sweets, Bakeries & Treats, with the Goldbelly bakeries) is never empty.
    const foodGifts = JSON.parse(readFileSync("src/content/giftGuidePicks/louisiana-food-gifts.json", "utf8")).picks as { sectionId?: string }[];
    // Audits A+B combined (11-20): its sections fell under 10 and merged into one plain list (22 measured).
    expect(foodGifts.length).toBeGreaterThan(15);
    // Food subscriptions: at most 2 on Treats & Food Gifts, 1 on Subscriptions, none anywhere else.
    expect(isFoodSub({ name: "Monthly Fruit Delivery", brand: "Harry & David" })).toBe(true);
    expect(offenders(foodSubOff)).toEqual([]);
    expect(iceCreamOff(TREATS_GUIDE, { name: "Holiday Ice Cream Gift - 4 Pints" })).toBe(true);
    expect(iceCreamOff("mom", { name: "Ninja CREAMi Ice Cream Maker" })).toBe(false);
    expect(crockPotOff("mom", { name: "Crock-Pot 7-Quart Manual Slow Cooker" })).toBe(true);
    expect(offenders(iceCreamOff)).toEqual([]);
    expect(offenders(crockPotOff)).toEqual([]);
    expect(offenders(groceryCandyOff)).toEqual([]);
    expect(chunk(TREATS_GUIDE).filter(isFoodSub).length).toBeLessThanOrEqual(2);
    expect(slugs.includes("subscriptions") ? chunk("subscriptions").filter(isFoodSub).length : 0).toBeLessThanOrEqual(1);
  });

  it("magazines, women's Sperrys, Life is Good, Bass Pro home decor, off-brand decor, nixplay prints, the Ring doorbell and CHORD's cap stay off", () => {
    expect(magazineOff("mom", { name: "Real Simple Magazine Subscription", brand: "Magazines.com" })).toBe(true);
    expect(magazineOff("subscriptions", { name: "Real Simple Magazine Subscription" })).toBe(false);
    expect(sperryOff("wife", { name: "Sperry Angelfish 1-Eye Boat Shoe (women's, linen/oat)", brand: "Sperry" })).toBe(true);
    expect(sperryOff("boater", { name: "Men's Authentic Original Boat Shoes", brand: "Sperry" })).toBe(false);
    expect(lifeIsGoodOff("her", { name: "Life is Good Women's LIG Daisy Long Sleeve Crusher Tee", brand: "Life is Good" })).toBe(true);
    expect(outdoorDecorOff("mom", { name: "White River Home Giant Berber Throw Blanket", brand: "Bass Pro Shops" })).toBe(true);
    expect(decorOff("mom", { name: "Romantic Dusty Rose Embroidered Tablecloth", brand: "AimHave" })).toBe(true);
    expect(decorOff("new-homeowner", { name: "Linen Tablecloth", brand: "Pottery Barn" })).toBe(false);
    expect(personalGiftOff("him", { name: "Gallery-Wrapped Canvas", brand: "nixplay" })).toBe(true);
    expect(blockedBrand({ brand: "nixplay" })).toBe(true);
    expect(groceryCandyOff(TREATS_GUIDE, { name: "Jelly Belly Signature 20 Collection Jelly Beans, 8 oz", brand: "Jelly Belly", price: 5 })).toBe(true);
    expect(personalGiftOff("grandma", { name: "Woven Photo Throw Blanket", brand: "nixplay" })).toBe(true);
    expect(masonOff("mom", { name: "1 Carat Diamond Stud Earrings", brand: "MASON New York" })).toBe(true);
    expect(redoneOff("her", { name: "Classic Tee Snoopy Holiday", brand: "Re/Done" })).toBe(true);
    expect(hikingOff("her", { name: "Women's Hiker Micro Crew Midweight Hiking Socks", brand: "Darn Tough" })).toBe(true);
    expect(hikingOff("camper", { name: "Hiker Micro Crew", brand: "Darn Tough" })).toBe(false);
    expect(cheapSockOff("her", { name: "Nightmare Before Christmas No Show Socks, 3-Pack", price: 4 })).toBe(true);
    expect(cheapSockOff("stocking-stuffers", { name: "Hello Kitty No Show Socks, 5-Pack", price: 5 })).toBe(false);
    expect(barwareOff("mom", { name: "Stanley Happy Hour Cocktail Shaker" })).toBe(true);
    expect(barwareOff("dad", { name: "Stanley Happy Hour Cocktail Shaker" })).toBe(false);
    expect(fashionSneakerOff("him", { name: "adidas Gazelle Shoes" })).toBe(true);
    expect(fashionSneakerOff("her", { name: "adidas Gazelle Shoes" })).toBe(false);
    expect(veraBradleyOff("mom", { name: "Air Birdie Weekender Travel Bag" })).toBe(true);
    expect(legoOff("grandma", { name: "LEGO Botanicals Orchid", brand: "LEGO" })).toBe(true);
    expect(legoOff("girlfriend", { name: "LEGO Botanicals Orchid", brand: "LEGO" })).toBe(true);
    expect(legoOff("boys-big-kids", { name: "LEGO Technic Car", brand: "LEGO" })).toBe(false);
    expect(farmRioOff("her", { name: "Cheetah Orchid Satin Scarf Bag Small", brand: "FARM Rio" })).toBe(true);
    expect(fashionSneakerOff("him", { name: "Readers", brand: "Warby Parker" })).toBe(true);
    expect(personalGiftOff("mom", { name: "Ring Battery Doorbell 2K Plus", brand: "Ring" })).toBe(true);
    expect(personalGiftOff("dad", { name: "Courchevel Wool Cap", brand: "CHORD" })).toBe(true);
    expect(drugstoreOff("mom", { name: "Cantu Smoothing Leave-In Conditioning Lotion with Shea Butter", brand: "Cantu" })).toBe(true);
    expect(drugstoreOff("mom", { name: "Holiday Gift Set", brand: "Sol de Janeiro" })).toBe(false);
    expect(characterCollab({ name: "Kitsch x BT21 Satin Pillowcase in CHIMMY in King", brand: "Mykitsch" })).toBe(true);
    expect(characterCollab({ name: "Satin Pillowcase", brand: "Kitsch" })).toBe(false);
    expect(resaleOrUkShop({ href: "https://www.depop.com/products/x" })).toBe(true);
    expect(resaleOrUkShop({ href: "https://www.boots.com/x" })).toBe(true);
    expect(resaleOrUkShop({ href: "https://www.durangoboots.com/products/x" })).toBe(false);
    expect(kidsCrocsOff("rns", { name: "Crocs Kids' Classic Clog" })).toBe(true);
    expect(kidsCrocsOff("girls-big-kids", { name: "Crocs Kids' Classic Clog" })).toBe(false);
    for (const rule of [magazineOff, sperryOff, lifeIsGoodOff, outdoorDecorOff, decorOff, personalGiftOff, drugstoreOff, kidsCrocsOff, masonOff, redoneOff, lashOff, veraBradleyOff, hikingOff, cheapSockOff, barwareOff, fashionSneakerOff, legoOff, farmRioOff]) expect(offenders(rule)).toEqual([]);
    expect(offenders((_s, p) => characterCollab(p) || resaleOrUkShop(p))).toEqual([]);
  });

  it("sibling guides share no top-12 pick (mom and wife, dad and him ...)", () => {
    const key = (p: Pick) => p.name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "") || p.href;
    const shared: string[] = [];
    let pairs = 0;
    for (const fam of SIBLING_FAMILIES) {
      for (const a of fam) for (const b of fam) {
        if (a >= b || !slugs.includes(a) || !slugs.includes(b)) continue;
        pairs += 1;
        // The owner's own picks (ownerPick) lead every guide she names them for, exempt from every rule (owner 11-19).
        const top = chunk(b).filter((p) => !p.ownerPick).slice(0, SIBLING_TOP);
        const n = siblingOverlap(chunk(a).filter((p) => !p.ownerPick), top, key).topShared;
        if (n) shared.push(`${a} / ${b}: ${n}`);
      }
    }
    // For Her = the owner's 25 saves (11-21): Mom, Wife, Girlfriend, Sister and Mother-in-law are no longer lists of their
    // own (their picks are Her's, all ownerPick): 31 pairs measured 2026-11-21.
    expect(pairs).toBeGreaterThan(30);
    expect(shared).toEqual([]);
  });

  // Owner 11-19 (refined): "if you are going to use the same item for different guides, at least choose a different
  // color": a colorway repeat has its own link, name and photo, so it never matches here; the same photo never shows on
  // two guides. The owner's own picks (ownerPick) are exempt.
  it("every product shows on exactly one guide (owner: \"really and truly they don't need to share any items\"); store pages exempt", () => {
    const byHref = new Map<string, string>();
    const byName = new Map<string, string>();
    const byImage = new Map<string, string>();
    const repeats: string[] = [];
    let n = 0;
    for (const s of guides) for (const p of chunk(s)) {
      n += 1;
      if (p.ownerPick) continue;
      if (p.image && byImage.has(p.image) && byImage.get(p.image) !== s) repeats.push(`${p.name}: same photo on ${byImage.get(p.image)} + ${s}`);
      if (p.image) byImage.set(p.image, s);
      const name = p.name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
      if (byHref.has(p.href) && byHref.get(p.href) !== s) repeats.push(`${p.name}: ${byHref.get(p.href)} + ${s}`);
      if (byName.has(name) && byName.get(name) !== s) repeats.push(`${p.name}: ${byName.get(name)} + ${s}`);
      byHref.set(p.href, s);
      byName.set(name, s);
    }
    expect(n).toBeGreaterThan(500);
    expect(repeats).toEqual([]);
  });

  it("one lash item at most on a guide, never in its top 12; one Vera Bradley at most, none in a women's top 12", () => {
    const bad = guides.flatMap((s) => {
      const l = chunk(s);
      const lashes = l.map((p, i) => [p, i] as const).filter(([p]) => LASH.test(p.name));
      const vb = l.map((p, i) => [p, i] as const).filter(([p]) => /^vera bradley$/i.test((p.brand ?? "").trim()));
      const women = ["her", "mom", "wife", "girlfriend", "sister", "aunt", "grandma"].includes(s);
      return [...(lashes.length > 1 || lashes.some(([, i]) => i < 12) ? [`${s}: lashes`] : []), ...(vb.length > 1 || (women && vb.some(([, i]) => i < 12)) ? [`${s}: vera bradley`] : [])];
    });
    expect(bad).toEqual([]);
  });

  it("popular brands may repeat, but at most 4 of one brand in a guide's top 12", () => {
    const over = guides.flatMap((s) => {
      const c = new Map<string, number>();
      // The owner's own picks (ownerPick) lead their guides, exempt from every cap (owner 11-19).
      for (const p of chunk(s).filter((x) => !x.ownerPick).slice(0, 12)) { const b = (p.brand ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""); if (b) c.set(b, (c.get(b) ?? 0) + 1); }
      return [...c].filter(([, v]) => v > 4).map(([b, v]) => `${s}: ${b} x${v}`);
    });
    expect(over).toEqual([]);
  });
});
