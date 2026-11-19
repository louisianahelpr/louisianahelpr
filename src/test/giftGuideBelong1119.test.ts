/**
 * ITEMS THAT BELONG (owner 11-19: "some of them really don't belong at all"; fit beats count). Reads the generated
 * guide chunks (src/content/giftGuidePicks/<slug>.json) and the import's rules (scripts/giftGuideRules.mjs belongsWhy,
 * wrapItem, neutralLine) and checks every guide: no Bartesian capsules or Cooking Light anywhere, no filler block or
 * stray tumblers in career/hobby/color guides, at most 3 tumblers there, Gift Wrap & Cards only wrap and cards, Mail
 * Carrier only checked prices of $20 or less, no Louisiana words on a national guide's line, Sam's Club beside
 * Walmart+, and no sold-out Walmart link left.
 * @mutate scripts/giftGuideRules.mjs | export const TUMBLER_MAX = 3; | export const TUMBLER_MAX = 30;
 * @mutate scripts/giftGuideRules.mjs | if (NOWHERE.test(text)) return "bartesian or cooking light"; | if (false) return "bartesian or cooking light";
 * @mutate scripts/gift-guide-picks.mjs |       if (slug === "gift-wrap-and-cards" && !wrapItem(p)) { belong.wrap += 1; continue; } |       if (false) { belong.wrap += 1; continue; }
 * @mutate scripts/gift-guide-picks.mjs |       if (slug === MAIL_CARRIER && !(priceOf(p) <= MAIL_CARRIER_MAX)) { belong.mail += 1; continue; } |       if (false) { belong.mail += 1; continue; }
 * @mutate scripts/giftGuideRules.mjs |   return LA_LINE.test(out) ? "" : out; |   return line;
 */
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import { E_GIFT, FILLER_OK, INSULATED, LA_LINE, NOWHERE, TUMBLER_MAX, belongsWhy, fillerGuide, neutralLine, tumblerGuide, wrapItem } from "../../scripts/giftGuideRules.mjs";

type Pick = { name: string; brand?: string; line?: string; href: string; price?: number; image?: string };
const DIR = "src/content/giftGuidePicks";
const pageOf = (slug: string): Pick[] => (existsSync(`${DIR}/${slug}.json`) ? JSON.parse(readFileSync(`${DIR}/${slug}.json`, "utf8")).picks : []);
const indexSrc = readFileSync("src/content/giftGuideIndex.ts", "utf8");
const groupOf = new Map([...indexSrc.matchAll(/group: "([^"]+)"[^}]*?slug: "([^"]+)"/g)].map((m) => [m[2], m[1]]));
const slugs = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const guides = slugs.filter((s) => !s.startsWith("store-") && s !== "25-days-sponsors");

