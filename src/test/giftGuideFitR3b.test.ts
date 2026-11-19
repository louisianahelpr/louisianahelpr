/**
 * Gift guide item fit, round 3b (2026-11-19, ~/.lh-shots/design-audit-loop/gg-r3-fit, 5 High / 55 Medium) and the
 * lead's calls on its open questions (11-19), read from the generated guide chunks (src/content/giftGuidePicks) and the
 * import's rules (scripts/giftGuideRules.mjs):
 *   - utility or medical personal care (Aquaphor, ointments, acne, period products, drugstore lip balm, hand cream packs,
 *     sheet masks, shampoo, sunscreen, a hair trimmer) is on no guide but New Mom;
 *   - giftable beauty is only on the guides it fits (beautyGuide), and one beauty product on at most BEAUTY_GUIDE_MAX;
 *   - a brand counts under all its spellings (brandKey) for the 3-a-guide cap;
 *   - New Puppy holds puppy, dog and new-pet-owner items only, with at most one "dog mom" item (r3 follow-up: a
 *     Stanley Quencher was on it);
 *   - no XTRATUF deck boot on Mom, Her or Wife, no empty gift baskets, and every Mail Carrier pick names its brand.
 *
 * @mutate scripts/gift-guide-picks.mjs |     if (utilityCare(p) && slug !== "new-mom") return "utility personal care"; |     if (false) return "utility personal care";
 * @mutate scripts/gift-guide-picks.mjs |     if (beautyItem(p) && !beautyGuide(slug)) return "beauty outside its guides"; |     if (false) return "beauty outside its guides";
 * @mutate scripts/giftGuideRules.mjs | export const BEAUTY_GUIDE_MAX = 6; | export const BEAUTY_GUIDE_MAX = 60;
 * @mutate scripts/giftGuideRules.mjs | export const BRAND_ALIASES = { darntoughvermont: "darntough", | export const BRAND_ALIASES = { darntoughvermontx: "darntough",
 * @mutate scripts/giftGuideRules.mjs |     if (!PUPPY_ITEM.test(name)) return "not a puppy item"; |     if (false) return "not a puppy item";
 */
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import {
  BEAUTY_GUIDE_MAX, OWNER_MERCH, PUPPY_ITEM, beautyGuide, beautyItem, belongsWhy, brandFromName, brandKey, utilityCare,
} from "../../scripts/giftGuideRules.mjs";

type Pick = { name: string; brand?: string; href: string };
const DIR = "src/content/giftGuidePicks";
const pageOf = (slug: string): Pick[] => (existsSync(`${DIR}/${slug}.json`) ? JSON.parse(readFileSync(`${DIR}/${slug}.json`, "utf8")).picks : []);
const slugs = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const guides = slugs.filter((s) => !s.startsWith("store-") && s !== "25-days-sponsors");
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Guides the brand cap skips (the Louisiana guides, Gift Cards, Subscriptions), as scripts/gift-guide-picks.mjs `capped`. */
const indexSrc = readFileSync("src/content/giftGuideIndex.ts", "utf8");
const louisiana = new Set([...indexSrc.matchAll(/group: "Louisiana"[^}]*?slug: "([^"]+)"/g)].map((m) => m[1]));

