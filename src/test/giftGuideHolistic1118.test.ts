/**
 * Gift guides holistic review 11-18 (~/.lh-shots/design-audit-loop/gg-holistic-1118/FINDINGS.md H2/H3/L5) and the
 * owner's Fish Lover correction (11-18 night: Fish Lover is a Pets guide, for people who keep pet fish, not anglers).
 * Reads the rules (scripts/giftGuideRules.mjs) and every generated chunk (src/content/giftGuidePicks/*.json).
 * @mutate scripts/giftGuideRules.mjs |   if (PET_ONLY[slug] && !PET_ONLY[slug](p)) return false; |
 * @mutate scripts/giftGuideRules.mjs |     return /\/collections\//i.test(u.pathname) \|\| /\/shop\/?$/i.test(u.pathname); |     return false;
 * @mutate scripts/giftGuideRules.mjs | export const placeholderName = (p) => /^All\s+(\w+\s){0,2}\w+s$/.test(String(p.name ?? "").trim()) | export const placeholderName = (p) => false
 * @mutate scripts/giftGuideRules.mjs |   if (/^huk$/i.test(String(p.brand ?? "").trim())) return true; |
 * @mutate scripts/gift-guide-picks.mjs |     if (WOMEN_GUIDES.includes(slug) && mensItem(p)) return "men's item"; |
 * @mutate scripts/gift-guide-picks.mjs |   if (!NON_US_LINKS.has(link) && !placeFields(p).some(nonUsUrl)) return p; |   return p;
 * @mutate scripts/gift-guide-picks.mjs |     if (INSTAX_OFF.includes(slug) && instaxItem(p)) return "instax"; |
 * @mutate scripts/giftGuideRules.mjs | export const NO_SHOW_FORMAT = /\.(avif\|heif\|heic)(\?\|$)\|[?&](fmt\|format)=avif\b/i; | export const NO_SHOW_FORMAT = /^$/;
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANGLING, NEW_MOM_CARE, NOT_A_GIFT_ITEM, WOMEN_GUIDES, brokenImage, collectionLink, fitsGuide, INSTAX_OFF, instaxItem, mensItem, nonUsUrl, placeholderName } from "../../scripts/giftGuideRules.mjs";
import { sectionChunks, sectionPageOf } from "./helpers/giftGuideSections";

const DIR = join(process.cwd(), "src/content/giftGuidePicks");
type Pick = { name: string; brand: string; href: string; image?: string };
// Big batch 1120: each merged guide's section under its old slug (helpers/giftGuideSections.ts).
const CHUNKS: Record<string, Pick[]> = sectionChunks<Pick>();

describe("gift guides holistic fit (11-18)", () => {
  it("reads every chunk", () => {
    // Big batch 1120: ~65 guides split into ~250 sections, and the 30 kept store pages.
    expect(Object.keys(CHUNKS).length).toBeGreaterThan(250);
  });

  it("Fish Lover holds pet-fish gifts, never angling gear", () => {
    for (const name of ["Aluminum Saltwater Fishing Pliers", "EZ Fillet Fish Fillet Mat", "PENN 7' Battle Spinning Fishing Rod and Reel Combo Kit", "KastKing Karryall 40L Fishing Tackle Backpack"]) {
      expect(fitsGuide("fish-lover", { name }), name).toBe(false);
    }
    expect(fitsGuide("fish-lover", { name: "Betta Fish Tank Starter Kit, 5 Gallon" })).toBe(true);
    expect(fitsGuide("fishermen", { name: "Aluminum Saltwater Fishing Pliers" })).toBe(true);
    const angling = (CHUNKS["fish-lover"] ?? []).filter((p) => ANGLING.test(p.name)).map((p) => p.name);
    expect(angling).toEqual([]);
  });

  it("no chunk links a collection or shop page, or names a category instead of a product", () => {
    expect(collectionLink("https://shopmy.us/collections/8987524")).toBe(true);
    expect(collectionLink("https://go.shopmy.us/p-104053976")).toBe(false);
    expect(placeholderName({ name: "All Blenders", brand: "Vitamix" })).toBe(true);
    expect(placeholderName({ name: "Sterling Silver Rings", brand: "" })).toBe(true);
    expect(placeholderName({ name: "All About Eyes Eye Cream with Vitamin C", brand: "Clinique" })).toBe(false);
    const bad = Object.entries(CHUNKS).flatMap(([slug, l]) => l.filter((p) => collectionLink(p.href) || placeholderName(p)).map((p) => `${slug}: ${p.name} ${p.href}`));
    expect(bad).toEqual([]);
  });

  it("no medical or personal-care item is listed as a gift (New Mom keeps pump and nipple care)", () => {
    for (const name of ["Period Bikini, 2 Pack", "Drying Lotion", "Aquaphor Healing Ointment", "Hero Mighty Patch Acne Pimple Patches"]) expect(NOT_A_GIFT_ITEM.test(name), name).toBe(true);
    const bad = Object.entries(CHUNKS).flatMap(([slug, l]) => l.filter((p) => NOT_A_GIFT_ITEM.test(p.name) && !((slug === "new-mom" || slug.startsWith("store-")) && NEW_MOM_CARE.test(p.name))).map((p) => `${slug}: ${p.name}`));
    expect(bad).toEqual([]);
  });

  it("no men's item on Her, Mom, Wife, Girlfriend, Sister, Aunt or Grandma, at any position (batch 11-19)", () => {
    expect(WOMEN_GUIDES).toEqual(["her", "mom", "wife", "girlfriend", "sister", "aunt", "grandma"]);
    const sperryMens = "https://www.sperry.com/cdn/shop/files/product_13934343_ao_202_20eye_mm_multi_203-001-043_main_sq_wt.jpg";
    expect(mensItem({ name: "Authentic Original 2-Eye Boat Shoe", brand: "Sperry US", image: sperryMens })).toBe(true);
    expect(mensItem({ name: "Angelfish 1 Eye Boat Shoe", brand: "Sperry US", image: sperryMens.replace("_mm_", "_wm_") })).toBe(false);
    expect(mensItem({ name: "A1A Pro Long Sleeve Crew", brand: "Huk" })).toBe(true);
    expect(mensItem({ name: "Huk Women's Pursuit Hoodie", brand: "Huk" })).toBe(false);
    expect(mensItem({ name: "Carhartt Men's Loose Fit Flannel Shirt", brand: "Carhartt" })).toBe(true);
    expect(mensItem({ name: "Women's Ankle Deck Boot", brand: "XTRATUF" })).toBe(false);
    for (const g of WOMEN_GUIDES.filter((x) => x !== "aunt")) expect(CHUNKS[g]?.length ?? 0, g).toBeGreaterThan(2); // one guide per product (owner 11-19): the guides are smaller
    // The rows the review named (Her 11-19: two Huk shirts, the men's Sperry Authentic Original and Billfish).
    const named = new Set(["https://mavely.app.link/CUXXsAGUa8b", "https://mavely.app.link/H1gCiuGUa8b", "https://mavely.app.link/LPJLdGGUa8b", "https://mavely.app.link/bjXOnPBUa8b", "https://mavely.app.link/WUUrDKBUa8b", "https://mavely.app.link/OsRr4FBUa8b", "https://mavely.app.link/bJ14lBBUa8b", "https://mavely.app.link/QEjVswBUa8b"]);
    const bad = WOMEN_GUIDES.flatMap((g) => (CHUNKS[g] ?? []).filter((p) => mensItem(p) || named.has(p.href)).map((p) => `${g}: ${p.name} ${p.href}`));
    expect(bad).toEqual([]);
  });

  it("no pick opens a UK, Australian or Canadian store (batch 11-19)", () => {
    for (const s of ["https://www.sephora.co.uk/p/laneige-lip-sleeping-mask", "Spacenk.com/uk", "https://www.spacenk.com/uk/makeup/x", "https://www.sportinglife.ca/en-CA/x", "https://www.lululemon.com/en-ca/p/x", "https://www.amazon.com.au/dp/x"]) expect(nonUsUrl(s), s).toBe(true);
    for (const s of ["https://www.sephora.com/product/x", "https://us.laneige.com/products/x", "Sephora", "https://www.rarebeauty.com/products/x", "https://www.canada.com/x"]) expect(nonUsUrl(s), s).toBe(false);
    // The ShopMy pins the 11-19 checks found on non-US stores (followed from this Mac: p-104125195 -> spacenk.com/uk;
    // the rest name sephora.co.uk, slipsilkpillowcase.co.uk or sportinglife.ca in the research files).
    const nonUs = ["p-104125195", "p-104112761", "p-104124837", "p-104112898", "p-104127707", "p-104125130", "p-104123427", "p-104214852"].map((id) => `https://go.shopmy.us/${id}`);
    const bad = Object.entries(CHUNKS).flatMap(([slug, l]) => l.filter((p) => nonUs.includes(p.href) || nonUsUrl(p.href)).map((p) => `${slug}: ${p.name} ${p.href}`));
    expect(bad).toEqual([]);
    // Her keeps the blush and the lip mask on their US pins (rarebeauty.com, us.laneige.com).
    // (One guide per product, owner 11-19: wherever they now sit.)
    const all = Object.entries(CHUNKS).filter(([s]) => !s.startsWith("store-")).flatMap(([, l]) => l);
    for (const p of all.filter((x) => x.name === "Soft Pinch Liquid Blush")) expect(p.href).toBe("https://go.shopmy.us/p-104050729");
    for (const p of all.filter((x) => /^(LANEIGE )?Lip Sleeping Mask$/.test(x.name))) expect(p.href).toBe("https://go.shopmy.us/p-107575536");
  });

  it("no Instax camera on Dad, Him, Husband or Boyfriend, Grandpa or Father-in-Law (owner 11-19)", () => {
    expect(INSTAX_OFF).toEqual(["dad", "him", "boyfriend-or-husband", "grandpa", "father-in-law"]);
    expect(instaxItem({ name: "FUJIFILM INSTAX MINI 12 Instant Film Camera" })).toBe(true);
    expect(instaxItem({ name: "Mini 12 Instant Camera", brand: "Instax" })).toBe(true);
    expect(instaxItem({ name: "Kindle Paperwhite 16GB" })).toBe(false);
    for (const g of INSTAX_OFF.filter((x) => x !== "father-in-law")) expect(CHUNKS[g]?.length ?? 0, g).toBeGreaterThan(2); // one guide per product (owner 11-19): the guides are smaller
    const bad = INSTAX_OFF.flatMap((g) => (CHUNKS[g] ?? []).filter(instaxItem).map((p) => `${g}: ${p.name}`));
    expect(bad).toEqual([]);
    // Photographer keeps its cameras.
    expect(INSTAX_OFF).not.toContain("photographer"); // one guide per product (owner 11-19): Instax shows on one guide now
  });

  it("no AVIF or HEIF photo (not every browser shows one)", () => {
    expect(brokenImage("https://cdn.shopify.com/s/files/1/0800/1879/files/10111001_0693_A.avif?v=1789566")).toBe(true);
    expect(brokenImage("https://cdn.shopify.com/s/files/1/1567/7629/files/IMG_9986.heic?v=1790966616")).toBe(true);
    const bad = Object.entries(CHUNKS).flatMap(([slug, l]) => l.filter((p) => p.image && brokenImage(p.image)).map((p) => `${slug}: ${p.image}`));
    expect(bad).toEqual([]);
  });
});