describe("gift guides: items that belong (owner 11-19)", () => {
  it("the rules: filler, tumblers, Bartesian capsules, eGift cards, wrap and Louisiana lines", () => {
    expect(belongsWhy("accountants", "By career", { name: "Kindle Paperwhite 16GB" })).toBe("filler block");
    expect(belongsWhy("book-lover", "Hobbies", { name: "Kindle Paperwhite 16GB" })).toBe("");
    expect(belongsWhy("accountants", "By career", { name: "Stanley Quencher H2.0 Tumbler, 30 oz" })).toBe("tumbler outside nurse/teacher/shift guides");
    expect(belongsWhy("rns", "By career", { name: "Stanley Quencher H2.0 Tumbler, 30 oz" })).toBe("");
    expect(belongsWhy("pink-lover", "Colors", { name: "Stanley Quencher Tumbler Pink" })).toBe("");
    const seen = { tumblers: 0 };
    const four = [1, 2, 3, 4].map((i) => belongsWhy("rns", "By career", { name: `Insulated Lunch Box ${i}` }, seen));
    expect(four).toEqual(["", "", "", "tumbler cap"]);
    expect(belongsWhy("mom", "By person", { name: "Apple Pie Capsules", brand: "Bartesian" })).toBe("bartesian or cooking light");
    expect(belongsWhy("mom", "By person", { name: "Cooking Light Magazine Subscription" })).toBe("bartesian or cooking light");
    expect(belongsWhy("teachers", "By career", { name: "Starbucks eGift Card" })).toBe("egift card");
    expect(belongsWhy("gift-cards", "By budget", { name: "Starbucks eGift Card" })).toBe("");
    expect(belongsWhy("store-best-buy", "By store", { name: "Gift Ideas" })).toBe("placeholder");
    expect(belongsWhy("kayaker", "Hobbies", { name: "Ugly Stik GX2 Spinning Rod" })).toBe("fishing gear");
    expect(belongsWhy("niece", "By person", { name: "Hape Gourmet Grill" })).toBe("toy grill");
    expect(wrapItem({ name: "500 Yards Silver Curling Ribbon" })).toBe(true);
    expect(wrapItem({ name: "Amazon.com Gift Card in a Holiday Box" })).toBe(false);
    expect(wrapItem({ name: "Kindle Paperwhite" })).toBe(false);
    expect(neutralLine("The gumbo pot they'll pass down.")).toBe("The Dutch oven they'll pass down.");
    expect(neutralLine("A tote for Mardi Gras.")).toBe("");
    expect(neutralLine("A cozy throw.")).toBe("A cozy throw.");
    expect(tumblerGuide("refinery-and-plant-workers")).toBe(true);
    expect(tumblerGuide("lawyers")).toBe(false);
  });

  it("every guide follows them", () => {
    expect(guides.length).toBeGreaterThan(150);
    let picks = 0;
    for (const slug of guides) {
      const group = groupOf.get(slug) ?? "";
      const list = pageOf(slug);
      picks += list.length;
      let tumblers = 0;
      for (const p of list) {
        const text = `${p.name} ${p.brand ?? ""}`;
        expect(NOWHERE.test(text), `${slug}: ${p.name}`).toBe(false);
        if (slug !== "gift-cards" && !/restaurants|tours|spa|date-night|concerts|classes|family-fun/.test(slug)) expect(E_GIFT.test(p.name), `${slug}: ${p.name}`).toBe(false);
        if (!fillerGuide(slug, group)) continue;
        if (INSULATED.test(p.name) && !FILLER_OK[slug]?.test(p.name)) tumblers += 1;
      }
      expect(tumblers, slug).toBeLessThanOrEqual(TUMBLER_MAX);
    }
    expect(picks).toBeGreaterThan(1500); // one guide per product (owner 11-19): the guides are smaller
  });

  it("Gift Wrap & Cards holds wrap and cards only; Mail Carrier only checked prices of $20 or less", () => {
    const wrap = pageOf("gift-wrap-and-cards");
    expect(wrap.length).toBeGreaterThan(5);
    for (const p of wrap) expect(wrapItem(p), p.name).toBe(true);
    for (const p of pageOf("mail-carrier-and-delivery-drivers")) expect(p.price ?? Infinity, p.name).toBeLessThanOrEqual(20);
  });

  it("no national guide's line names Louisiana", () => {
    const national = guides.filter((s) => groupOf.get(s) !== "Louisiana");
    expect(national.length).toBeGreaterThan(100);
    for (const slug of national) for (const p of pageOf(slug)) expect(Boolean(p.line && LA_LINE.test(p.line)), `${slug}: ${p.name}: ${p.line}`).toBe(false);
  });

  it("Sam's Club memberships sit beside Walmart+, and no sold-out Walmart link is left", () => {
    const subs = pageOf("subscriptions").map((p) => p.name);
    expect(subs.indexOf("Sam's Club Plus Membership")).toBe(subs.indexOf("Walmart+ membership") + 1);
    for (const p of pageOf("subscriptions").filter((x) => /^Sam's Club/.test(x.name))) {
      expect(new URL(p.href).hostname).toBe("samsclub.co");
      expect(existsSync(`public${new URL(p.image!).pathname}`), p.image).toBe(true);
    }
    const swaps = JSON.parse(readFileSync("src/test/fixtures/giftGuideSoldoutOld1119.json", "utf8")) as string[];
    expect(swaps.length).toBeGreaterThanOrEqual(13);
    const all = slugs.flatMap(pageOf).map((p) => p.href);
    for (const old of swaps) expect(all, old).not.toContain(old);
  });
});
