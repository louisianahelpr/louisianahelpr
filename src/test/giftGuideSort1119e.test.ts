/**
 * Gift guides sort pass 1119e (owner 2026-11-19 evening), read from the shipped chunks:
 *   - "Organize all of our gift guides by highest commission at the top to lowest commission at bottom": every guide pick
 *     carries its effective `commission` (null = unknown) and each guide lists high to low, unknown last;
 *   - "Only do 25 per guide": no non-store guide holds more than GUIDE_CAP;
 *   - "don't have 7 cup choices in 1 guide": every pick carries its gift `type`, at most TYPE_MAX of one type per guide
 *     (more only where the guide's topic is that type, THEME_TYPES);
 *   - a Creator Connections swap pays the campaign total only while it runs, then the old link's rate is read again.
 * Big batch 1120: a merged guide (src/content/giftGuideMerges.mjs) holds its old guides as sections; each section is
 * one list here (its own commission order, 25 cap and type caps, read with the old guide's slug).
 *
 * @mutate scripts/giftGuideSort.mjs | export const GUIDE_CAP = 25; | export const GUIDE_CAP = 30;
 * @mutate scripts/giftGuideSort.mjs | export const TYPE_MAX = 2; | export const TYPE_MAX = 7;
 * @mutate scripts/giftGuideSort.mjs |   const ca = typeof a.commission === "number" ? a.commission : -1; |   const ca = 0;
 * @mutate scripts/giftGuideSort.mjs | export const ccLive = (c, today) => Boolean(c) && | export const ccLive = (c, today) => Boolean(c) \|\|
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readdirSync } from "./helpers/trackedFiles";
import { PEOPLE_GUIDES } from "@/content/giftGuidePeople.mjs";
import { LA_MEN_FIRST } from "../../scripts/giftGuidePeople1120.mjs";
import { GUIDE_CAP, TYPE_MAX, buildRateData, byCommission, commissionOf, pickType, typeMax } from "../../scripts/giftGuideSort.mjs";

type Pick = { name: string; brand?: string; href: string; image?: string; commission?: number | null; type?: string; swappedFrom?: string; campaignEnds?: string; sectionId?: string; from?: string; ownerPick?: boolean; sponsor?: boolean };
const DIR = "src/content/giftGuidePicks";
const pageOf = (slug: string): Pick[] => (existsSync(`${DIR}/${slug}.json`) ? JSON.parse(readFileSync(`${DIR}/${slug}.json`, "utf8")).picks : []);
/** Lists with their own order (scripts/gift-guide-picks.mjs SORT_FIXED) keep it; the sponsors guide is a sponsor list. */
const FIXED = new Set(["subscriptions", "gift-cards", "gift-wrap-and-cards", "mail-carrier-and-delivery-drivers", "25-days-sponsors"]);
const guideSlugs = readdirSync(DIR).filter((f: string) => f.endsWith(".json")).map((f: string) => f.replace(/\.json$/, "")).filter((s: string) => !s.startsWith("store-") && s !== "25-days-sponsors");
const PEOPLE_SLUGS = new Set<string>(PEOPLE_GUIDES.map((g: { slug: string }) => g.slug));
/** Each list a shopper reads as one: a guide, or each section of a merged guide (its old slug; "top-picks" is the guide's own). */
const sectionLists = (): [string, Pick[]][] => guideSlugs.flatMap((slug: string) => {
  const by = new Map<string, Pick[]>();
  for (const p of pageOf(slug)) {
    const k = p.sectionId && PEOPLE_SLUGS.has(slug) ? `${slug}/${p.sectionId}` : p.sectionId && p.sectionId !== "top-picks" ? p.sectionId : slug;
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  return [...by.entries()];
});
const lists = sectionLists();
/** The For Her / For Him interest sections, each its own list ("her/under-25"). */
const PEOPLE = new Set(PEOPLE_GUIDES.flatMap((g: { slug: string; sections: { id: string }[] }) => g.sections.map((s) => `${g.slug}/${s.id}`)));
const guides = lists.map(([slug]) => slug);
const pageOfList = new Map(lists);

describe("gift guides: sort pass 1119e (commission order, 25 cap, type variety)", () => {
  it("reads the owner's numbers", () => {
    expect(GUIDE_CAP).toBe(25);
    expect(TYPE_MAX).toBe(2);
  });

  it("every guide pick carries its commission and type; each guide lists by commission, high to low, unknown last", () => {
    expect(guides.length).toBeGreaterThan(55); // audits A+B combined (11-20): 62 lists measured; // follow-up 1120: ~30 guides + 26 store pages, measured 2026-11-20 (86 lists)
    const bad: string[] = [];
    let picks = 0;
    let known = 0;
    for (const slug of guides) {
      const list = pageOfList.get(slug)!;
      for (const p of list) {
        picks += 1;
        if (!("commission" in p) || !(p.commission === null || typeof p.commission === "number")) bad.push(`${slug}: no commission: ${p.name}`);
        if (typeof p.type !== "string" || !p.type) bad.push(`${slug}: no type: ${p.name}`);
        if (typeof p.commission === "number") known += 1;
      }
      if (FIXED.has(slug)) continue;
      const rate = (p: Pick) => (typeof p.commission === "number" ? p.commission : -1);
      // A list with its own order (FIXED) that joined a section keeps it, leading; the rest are by commission.
      // His Classic Style leads with the brands Louisiana men wear (owner 11-20), each group by commission.
      const sorted = list.filter((p) => !FIXED.has(p.from ?? "")).filter((p) => slug !== "him/classic-style" || !LA_MEN_FIRST.test(String(p.brand ?? "").trim()));
      sorted.forEach((p, i) => { if (i > 0 && rate(p) > rate(sorted[i - 1])) bad.push(`${slug} #${i + 1}: ${p.name} (${p.commission}) above-rate after ${sorted[i - 1].name} (${sorted[i - 1].commission})`); });
    }
    // Follow-up 1120: ~1,500 guide picks on the ~30 guides, measured 2026-11-20 (2,000+ on the 65 guides before).
    expect(picks).toBeGreaterThan(1000); // audits A+B combined (11-20): ~1,130 measured
    expect(known).toBeGreaterThan(1000); // owner standard 11-20 (Healthcare by use): 1,078 measured
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("no non-store guide holds more than 25 picks, nor more than its cap of one gift type", () => {
    const bad: string[] = [];
    for (const slug of guides) {
      const list = pageOfList.get(slug)!;
      if (list.length > GUIDE_CAP) bad.push(`${slug}: ${list.length} picks`);
      if (FIXED.has(slug)) continue;
      const n = new Map<string, number>();
      for (const p of list.filter((x) => !FIXED.has(x.from ?? ""))) n.set(p.type ?? "other", (n.get(p.type ?? "other") ?? 0) + 1);
      // A section's cap of a type is its old guides' (Artists may hold more art supplies; 1120 section groups).
      const cap = (t: string) => Math.max(typeMax(slug, t), ...list.filter((p) => (p.type ?? "other") === t).map((p) => typeMax(p.from ?? slug, t)));
      // Follow-up 1120 (lead 11-20: "her picks beat our rules except her own firm rules"): the owner's own picks are not
      // held to the type cap, and ours give way to them (ours never push a type past its cap).
      // For Her / For Him 1120: a 25 Days sponsor's one spot and a joined campaign keep their place past the cap too.
      const mine = (t: string) => list.filter((p) => !FIXED.has(p.from ?? "") && (p.ownerPick || (PEOPLE.has(slug) && (p.sponsor || p.campaignEnds))) && (p.type ?? "other") === t).length;
      for (const [t, c] of n) if (c - mine(t) > Math.max(0, cap(t) - mine(t))) bad.push(`${slug}: ${c} x ${t}`);
    }
    expect(bad).toEqual([]);
  });

  it("names the gift type the way a shopper would (singular and plural, the specific kind first)", () => {
    const cases: [string, string, string][] = [
      ["Kiehl's 5 O'Clock Shadow Shavers Gift Set", "Kiehl's", "grooming"],
      ["Weber Original Kettle Grill (22 in.)", "Weber", "grill"],
      ["Horse Print Sherpa Fleece Throw Blanket", "", "throw-blanket"],
      ["YETI Rambler 20 oz Tumbler with MagSlider Lid", "YETI", "drinkware"],
      ["Stanley Quencher H2.0 FlowState Tumbler 40 oz", "Stanley", "drinkware"],
      ["L'Occitane Shea Collection Gift Set", "L'OCCITANE", "skincare"],
      ["Alpha Industries MA-1 Slim Fit Bomber, Woodland Camo", "Alpha Industries", "jacket"],
      ["HEYDUDE Paul Pro Classic", "HEYDUDE", "shoes"],
      ["Smathers & Branson Fishing Flies Needlepoint Belt", "Smathers & Branson", "belt"],
      ["3M Littmann Classic III Stethoscope, Caribbean Blue", "Littmann", "stethoscope"],
      ["Capri Blue Volcano Candle", "Capri Blue", "candle"],
    ];
    for (const [name, brand, type] of cases) expect(pickType({ name, brand }), name).toBe(type);
  });

  it("reads each network's rate; a Creator Connections total pays only while the campaign runs", () => {
    const data = buildRateData({
      shopmyTsv: "id\tstore\tname\trate\tcreated\tclicks\torders\np-1\tStanley\tQuencher\t18%\tNov 19th\t4\t-\n",
      rowsWithRate: [{ href: "https://go.shopmy.us/p-2", commission_pct: "15%" }],
      campaigns: [{ campaign_id: "c1", opted_in: true, asins: ["B000000001"], total_pct: 33, bonus_pct: 23, starts: "2026-11-01", ends: "2026-12-17" },
        { campaign_id: "c2", opted_in: false, asins: ["B000000002"], total_pct: 30, bonus_pct: 26, starts: "2026-11-01", ends: "2027-01-01" }],
    });
    const amazon = (asin: string) => ({ name: "Kiehl's Ultra Facial Cream", brand: "Kiehl's", href: `https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20` });
    expect(commissionOf({ name: "Quencher", brand: "Stanley", href: "https://go.shopmy.us/p-1" }, data, "2026-11-19").pct).toBe(18);
    expect(commissionOf({ name: "Throw", brand: "Barefoot Dreams", href: "https://go.shopmy.us/p-2" }, data, "2026-11-19").pct).toBe(15);
    expect(commissionOf({ name: "Throw", brand: "x", href: "https://go.shopmy.us/p-3" }, data, "2026-11-19").pct).toBeNull();
    expect(commissionOf(amazon("B000000001"), data, "2026-11-19").pct).toBe(33);
    // After the end date the Associates base rate (10% luxury beauty) is read again: the swap reverts on the next run.
    expect(commissionOf(amazon("B000000001"), data, "2026-12-18").pct).toBe(10);
    // A campaign not joined pays no bonus (owner 11-19: joined campaigns only).
    expect(commissionOf(amazon("B000000002"), data, "2026-11-19").pct).toBe(10);
    expect(commissionOf({ name: "Pralines", brand: "Aunt Sally's", href: "https://auntsallys.com/products/pralines" }, data, "2026-11-19").pct).toBe(0);
    const sorted = [{ name: "a", commission: null }, { name: "b", commission: 4 }, { name: "c", commission: 33 }, { name: "d", commission: 12 }].sort(byCommission).map((p) => p.name);
    expect(sorted).toEqual(["c", "d", "b", "a"]);
  });
});
