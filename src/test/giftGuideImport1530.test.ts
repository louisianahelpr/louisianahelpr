/**
 * Gift guides, import train 1530 (lead 11-19, before the owner's Friday post):
 *   - one link or one photo on ONE non-store guide; a second guide only for another colorway (owner 2026-11-19: "the 2 items per
 *     product should be different colors"); an owner pick keeps every guide she named for it;
 *   - no Camp Snap on Teen Boy (owner);
 *   - the Amazon and Walmart store pages keep their 15 best, and no store page lists one link twice;
 *   - duplicate store slugs fold into one canonical page, and each old slug redirects (MERGED_GUIDES);
 *   - no photo on ShopMy's dead S3 host ships (the CDN swap, _shopmy-cdn-photos.json);
 *   - no kids' toy (Breyer figurine, plush, toy horse, playset) on an adult hobby guide (owner: the toy horse on Horse Lover).
 * Read from the shipped chunks, so a regenerated import that drops a rule turns this red.
 *
 * @mutate scripts/gift-guide-picks.mjs | export const SAME_ITEM_MAX = 1; | export const SAME_ITEM_MAX = 9;
 * @mutate scripts/giftGuideRules.mjs | export const ADULT_HOBBY_GUIDES = ["horse-lover"]; | export const ADULT_HOBBY_GUIDES = [];
 * @mutate scripts/gift-guide-picks.mjs | export const STORE_CAP = 15; | export const STORE_CAP = 1500;
 * @mutate scripts/gift-guide-picks.mjs | .filter((g) => !/\bcamp snap\b/i.test(`${r.brand ?? ""} ${r.name}`) \|\| g !== "boys-teens"); | ;
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GUIDE_GROUPS, KIDS_TOY, SHOPMY_S3, kidsToyOff, shopmyCdnUrl } from "../../scripts/giftGuideRules.mjs";
import { MERGED_GUIDES, guideBySlug } from "@/content/giftGuideCatalog";
import { sectionChunks, sectionPageOf } from "./helpers/giftGuideSections";

type Pick = { name: string; brand?: string; href: string; image?: string; ownerPick?: true; store?: string };
const DIR = "src/content/giftGuidePicks";
// Big batch 1120: a merged guide's section is read under its old slug (helpers/giftGuideSections.ts).
const pageOf = (slug: string): Pick[] => sectionPageOf<Pick>(slug);
const slugs = Object.keys(sectionChunks()).filter((s: string) => s !== "25-days-sponsors");
const guides = slugs.filter((s: string) => !s.startsWith("store-"));
const stores = slugs.filter((s: string) => s.startsWith("store-"));
// The index groups, as the import reads them (kidsToyOff checks the Hobbies group).
for (const m of readFileSync("src/content/giftGuideIndex.ts", "utf8").matchAll(/group: "([^"]+)"[^}]*?slug: "([^"]+)"/g)) GUIDE_GROUPS.set(m[2], m[1]);
const ownerGuides = new Map<string, string[]>();
{
  const f = `${process.env.HOME}/Desktop/Gift-guide-picks/_owner-picks.json`;
  if (existsSync(f)) for (const r of JSON.parse(readFileSync(f, "utf8")) as { href?: string; guides?: string[] }[]) if (r.href && Array.isArray(r.guides)) ownerGuides.set(r.href, r.guides);
}

describe("gift guides: import train 1530", () => {
  it("one link and one photo per guide set; a second guide is another colorway (owner picks keep her guides)", () => {
    const byKey = new Map<string, Set<string>>();
    let n = 0;
    for (const s of guides) for (const p of pageOf(s)) {
      n += 1;
      // An owner pick on a guide she named is hers to repeat.
      if (p.ownerPick && (ownerGuides.get(p.href)?.includes(s) ?? true)) continue;
      for (const k of [`h:${p.href}`, ...(p.image ? [`i:${p.image}`] : [])]) byKey.set(k, new Set([...(byKey.get(k) ?? []), s]));
    }
    expect(n).toBeGreaterThan(1100); // holiday audit A (11-20): page-level type caps, cuts and thin-section folds; measured 2026-11-20: 1,221; // follow-up 1120: ~1,480 rows; train 1120b re-audit cuts and two held store pages: 1,380 measured 2026-11-20
    expect([...byKey].filter(([, v]) => v.size > 1).map(([k, v]) => `${k} on ${[...v].join(", ")}`)).toEqual([]);
  });

  it("no Camp Snap on Teen Boy", () => {
    // Follow-up 1120: Teens mixes girls, boys and any in one section of Kids (25 max), so fewer boys-teens rows.
    expect(pageOf("boys-teens").length).toBeGreaterThan(1);
    expect(pageOf("boys-teens").filter((p) => /camp snap/i.test(`${p.brand ?? ""} ${p.name}`)).map((p) => p.name)).toEqual([]);
  });

  it("Amazon and Walmart keep their 15 best; no store page lists one link or name twice", () => {
    for (const s of ["store-amazon", "store-walmart"]) {
      expect(pageOf(s).length, s).toBeGreaterThanOrEqual(10);
      expect(pageOf(s).length, s).toBeLessThanOrEqual(15);
    }
    // Follow-up 1120 (owner 11-20 ~2:45 AM, FINAL STORE LIST): 26 kept store pages, 25+ with picks measured 2026-11-20.
    expect(stores.length).toBeGreaterThan(20);
    for (const s of stores) {
      const hrefs = pageOf(s).map((p) => p.href);
      const names = pageOf(s).map((p) => p.name.toLowerCase());
      expect(hrefs.filter((h, i) => hrefs.indexOf(h) !== i), s).toEqual([]);
      expect(names.filter((h, i) => names.indexOf(h) !== i), s).toEqual([]);
    }
  });

  it("each duplicate store slug redirects to one canonical page that holds its picks", () => {
    const merged = Object.entries(MERGED_GUIDES).filter(([from]) => from.startsWith("store-"));
    expect(merged.length).toBeGreaterThan(25);
    for (const [from, [to]] of merged) {
      expect(guideBySlug(from), from).toBeUndefined();
      expect(existsSync(`${DIR}/${from}.json`), from).toBe(false);
      expect(to.startsWith("store-"), to).toBe(true);
    }
    for (const s of guides) for (const p of pageOf(s)) expect(p.store && MERGED_GUIDES[p.store] ? `${s}: ${p.name} -> ${p.store}` : "").toBe("");
  });

  it("no photo on ShopMy's dead S3 host ships; the CDN swap maps the same key", () => {
    expect(shopmyCdnUrl("https://production-shopmyshelf-uploads.s3.us-east-2.amazonaws.com/pretty-prod-1")).toBe("https://static.shopmy.us/uploads/pretty-prod-1");
    expect(shopmyCdnUrl("https://production-shopmyshelf-pins.s3.us-east-2.amazonaws.com/zoom-1-2-a")).toBe("https://static.shopmy.us/pins/zoom-1-2-a");
    expect(shopmyCdnUrl("https://static.shopmy.us/uploads/x")).toBeNull();
    const bad = slugs.flatMap((s: string) => pageOf(s).filter((p) => p.image && SHOPMY_S3.test(p.image)).map((p) => `${s}: ${p.name}`));
    expect(bad).toEqual([]);
  });

  it("no kids' toy on an adult hobby guide (owner: the toy horse on Horse Lover)", () => {
    expect(KIDS_TOY.test("Breyer Freedom Series Palomino Saddlebred")).toBe(true);
    expect(kidsToyOff("horse-lover", { name: "Horsemen's Pride Jolly Ball Horse Toy" })).toBe(false);
    expect(pageOf("horse-lover").length).toBeGreaterThan(2);
    const bad = guides.flatMap((s: string) => pageOf(s).filter((p) => !p.ownerPick && kidsToyOff(s, p)).map((p) => `${s}: ${p.name}`));
    expect(bad).toEqual([]);
  });
});
