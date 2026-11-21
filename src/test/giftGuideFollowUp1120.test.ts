/**
 * Gift guides follow-up train 1120 (owner 2026-11-19 ~11:45 PM to 11-20 ~2:45 AM, FOLLOWUP-OWNER-1119.md from "MORE GUIDE
 * MERGES"), read from the shipped chunks, the merge table and the import's rule module:
 *   - ~30 guides: every guide the follow-up folded is a section of its new parent and opens parent#section;
 *   - no gift card and no 0% pick on any guide except a 25 Days sponsor's (and the owner's kept memberships);
 *   - no Kendra Scott, Labubu, Smiski, Sonny Angel, Lovesac or Fishwife anywhere, deals included;
 *   - every confirmed Louisiana sponsor (the Small Business Saturday cards) is on a Louisiana guide or named there;
 *   - the 26 store pages of the owner's final list, each 10-15 picks; ONE Weber griddle site-wide.
 *
 * @mutate scripts/giftGuideFollowUp1120.mjs |   if (p.commission === 0) return "0%"; |   if (p.commission === -1) return "0%";
 * @mutate scripts/giftGuideFollowUp1120.mjs |   if (fold(n).startsWith(fold(b)) \|\| fold(n).includes(fold(b))) return n; |   if (fold(n).startsWith(fold(b))) return n;
 * @mutate src/content/giftGuideMerges.mjs |   heroes: ["first-responders", "military"], |   heroes: ["first-responders"],
 * @mutate scripts/giftGuideFollowUp1120.mjs |     if (copy) { out.counts.skipped += 1; continue; } |     if (false) { out.counts.skipped += 1; continue; }
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import { GUIDE_MERGES, MERGED_INTO, STORE_PAGES_HELD, STORE_PAGES_KEPT } from "@/content/giftGuideMerges.mjs";
import { SECTION_ANCHORS } from "@/content/giftGuidePicks";
import { peopleGuideOf } from "@/content/giftGuidePeople.mjs";
import { GUIDES, newSlugFor } from "@/content/giftGuideCatalog";
import { blockedBrand } from "../../scripts/giftGuideBlocklist.mjs";
import { GIFT_CARD, auditActions1120, brandFirst, followUpOut, moveTarget, renameOf } from "../../scripts/giftGuideFollowUp1120.mjs";

type Pick = { name: string; brand?: string; href: string; commission?: number | null; sponsor?: boolean; from?: string; ownerPick?: boolean };
const DIR = "src/content/giftGuidePicks";
const CHUNKS = new Map<string, Pick[]>(readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")).picks as Pick[]]));
const SPONSORS = "25-days-sponsors";
const guideChunks = [...CHUNKS].filter(([s]) => !s.startsWith("store-") && s !== SPONSORS);
const EXCLUDED = /\b(kendra scott|labubu|smiski|sonny angel|lovesac|fishwife)\b/i;

describe("gift guides follow-up 1120", () => {
  it("folds the guides into ~30: every follow-up merge's old guides open their new parent at a section", () => {
    const want: Record<string, string[]> = {
      family: ["brother", "sister", "aunt", "uncle", "niece", "nephew", "couples", "newlyweds"], "friends-and-coworkers": ["friends", "best-friend", "boss", "coworkers", "secret-santa", "white-elephant"],
      heroes: ["first-responders", "firefighters", "military", "army", "veterans"], "work-life": ["educators", "teachers", "office-and-professional", "service-industry", "oilfield-and-trades", "welders", "farmers"],
      "outdoors-and-travel": ["hunters", "fishermen", "golfer", "lake-and-beach", "traveler", "gardener"], "home-and-kitchen": ["home-cook", "wine-lover", "cozy-and-self-care", "baker"],
      "creative-and-entertainment": ["creative-and-hobby", "book-lover", "entertainment", "gamer"], "gifts-by-budget": ["stocking-stuffers", "under-25", "under-50", "under-10", "gift-cards", "subscriptions"],
      "louisiana-celebrations": ["mardi-gras", "game-day", "tailgater", "crawfish-season"], "life-moments": ["new-baby-and-parents", "new-mom", "graduate", "new-homeowner", "get-well-soon", "thinking-of-you", "retiree"],
      kids: ["girls", "boys", "gender-neutral", "boys-babies"], teens: ["girls-teens", "boys-teens", "gender-neutral-teens"], pets: ["new-puppy", "dog-lover"],
    };
    for (const [parent, olds] of Object.entries(want)) {
      expect(GUIDE_MERGES.some((m) => m.parent === parent), parent).toBe(true);
      for (const s of olds) {
        expect(MERGED_INTO[s]?.parent, s).toBe(parent);
        const to = newSlugFor(s);
        // For Her / For Him (owner 11-20 evening): Brother and Sister are filter pages of those guides now.
        expect(to === parent || to === `${parent}#${SECTION_ANCHORS[s]}` || (peopleGuideOf(s) !== null && to === s), `${s} -> ${to}`).toBe(true);
      }
    }
    // Owner "FINAL MERGES -> ~30": 28 guides measured 2026-11-20.
    // A relationship filter page (Mom, Dad ... on For Her / For Him) is a view of its guide, not another guide.
    const shown = GUIDES.filter((g) => !g.empty && !g.slug.startsWith("store-") && !(g as { view?: unknown }).view);
    expect(shown.length).toBeGreaterThan(24);
    expect(shown.length).toBeLessThan(34);
  });

  it("no gift card and no 0% pick except a 25 Days sponsor's; the rule itself", () => {
    const sponsor = (p: { sponsor?: boolean }) => p.sponsor === true;
    const kept = () => false;
    expect(followUpOut({ name: "Starbucks eGift Card", commission: 0 }, { sponsor, kept })).toBe("gift card");
    expect(followUpOut({ name: "Gulf Blue Mug", commission: 0 }, { sponsor, kept })).toBe("0%");
    expect(followUpOut({ name: "Dupuy's Gift Certificate", commission: 0, sponsor: true }, { sponsor, kept })).toBe("");
    expect(followUpOut({ name: "Sam's Club Plus Membership", commission: 0 }, { sponsor, kept })).toBe("");
    expect(followUpOut({ name: "KREWE Sunglasses", commission: 16 }, { sponsor, kept })).toBe("");
    expect(followUpOut({ name: "Atlas Coffee Club Subscription", commission: null }, { sponsor, kept })).toBe("");
    let n = 0;
    const bad: string[] = [];
    for (const [slug, list] of guideChunks) {
      for (const p of list) {
        n += 1;
        if (p.sponsor || p.from === "subscriptions") continue;
        if (GIFT_CARD.test(p.name)) bad.push(`${slug}: gift card ${p.name}`);
        if (p.commission === 0) bad.push(`${slug}: 0% ${p.name}`);
      }
    }
    expect(n).toBeGreaterThan(1300);
    expect(bad).toEqual([]);
  });

  it("no Kendra Scott, Labubu, Smiski, Sonny Angel, Lovesac or Fishwife anywhere (picks, store pages, deals)", () => {
    for (const b of ["Kendra Scott", "Labubu", "Smiski", "Sonny Angel", "Lovesac", "Fishwife"]) expect(blockedBrand({ brand: b }), b).toBe(true);
    const bad = [...CHUNKS].flatMap(([slug, list]) => list.filter((p) => EXCLUDED.test(`${p.name} ${p.brand ?? ""}`)).map((p) => `${slug}: ${p.name}`));
    expect(bad).toEqual([]);
    expect(CHUNKS.has("store-kendra-scott")).toBe(false);
    expect(readFileSync("src/content/giftGuideDeals.json", "utf8")).not.toMatch(EXCLUDED);
    expect(readFileSync("src/content/giftGuidesAmazon.ts", "utf8")).not.toMatch(/Kendra Scott/);
  });

  it("every confirmed Louisiana sponsor is on a Louisiana guide with the sponsor badge, or named there", () => {
    const biz = JSON.parse(readFileSync("src/content/giftGuideSmallBiz.json", "utf8")) as { name: string; href?: string }[];
    expect(biz.length).toBeGreaterThan(40);
    const picks = readFileSync("src/content/giftGuidePicks.ts", "utf8");
    const named = JSON.parse(/NAME_ONLY_SPONSORS: Record<string, string\[\]> = (\{.*?\});/.exec(picks)![1]) as Record<string, string[]>;
    const shown = [...(CHUNKS.get("shop-small-louisiana") ?? []), ...(CHUNKS.get("louisiana-by-region") ?? [])];
    const missing = biz.filter((b) => {
      const name = b.name.replace(/\s*\([^)]*\)\s*$/, "");
      return !shown.some((p) => p.sponsor && (p.name === name || (b.href && p.href === b.href))) && !(named["shop-small-louisiana"] ?? []).includes(name);
    }).map((b) => b.name);
    expect(missing).toEqual([]);
    expect(shown.filter((p) => p.sponsor).length).toBeGreaterThan(35);
  });

  it("the 26 store pages of the owner's final list, each 10-15 picks; one Weber griddle site-wide", () => {
    // Train 1120b: TJ Maxx and JCPenney are held (folded) until refilled; the owner's list is still these 26.
    expect([...STORE_PAGES_KEPT, ...STORE_PAGES_HELD].sort()).toEqual(["store-amazon", "store-apple", "store-at-home", "store-bass-pro-shops", "store-bath-and-body-works", "store-baublebar", "store-best-buy",
      "store-carhartt", "store-coach", "store-crocs", "store-dicks-sporting-goods", "store-dillards", "store-hoka", "store-jcpenney", "store-lululemon", "store-nike", "store-old-navy",
      "store-sams-club", "store-sephora", "store-stanley", "store-target", "store-tj-maxx-marshalls", "store-tractor-supply", "store-ulta-beauty", "store-walmart", "store-yeti"]);
    // Train 1120b (2026-11-20): TJ Maxx's hotlink-blocked photos and JCPenney's house-brand picks are out; both pages
    // wait for a refill. EXACT (src/test/giftGuideTrain1120b.test.ts holds the same two).
    const SHORT: Record<string, number> = {};
    for (const s of STORE_PAGES_KEPT) {
      const n = CHUNKS.get(s)?.length ?? 0;
      expect(n, s).toBeGreaterThanOrEqual(SHORT[s] ?? 10);
      expect(n, s).toBeLessThanOrEqual(15);
    }
    const griddles = [...CHUNKS.values()].flat().filter((p) => /\bweber\b/i.test(`${p.brand ?? ""} ${p.name}`) && /\bgriddle\b/i.test(p.name));
    expect(griddles.length).toBe(1);
  });

  it("maps the audits' fixes: a store-page copy stays, a 0% cut leaves its guide, a move finds its section, a rename puts the brand first", () => {
    // A finding as the audit files write it (its section named by its title on the big batch's guide).
    const finding = (title: string) => Object.fromEntries([["file", "x"], ["guide", "work-gifts"], ["section", title], ["item", "Thing"]]) as { file: string; guide: string; section: string; item: string };
    const row = (fix: string, problem: string, extra: Record<string, string> = {}) => ({ ...finding("Coworkers"), href: "https://go.shopmy.us/p-1", fix, problem, move_to: "", ...extra });
    const a = auditActions1120([
      row("replace_image", "same item/image also on: store-yeti (owner rule ...)"),
      row("replace_link", "Commission 0 and not a 25 Days sponsor"),
      row("replace_link", "Commission None and not a 25 Days sponsor", { href: "https://go.shopmy.us/p-2" }),
      row("remove", "no price on file but retail is about $500-$800 (rule: nothing over $500)", { href: "https://go.shopmy.us/p-3" }),
      row("move", "pricey for a coworker gift", { href: "https://go.shopmy.us/p-4", move_to: "Boss" }),
    ], (g, s) => (s === "Boss" ? "boss" : s === "Coworkers" ? "coworkers" : g));
    expect([...a.storeCuts]).toEqual([]);
    expect(a.cuts).toEqual([{ slug: "coworkers", href: "https://go.shopmy.us/p-1", item: "Thing" }]);
    expect(a.moves).toEqual([{ href: "https://go.shopmy.us/p-4", from: "coworkers", to: "boss" }]);
    expect(Object.values(moveTarget("splurge", "splurge#$100 & Up") ?? {})).toEqual(["splurge", "$100 & Up"]);
    expect(brandFirst("Pecan Pralines 12 Count Tin", "Aunt Sally's")).toBe("Aunt Sally's Pecan Pralines 12 Count Tin");
    expect(brandFirst("Aunt Sally's Pecan Pralines", "Aunt Sally's")).toBe("Aunt Sally's Pecan Pralines");
    expect(brandFirst("Classic Clog", "Amazon")).toBe("Classic Clog");
    expect(brandFirst("Mini Pralines by Aunt Sally's", "Aunt Sally's")).toBe("Mini Pralines by Aunt Sally's");
    expect(renameOf({ ...row("rename", 'Junk name; should be "Logitech MX Master 3S Wireless Mouse"') }, "Mx Master", "Logitech")).toBe("Logitech MX Master 3S Wireless Mouse");
  });
});