describe("gift guides: item fit r3b (fit audit + lead's calls, 11-19)", () => {
  it("the rules read the audit's examples", () => {
    expect(utilityCare({ name: "Advanced Therapy Baby Healing Ointment", brand: "Aquaphor" })).toBe(true);
    expect(utilityCare({ name: "Moisturizing Lip Balm, 4 Tubes", brand: "Burt's Bees" })).toBe(true);
    expect(utilityCare({ name: "7-Pack Hand Cream Gift Set", brand: "Unbranded" })).toBe(true);
    expect(utilityCare({ name: "Men's Zero Gap T-Blade Hair and Beard Trimmer" })).toBe(true);
    expect(utilityCare({ name: "Unseen Sunscreen SPF 40", brand: "Supergoop!" })).toBe(true);
    expect(utilityCare({ name: "Lip Sleeping Mask", brand: "LANEIGE" })).toBe(false);
    expect(utilityCare({ name: "Brazilian Touch Hand Cream", brand: "Sol de Janeiro" })).toBe(false);
    expect(beautyItem({ name: "Lip Sleeping Mask", brand: "LANEIGE" })).toBe(true);
    expect(beautyItem({ name: "Cheirosa 62 Perfume Mist", brand: "Sol de Janeiro" })).toBe(true);
    expect(beautyItem({ name: "Blush Pink Knit Throw" })).toBe(false);
    expect(beautyGuide("her")).toBe(true);
    expect(beautyGuide("under-25")).toBe(true);
    expect(beautyGuide("dad")).toBe(false);
    expect(beautyGuide("girls")).toBe(false);
    expect(beautyGuide("accountants")).toBe(false);
    expect(brandKey("Darn Tough Vermont")).toBe(brandKey("Darn Tough"));
    expect(brandKey("Sperry US")).toBe(brandKey("Sperry"));
    expect(brandKey("Melissa and Doug")).toBe(brandKey("Melissa & Doug"));
    expect(brandFromName("Ozark Trail Men's Fleece Neck Gaiter")).toBe("Ozark Trail");
    expect(belongsWhy("new-puppy", "Pets", { name: "STANLEY Quencher H2.0 Flow State Tumbler" })).not.toBe("");
    expect(belongsWhy("new-puppy", "Pets", { name: "Kindle Paperwhite" })).not.toBe("");
    expect(belongsWhy("new-puppy", "Pets", { name: "Classic Stuffable Dog Toy, Large" })).toBe("");
    const seen = { tumblers: 0 };
    expect([belongsWhy("new-puppy", "Pets", { name: "Dog Mom Tumbler" }, seen), belongsWhy("new-puppy", "Pets", { name: "The Dog Mom Sweatshirt" }, seen)]).toEqual(["", "second dog-mom item"]);
    expect(belongsWhy("best-friend", "By person", { name: "Ayieyill Gift Baskets Set for Women, 10 Pack, Yellow" })).toBe("empty packaging");
  });

  it("every guide follows them", () => {
    expect(guides.length).toBeGreaterThan(150);
    const bad: string[] = [];
    const beautyOn = new Map<string, Set<string>>();
    let picks = 0;
    for (const slug of guides) {
      const list = pageOf(slug);
      picks += list.length;
      const perBrand = new Map<string, number>();
      for (const p of list) {
        if (utilityCare(p) && slug !== "new-mom") bad.push(`${slug}: utility care: ${p.name}`);
        if (beautyItem(p)) {
          if (!beautyGuide(slug)) bad.push(`${slug}: beauty: ${p.name}`);
          const b = key(p.brand ?? "");
          const n = key(p.name);
          const k = `${brandKey(p.brand ?? "")}|${b && n.startsWith(`${b} `) ? n.slice(b.length + 1) : n}`;
          (beautyOn.get(k) ?? beautyOn.set(k, new Set()).get(k)!).add(slug);
        }
        if (["mom", "her", "wife"].includes(slug) && /xtratuf|deck boot/i.test(`${p.name} ${p.brand ?? ""}`)) bad.push(`${slug}: deck boot: ${p.name}`);
        if (/\bgift baskets?\b.*\b\d+ ?(pack|pcs|count)\b/i.test(p.name)) bad.push(`${slug}: empty baskets: ${p.name}`);
        const b = brandKey(p.brand ?? "");
        if (b && !/affiliate|program|walmart|amazon|target|shopmy/i.test(p.brand ?? "")) perBrand.set(b, (perBrand.get(b) ?? 0) + 1);
      }
      if (!louisiana.has(slug) && !["gift-cards", "subscriptions"].includes(slug)) {
        for (const [b, n] of perBrand) if (n > 3) bad.push(`${slug}: ${n} x ${b}`);
      }
    }
    for (const [k, on] of beautyOn) if (on.size > BEAUTY_GUIDE_MAX) bad.push(`${k} on ${on.size} guides`);
    expect(picks).toBeGreaterThan(1500); // one guide per product (owner 11-19): the guides are smaller
    expect(beautyOn.size).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it("New Puppy is for the puppy, and Mail Carrier names every brand", () => {
    const puppy = pageOf("new-puppy");
    expect(puppy.length).toBeGreaterThan(4); // one guide per product (owner 11-19): the guides are smaller
    expect(puppy.filter((p) => !PUPPY_ITEM.test(p.name)).map((p) => p.name)).toEqual([]);
    expect(puppy.filter((p) => OWNER_MERCH.test(p.name)).length).toBeLessThanOrEqual(1);
    const mail = pageOf("mail-carrier-and-delivery-drivers");
    expect(mail.length).toBeGreaterThan(10);
    expect(mail.filter((p) => !String(p.brand ?? "").trim()).map((p) => p.name)).toEqual([]);
  });
});
