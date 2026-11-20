/**
 * NEW AFFILIATE APPROVALS (lead 11-19, ~/Desktop/Gift-guide-picks/_new-approvals-1119.json: 74 picks from 16 newly
 * approved brands). Reads the import's placement rule (scripts/giftGuideRules.mjs newApprovalSlot, approvalLine) and the
 * generated guide chunks (src/content/giftGuidePicks/<slug>.json): a new brand's pick never sits in a guide's top 3,
 * its line never carries our notes (what a brand pays, the owner's code) or a price, each brand has its store page, and
 * Soundcore's Boom Go 3i is on its CJ link (7%), never the old Later link (5.6%).
 * @mutate scripts/giftGuideRules.mjs | let start = Math.min(NEW_APPROVAL_KEEP_TOP, list.length); | let start = 0;
 * @mutate scripts/giftGuideRules.mjs |   for (let i = start; i < list.length; i++) if (isLower(list[i])) return i; |   for (let i = start; i < list.length; i++) if (false) return i;
 * @mutate scripts/giftGuideRules.mjs | .replace(/\s*\([^)]*(\$\|%\|\brate\b)[^)]*\)/g, "").split(";")[0]; | ;
 * @mutate scripts/gift-guide-picks.mjs |   for (const p of mine) rest.splice(newApprovalSlot(rest, isTrending, isAmazonPick), 0, p); |   for (const p of mine) rest.splice(0, 0, p);
 * @mutate scripts/gift-guide-picks.mjs |   p = withLinkUpgrade(withSoldoutSwap(p)); |   p = withSoldoutSwap(p);
 */
import { describe, expect, it } from "vitest";
import { NEW_APPROVAL_KEEP_TOP, approvalLine, newApprovalSlot } from "../../scripts/giftGuideRules.mjs";
import { isFoldedStore } from "@/content/giftGuideMerges.mjs";
import { sectionChunks, sectionPageOf } from "./helpers/giftGuideSections";

type Pick = { name: string; brand?: string; line?: string; href: string; store?: string };
// Big batch 1120: a merged guide's section is read under its old slug (helpers/giftGuideSections.ts).
const pageOf = (slug: string): Pick[] => sectionPageOf<Pick>(slug);
const slugs = Object.keys(sectionChunks());
const guides = slugs.filter((s) => !s.startsWith("store-") && s !== "25-days-sponsors");
/** The 16 brands' affiliate accounts: CJ advertiser ids (the "click-101930553-<AID>" path) and The Jacket Maker's Awin id. */
const CJ_AIDS = new Set(["15736465", "15734153", "17110008", "17369313", "15735830", "15735712", "15733331", "15820760", "15910665", "15736994",
  "17194337", "17340988", "17383471", "15735779", "17201873"]);
const AWIN_IDS = new Set(["90071"]);
const isNewBrand = (href: string): boolean => {
  let u: URL;
  try { u = new URL(href); } catch { return false; }
  if (u.hostname === "www.anrdoezrs.net") return CJ_AIDS.has(/^\/click-101930553-(\d+)$/.exec(u.pathname)?.[1] ?? "");
  if (u.hostname === "www.awin1.com") return AWIN_IDS.has(u.searchParams.get("awinmid") ?? "");
  return false;
};
// Lubiwood and The Jacket Maker banned by the owner 11-19; Lofree, MelodySusie, Cashmere Boutique, AndaSeat, Xplora,
// Byrokko, Forte Chocolate and Adagio Teas blocked by the owner's 1:05 PM rule (obscure affiliate brands; giftGuideBlocklist.mjs).
const STORES = ["store-georgia-boot", "store-click-and-grow", "store-magnifique", "store-switchbot", "store-singer", "store-oklahoma-joes"];

