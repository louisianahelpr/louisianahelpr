/**
 * Owner 11-20 gift guide fixes ("cmon this is crazy", then her phone notes on Dad / Him / Grandpa / Mom / Mother-in-Law /
 * Her), read from the shipped chunks (src/content/giftGuidePicks) and the rules in scripts/giftGuideRules.mjs:
 *   - the named removals are on NO page, store pages included (HEYDUDE Austin Lift mule, pink Bombas Sunday Slipper,
 *     pink Vineyard Vines Surf Terry Shep, mint Southern Tide Sandy Cove, the neon YETI Roadie 24 link, Michael Kors Logo
 *     Small Nylon Crossbody, black YETI x Ten Thousand Rambler, Muck women's Rainscape boots, L.L.Bean Wicked Good
 *     Moccasins) and no Lilly Pulitzer anywhere (blocklist);
 *   - the men's style rule (MEN_COLOR_GUIDES): no pink / pastel / funky colorway read from the name, link, photo name,
 *     line or color field, no women's footwear style (platform, lift, wedge...), no women's product link;
 *   - no neon or chartreuse on any guide; no boots in a grandma or in-law section; no plain black Stanley / YETI cup on a
 *     women's guide; at most 2 pajamas per section;
 *   - Dad, Him and Grandpa each show at least 5 priced gifts under $25; the freed spots hold XTRATUF women's boots, the
 *     owner's UGG Evelina clog, a Nectarine Stanley Quencher and Eberjey pajamas.
 *
 * @mutate scripts/giftGuideRules.mjs |     \|\| (/\baustin lift\b/i.test(p.name) && /hey ?dude/i.test(t)) |     \|\| false
 * @mutate scripts/giftGuideRules.mjs |   if (FOOTWEAR.test(`${name} ${type}`) && WOMENS_FOOTWEAR.test(name)) return "women's footwear style"; |   if (false) return "";
 * @mutate scripts/giftGuideRules.mjs |   if (FEMININE_COLOR.test(colorText)) return "feminine colorway"; |   if (false) return "";
 * @mutate scripts/giftGuideRules.mjs | export const neonOff = (slug, p) => !slug.startsWith("store-") && | export const neonOff = (slug, p) => false &&
 * @mutate scripts/gift-guide-owner-1120d.json |  { "guide": "grandparents", "section": "Grandpa", "why": "under $25 (stanley1913.com $18.75)" |  { "guide": "nowhere", "section": "Grandpa", "why": "under $25 (stanley1913.com $18.75)"
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import { MEN_COLOR_GUIDES, MEN_PASTEL, OWNER_REMOVED, elderBootOff, menPastelOff, menStyleWhy, neonOff, ownerStyleOff, womenBlackCupOff } from "../../scripts/giftGuideRules.mjs";
import { blockedBrand } from "../../scripts/giftGuideBlocklist.mjs";

type Pick = { name: string; brand?: string; href: string; image?: string; line?: string; store?: string; price?: number; type?: string; from?: string; section?: string; sectionId?: string };
const DIR = "src/content/giftGuidePicks";
const CHUNKS = new Map<string, Pick[]>(readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, -5), (JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")) as { picks: Pick[] }).picks]));
const GUIDES = [...CHUNKS.entries()].filter(([slug]) => !slug.startsWith("store-"));
const NAMED = [/heydude austin lift/i, /bombas sunday slipper|^sunday slipper$/i, /surf terry shep/i, /sandy cove/i, /michael kors logo small nylon crossbody/i, /yeti x ten thousand/i, /\brainscape\b/i, /wicked good moccasin/i, /lill?y pulitzer/i];

describe("gift guides: owner 11-20 removals and style rules", () => {
  it("the named removals and Lilly Pulitzer are on no page, store pages included", () => {
    expect(CHUNKS.size).toBeGreaterThan(400);
    const hits = [...CHUNKS.entries()].flatMap(([slug, picks]) => picks.filter((p) => NAMED.some((re) => re.test(`${p.brand ?? ""} ${p.name}`)) || /p-107836771\b/.test(p.href) || OWNER_REMOVED(p) || blockedBrand(p)).map((p) => `${slug}: ${p.name}`));
    expect(hits).toEqual([]);
  });

  it("the rules catch the owner's three Dad picks and the shapes behind them", () => {
    expect(OWNER_REMOVED({ name: "HEYDUDE Austin Lift Leather Mule", brand: "HEYDUDE" })).toBe(true);
    expect(OWNER_REMOVED({ name: "Bombas Sunday Slipper", brand: "Bombas" })).toBe(true);
    expect(OWNER_REMOVED({ name: "Vineyard Vines Surf Terry Shep Sweatshirt", brand: "Vineyard Vines" })).toBe(true);
    // A platform / lift / wedge shoe, a women's product link, a "-Female-" photo, a pink or mint colorway in the link.
    expect(menStyleWhy({ name: "Brand Austin Lift Leather Mule", type: "shoes" })).toBe("women's footwear style");
    expect(menStyleWhy({ name: "Brand Platform Slide", type: "sandals" })).toBe("women's footwear style");
    expect(menStyleWhy({ name: "Sunday Slipper", href: "https://bombas.com/products/womens-sunday-slippers" })).toBe("women's product link");
    expect(menStyleWhy({ name: "Sunday Slipper", image: "https://x/zoom-1-11291-prairiemauve-adult-Female-layflat.png" })).not.toBe("");
    expect(menStyleWhy({ name: "Crew Sweatshirt", href: "https://shop.example.com/p/crew?color=pink" })).toBe("feminine colorway");
    expect(menStyleWhy({ name: "Quarter Zip", href: "https://shop.example.com/p/qz?variant=mint" })).toBe("funky colorway");
    expect(menPastelOff("dad", { name: "Crew Sweatshirt", href: "https://shop.example.com/p/crew?color=pink" })).toBe(true);
    // A classic colorway and a plain men's shoe stay.
    expect(menStyleWhy({ name: "Brand Wally Slip-On", type: "shoes", href: "https://shop.example.com/p/wally?color=navy" })).toBe("");
    expect(neonOff("dad", { name: "YETI Roadie 24", image: "https://x/roadie-chartreuse.png" })).toBe(true);
    expect(elderBootOff("mom", { name: "Muck Chelsea Boot", from: "mother-in-law" })).toBe(true);
    expect(elderBootOff("grandparents", { name: "Merino Boot Socks", from: "grandpa" })).toBe(false);
    expect(womenBlackCupOff("mom", { name: "Stanley Quencher 40 oz, Black", brand: "Stanley" })).toBe(true);
  });

  it("men's guides: no pink, pastel or funky colorway, women's footwear or women's link; no neon, elder boots or black cups", () => {
    const menRows = GUIDES.flatMap(([slug, picks]) => picks.filter((p) => [slug, p.from, p.sectionId].some((k) => MEN_COLOR_GUIDES.includes(String(k)))));
    expect(menRows.length).toBeGreaterThan(60);
    expect(menRows.filter((p) => MEN_PASTEL.test(p.name) || menStyleWhy(p) !== "").map((p) => p.name)).toEqual([]);
    expect(GUIDES.flatMap(([slug, picks]) => picks.filter((p) => ownerStyleOff(slug, p)).map((p) => `${slug}: ${p.name}`))).toEqual([]);
  });

  it("at most 2 pajamas per section on every guide", () => {
    const over: string[] = [];
    for (const [slug, picks] of GUIDES) {
      const n = new Map<string, number>();
      for (const p of picks) if (p.type === "pajamas" || /\b(pajamas?|pj set|sleep (set|dress))\b/i.test(p.name)) n.set(String(p.section), (n.get(String(p.section)) ?? 0) + 1);
      for (const [s, c] of n) if (c > 2) over.push(`${slug} / ${s}: ${c}`);
    }
    expect(over).toEqual([]);
  });

  it("Dad, Him and Grandpa each show at least 5 priced gifts under $25", () => {
    const under = (picks: Pick[]) => picks.filter((p) => typeof p.price === "number" && p.price < 25 && p.store !== "store-amazon").length;
    expect(under(CHUNKS.get("dad") ?? [])).toBeGreaterThanOrEqual(5);
    expect(under(CHUNKS.get("him") ?? [])).toBeGreaterThanOrEqual(5);
    expect(under((CHUNKS.get("grandparents") ?? []).filter((p) => p.section === "Grandpa"))).toBeGreaterThanOrEqual(5);
  });

  it("the freed spots: XTRATUF women's boots on Mom and Her, the UGG Evelina on Mom, a Nectarine Quencher and Eberjey on Mother-in-Law", () => {
    const mom = CHUNKS.get("mom") ?? [];
    expect(mom.some((p) => /^XTRATUF Women's/.test(p.name) && p.section === "Top picks" && typeof p.price === "number")).toBe(true);
    expect(mom.some((p) => /UGG .*Evelina/.test(p.name))).toBe(true);
    expect(mom.some((p) => /Quencher.*Nectarine/.test(p.name) && p.section === "Mother-in-Law")).toBe(true);
    expect(mom.some((p) => /^Eberjey/.test(p.name) && p.section === "Mother-in-Law")).toBe(true);
    expect((CHUNKS.get("her") ?? []).some((p) => /^XTRATUF Women's/.test(p.name))).toBe(true);
  });
});
