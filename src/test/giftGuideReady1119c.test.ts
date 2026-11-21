/**
 * Gift guides, ready pass 1119c (owner 11-19: the guides are "not ready for people to see"; FOLLOWUP-OWNER-1119.md):
 *   - no pick over $500 on any page (owner: "like 500 is the max");
 *   - a product shows in at most 2 non-store guides (owner 1:25 PM: "no more than 2 duplicates");
 *   - no non-gift service brand (rentals, CBD, alarms, TV/DVR, wigs, VPNs, insurance, software...) on any page;
 *   - no JD Sports listing on a guide; Community Coffee is off Louisiana Made (food lives in the food guides);
 *   - the obscure affiliate-network brands the owner did not recognize (blocklist) show on no page.
 * Read from the shipped chunks, so a regenerated import that drops a rule turns this red.
 *
 * @mutate scripts/giftGuideRules.mjs | export const DUP_GUIDE_MAX = 2; | export const DUP_GUIDE_MAX = 9;
 * @mutate scripts/giftGuideRules.mjs | export const PRICE_MAX = 500; | export const PRICE_MAX = 5000;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DUP_GUIDE_MAX, NON_GIFT_SERVICE, PRICE_MAX, nonGiftService } from "../../scripts/giftGuideRules.mjs";
import { blockedBrand } from "../../scripts/giftGuideBlocklist.mjs";
import { sectionChunks, sectionPageOf } from "./helpers/giftGuideSections";

type Pick = { name: string; brand?: string; href: string; affiliate_href?: string; image?: string; price?: number; ownerPick?: true; retailer?: string; store?: string };
// Big batch 1120: a merged guide's section is read under its old slug (helpers/giftGuideSections.ts).
const pageOf = (slug: string): Pick[] => sectionPageOf<Pick>(slug);
// The owner's own exceptions the generator keeps past the rules (OWNER_KEEP in scripts/gift-guide-picks.mjs, read from
// its source so there is one list): owner 11-19 "you can leave the Dyson for Mom", over the $500 cap.
const OWNER_KEEP: { guide: string; href: string }[] = JSON.parse(
  (/export const OWNER_KEEP = (\[.*?\]);/.exec(readFileSync(join(process.cwd(), "scripts/gift-guide-picks.mjs"), "utf8"))?.[1] ?? "[]")
    .replace(/([{,]\s*)(\w+):/g, '$1"$2":'),
);
const ownerKept = (slug: string, p: Pick) => OWNER_KEEP.some((k) => k.guide === slug && k.href === p.href);
const slugs = Object.keys(sectionChunks()).filter((s: string) => s !== "25-days-sponsors");
const guides = slugs.filter((s: string) => !s.startsWith("store-"));

describe("gift guides: ready pass 1119c", () => {
  it("the rules hold the owner's numbers", () => {
    expect(PRICE_MAX).toBe(500);
    expect(DUP_GUIDE_MAX).toBe(2);
    for (const s of ["CBD Gummies", "Home Warranty Gift", "NordVPN 1 Year", "Kidde Smoke Alarm", "Lace Front Wig", "TiVo Edge DVR", "Car Rental Credit"]) expect(NON_GIFT_SERVICE.test(s), s).toBe(true);
    for (const s of ["YETI Rambler 20 oz", "Barefoot Dreams CozyChic Throw", "Owala FreeSip"]) expect(NON_GIFT_SERVICE.test(s), s).toBe(false);
  });

  it("no pick over $500, no non-gift service and no blocked brand on any page", () => {
    expect(OWNER_KEEP.length, "OWNER_KEEP read from scripts/gift-guide-picks.mjs").toBeGreaterThan(0);
    let n = 0;
    const bad = slugs.flatMap((s: string) => pageOf(s).filter((p) => {
      n += 1;
      return !ownerKept(s, p) && ((typeof p.price === "number" && p.price > PRICE_MAX) || nonGiftService(s, p) || blockedBrand(p));
    }).map((p) => `${s}: ${p.name}`));
    expect(n).toBeGreaterThan(270); // audits A+B combined (11-20): 1,402 to 1,456 rows measured on ~30 guides + 26 store pages
    expect(bad).toEqual([]);
  });

  it("a product shows in at most 2 guides", () => {
    const where = new Map<string, Set<string>>();
    for (const s of guides) for (const p of pageOf(s)) where.set(p.href, new Set([...(where.get(p.href) ?? []), s]));
    expect(where.size).toBeGreaterThan(85);
    const bad = [...where].filter(([, g]) => g.size > DUP_GUIDE_MAX).map(([h, g]) => `${h}: ${[...g].join(" ")}`);
    expect(bad).toEqual([]);
  });

  it("no JD Sports listing on a guide; Community Coffee is off Louisiana Made", () => {
    const jd = guides.flatMap((s: string) => pageOf(s).filter((p) => /\bjd ?sports\b|jdsports\./i.test(`${p.retailer ?? ""} ${p.store ?? ""} ${p.href} ${p.affiliate_href ?? ""} ${p.image ?? ""}`)).map((p) => `${s}: ${p.name}`));
    expect(jd).toEqual([]);
    expect(pageOf("louisiana-made").length).toBeGreaterThan(1); // 1120: a section of Shop Small Louisiana
    expect(pageOf("louisiana-made").filter((p) => /community coffee/i.test(`${p.name} ${p.brand ?? ""}`)).map((p) => p.name)).toEqual([]);
  });
});