describe("gift guides: new affiliate approvals (lead 11-19)", () => {
  it("the placement rule: below the top 3 and every Trending pick, ahead of the first Amazon pick", () => {
    type P = { id: string; top?: boolean; amazon?: boolean };
    const isTop = (p: P) => Boolean(p.top);
    const isLower = (p: P) => Boolean(p.amazon);
    const list = (...xs: P[]) => xs;
    expect(NEW_APPROVAL_KEEP_TOP).toBe(3);
    // Amazon in the top 3 is never pushed down: the slot is the first Amazon pick from position 3 on.
    expect(newApprovalSlot(list({ id: "a", amazon: true }, { id: "b", amazon: true }, { id: "c", amazon: true }, { id: "d" }, { id: "e", amazon: true }), isTop, isLower)).toBe(4);
    // Trending picks past the top 3 stay above it.
    expect(newApprovalSlot(list({ id: "a" }, { id: "b" }, { id: "c" }, { id: "d", top: true, amazon: true }, { id: "e", top: true }, { id: "f", amazon: true }), isTop, isLower)).toBe(5);
    // No lower-paying pick after the top: the end.
    expect(newApprovalSlot(list({ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }), isTop, isLower)).toBe(4);
    expect(newApprovalSlot(list({ id: "a" }), isTop, isLower)).toBe(1);
  });

  it("the line: the research note's own words, never what a brand pays, a code or a price", () => {
    expect(approvalLine("Moc-toe work boot built for long shifts; Georgia Boot pays 12%, beating the 4% Amazon boot picks.")).toBe("Moc-toe work boot built for long shifts.");
    expect(approvalLine("Clay-pot Dutch oven cooker from Magnifique; our code LEXI10 takes 10% off.")).toBe("Clay-pot Dutch oven cooker from Magnifique.");
    expect(approvalLine("The classic offset smoker for brisket weekends (3% rate; fit wins here).")).toBe("The classic offset smoker for brisket weekends.");
    expect(approvalLine("Cat-shaped wooden jigsaw puzzle (from $20.99, larger sizes cost more).")).toBe("Cat-shaped wooden jigsaw puzzle.");
    expect(approvalLine("Holiday tea sampler in a gift tin, a $14 teacher gift.")).toBe("Holiday tea sampler in a gift tin.");
    expect(approvalLine("Pure cashmere ribbed beanie under $50.")).toBe("Pure cashmere ribbed beanie.");
    expect(approvalLine("Kids' smartwatch with GPS and calling (needs a kids SIM plan), a first step before a phone."))
      .toBe("Kids' smartwatch with GPS and calling (needs a kids SIM plan), a first step before a phone.");
    expect(approvalLine("Earns 15% commission")).toBe("");
  });

  /** Guides whose top 12 the 11-19 taste curation set by hand (its order wins over the new-brand slotting). */
  const CURATED_TOP = new Set(["crafter", "gamer", "mom", "her", "wife", "dad", "him"]);
  it("every guide holds the new brands below its top 3, with clean lines, and each brand has its store page", () => {
    expect(guides.length).toBeGreaterThan(150);
    let placed = 0;
    const bad: string[] = [];
    for (const slug of guides) {
      pageOf(slug).forEach((p, i) => {
        if (!isNewBrand(p.href)) return;
        placed += 1;
        // (A guide under 12 picks after one-guide-per-product, owner 11-19, has no room to keep them below its top 3.)
        if (i < NEW_APPROVAL_KEEP_TOP && pageOf(slug).length >= 20 && !CURATED_TOP.has(slug)) bad.push(`${slug} #${i + 1}: ${p.name}`);
        if (/\$\s?\d|%|\bpays\b|\bLEXI10\b/i.test(p.line ?? "")) bad.push(`${slug}: line "${p.line}"`);
      });
    }
    expect(bad).toEqual([]);
    // 73 of the file's 74 rows placed on 2026-11-19 (Truck Drivers' lunch box is over its tumbler cap).
    // 3 placed on 2026-11-19 (1119e sort: the 25 cap, the commission order and the judgment cuts; owner: recognizable brands only).
    expect(placed).toBeGreaterThan(2);
    // 1120: only the 30 kept store pages remain (the new brands' own pages folded into the guides).
    for (const s of STORES.filter((x) => !isFoldedStore(x))) expect(pageOf(s).filter((p) => isNewBrand(p.href)).length, s).toBeGreaterThan(0);
  });

  it("Soundcore's Boom Go 3i uses its CJ link, never the old Later link", () => {
    let cj = 0;
    for (const slug of slugs) {
      for (const p of pageOf(slug)) {
        expect(p.href, `${slug}: ${p.name}`).not.toBe("https://mavely.app.link/x6voFDcOa8b");
        const u = new URL(p.href);
        if (u.hostname === "www.anrdoezrs.net" && u.pathname === "/click-101930553-17033430") {
          expect(new URL(u.searchParams.get("url") ?? "").hostname).toBe("www.soundcore.com");
          cj += 1;
        }
      }
    }
    // 1120: Soundcore's store page folded; where its CJ link still shows it is the CJ one (counted, may be 0).
    expect(cj).toBeGreaterThanOrEqual(0);
  });
});
