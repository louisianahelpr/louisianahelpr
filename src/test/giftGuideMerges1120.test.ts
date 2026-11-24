/**
 * Gift guides big batch 1120 (owner 2026-11-19 ~8:20-10 PM: the guide merges, "the same item and color in one place
 * only", "25 max per SECTION", "batch everything in 1 big batch"), read from the shipped chunks and the route map:
 *   - every old guide slug folded into a merged guide (src/content/giftGuideMerges.mjs) opens <parent>#<old slug>, in
 *     the page (newSlugFor) and as a 301 from the server (the route map api/share.ts reads); no old slug 404s, none
 *     keeps a page or a chunk of its own; a folded store page 301s to the gift guides landing page;
 *   - a merged guide's chunk holds its sections in the table's order, each at most SECTION_CAP picks, LSU at most 2;
 *   - one place per item and color across every guide: no link, photo, exact name or product-and-color shows twice;
 *   - the 1120 import keeps one row per product and color (the higher commission), drops Dr. Woof, the old Ember Mug 2
 *     and any 0% link, and flags TikTok finds, pre-orders and the brand code;
 *   - a Creator Connections swap keeps its old link to switch back to the day after the campaign ends.
 *
 * @mutate src/content/giftGuideMerges.mjs | export const SECTION_CAP = 25; | export const SECTION_CAP = 30;
 * @mutate src/content/giftGuideCatalog.ts |   if (into) return GUIDES.some((g) => g.slug === into.parent) ? (SECTION_ANCHORS[to] ? `${into.parent}#${SECTION_ANCHORS[to]}` : into.parent) : null; |   if (into) return null;
 * @mutate api/share.ts | /^([a-z0-9-]+(#[a-z0-9-]+)?)?$/.test(d.moved[slug]) | /^[a-z0-9-]+$/.test(d.moved[slug])
 * @mutate scripts/giftGuideBig1120.mjs |       if (kept.some((k) => sameProduct(k, r) && | if (false && kept.some((k) => sameProduct(k, r) &&
 */
import { LIVE_GUIDES_1121, isLiveGuide } from "@/content/giftGuideLive.mjs";
import { DEAL_DAY_SLUGS } from "@/content/giftGuideDeals.mjs";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { beforeAll, describe, expect, it } from "vitest";
import { GUIDE_MERGES, MERGED_INTO, NEW_PARENTS, SECTION_CAP, SECTION_MAX, SECTION_MIN, STORE_PAGES_HELD, STORE_PAGES_KEPT, isFoldedStore } from "@/content/giftGuideMerges.mjs";
import { SECTION_ANCHORS } from "@/content/giftGuidePicks";
import { OLD_PEOPLE_SLUGS, isOwnerList, peopleGuideOf } from "@/content/giftGuidePeople.mjs";
import { HER_1121 } from "../../scripts/giftGuideHer1121.mjs";
import { GUIDE_INDEX } from "@/content/giftGuideIndex";
import { GUIDES, guideBySlug, newSlugFor } from "@/content/giftGuideCatalog";
import { RETIRED_TO_SEARCH_PAGE } from "@/content/retiredGuideForward";
import { buildSeoData } from "@/prerender/seoData";
import { blankComments } from "./helpers/blankNonCode";
import { importRows1120, parseSwaps, productKey1120 } from "../../scripts/giftGuideBig1120.mjs";
import { SPONSOR_SECTIONS_1120 } from "../../scripts/giftGuideFollowUp1120.mjs";
import { isThemeGuide } from "@/content/giftGuideLive.mjs";

type Pick = { name: string; brand?: string; href: string; image?: string; section?: string; sectionId?: string; from?: string; swappedFrom?: string; campaignEnds?: string; fallback_href?: string; switch_on?: string };
const DIR = "src/content/giftGuidePicks";
// Read once: ~95 chunks.
const CHUNKS = new Map<string, Pick[]>(readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")).picks as Pick[]]));
/** Lists of their own order or a sponsor list (the 25 Days sponsors guide names each sponsor as they gave it). */
// Owner's standard plan (11-20 evening, scripts/gift-guide-standard-1120.json): she chose every pick, section and order on
// the planned guides, so the plan wins there (guarded by giftGuideStandard1120.test.ts).
const PLANNED = new Set(Object.keys((JSON.parse(readFileSync("scripts/gift-guide-standard-1120.json", "utf8")) as { guides: Record<string, unknown> }).guides));
const SPONSORS = "25-days-sponsors";
const guideChunks = [...CHUNKS].filter(([s]) => !s.startsWith("store-") && s !== SPONSORS);
const COLORS = /\b(black|white|red|blue|green|pink|purple|gold|silver|grey|gray|navy|brown|beige|cream|tan|ivory|yellow|orange|teal|clear|rose|charcoal|olive|sage|lavender|burgundy|maroon|natural|espresso|stone|sand|mint|coral|plum)\b/g;
/** The product without its color or size words (the import's dedupeKey, simplified to the parts a name repeats). */
const plain = (n: string) => n.toLowerCase().replace(/\([^)]*\)/g, " ").replace(COLORS, " ").replace(/\b\d+(\.\d+)?\s*(oz|fl oz|in|qt|ct|pack|pc|ml|l)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const colorOf = (n: string) => [...n.toLowerCase().matchAll(COLORS)].map((m) => m[1]).join(" ");

let moved: Record<string, string> = {};
beforeAll(async () => {
  moved = (await buildSeoData()).moved;
}, 120_000);

const BY_USE = (JSON.parse(readFileSync("scripts/gift-guide-train-1120d.json", "utf8")) as { byUse?: { guide: string; sections: { id: string; title: string; picks: { match: string; line?: string }[] }[] }[] }).byUse ?? [];

describe("gift guides big batch 1120: merges, redirects, one place per item", () => {
  it("reads the owner's numbers and a merge table that names real guides once each", () => {
    expect(SECTION_CAP).toBe(25);
    const index = new Set(GUIDE_INDEX.map((g) => g.slug));
    const sections = GUIDE_MERGES.flatMap((m) => m.sections);
    // Follow-up 1120 (owner "FINAL MERGES", 11-20 ~1:10 AM): 26 merged guides measured 2026-11-20 (49 before); their
    // old guides as sections stay listed (each keeps its 301).
    expect(GUIDE_MERGES.length).toBeGreaterThan(20);
    expect(sections.length).toBeGreaterThan(180);
    expect(new Set(sections).size).toBe(sections.length);
    for (const m of GUIDE_MERGES) {
      expect(index.has(m.parent), m.parent).toBe(true);
      expect(MERGED_INTO[m.parent], `${m.parent} is a parent and a section`).toBeUndefined();
      for (const s of m.sections) expect(index.has(s), s).toBe(true);
    }
    for (const p of NEW_PARENTS) expect(GUIDE_MERGES.some((m) => m.parent === p), p).toBe(true);
    // Owner pop-up 2026-11-20 ~2:45 AM (FINAL STORE LIST): 26 store pages; train 1120b holds TJ Maxx and JCPenney until refilled.
    expect(STORE_PAGES_KEPT.length + STORE_PAGES_HELD.length).toBe(26);
    expect(STORE_PAGES_HELD.every((s) => isFoldedStore(s))).toBe(true);
  });

  it("every old slug opens <parent>#<section> in the page and answers a 301 there; a folded store page 301s to the landing", () => {
    const old = Object.keys(MERGED_INTO);
    for (const s of old) {
      const { parent } = MERGED_INTO[s];
      // For Her / For Him (owner 11-20 evening): the old Mom, Dad, Wife ... slugs are filter pages now, guarded by giftGuidePeople1120.test.ts.
      if (peopleGuideOf(s) || peopleGuideOf(parent) || s in OLD_PEOPLE_SLUGS) continue;
      expect(guideBySlug(s), `${s} keeps a page`).toBeUndefined();
      // Owner 11-21: a retired parent (src/content/giftGuideLive.mjs) has no page; its old guides 301 to the landing.
      if (!isLiveGuide(parent)) {
        expect(guideBySlug(parent), parent).toBeUndefined();
        // Lead 11-24: one with an honest search page opens it (guarded by retiredGuideForward1124.test.ts).
        if (Object.prototype.hasOwnProperty.call(RETIRED_TO_SEARCH_PAGE, s)) continue;
        expect(newSlugFor(s), s).toBeNull();
        expect(moved[s], `route map: ${s}`).toBe("");
        continue;
      }
      expect(guideBySlug(parent), parent).toBeTruthy();
      // The section groups (owner 11-20) name the section the old guide's picks joined.
      const want = SECTION_ANCHORS[s] ? `${parent}#${SECTION_ANCHORS[s]}` : parent;
      expect(newSlugFor(s), s).toBe(want);
      expect(moved[s], `route map: ${s}`).toBe(want);
      // Owner 11-21: Her, Him and Kids are flat lists of her own saves, so an old slug's section can be empty there.
      if (SECTION_ANCHORS[s] && !isOwnerList(parent)) expect((CHUNKS.get(parent) ?? []).some((p) => p.sectionId === SECTION_ANCHORS[s]), `${s} -> an empty section`).toBe(true);
      expect(CHUNKS.has(s), `${s} still writes a chunk`).toBe(false);
    }
    const folded = GUIDE_INDEX.filter((g) => isFoldedStore(g.slug)).map((g) => g.slug);
    expect(folded.length).toBeGreaterThan(100);
    for (const s of folded) {
      expect(guideBySlug(s), s).toBeUndefined();
      expect(moved[s], `route map: ${s}`).toBe("");
      expect(CHUNKS.has(s), s).toBe(false);
    }
    // The server answers both forms (api/share.ts): a section anchor and the landing page ("").
    const share = blankComments(readFileSync("api/share.ts", "utf8"));
    expect(share).toContain("/^([a-z0-9-]+(#[a-z0-9-]+)?)?$/.test(d.moved[slug])");
    expect(share).toMatch(/d\.moved\[slug\] \? `\$\{SITE_ORIGIN\}\/gift-guides\/\$\{d\.moved\[slug\]\}` : `\$\{SITE_ORIGIN\}\/gift-guides`/);
    // Only the kept store pages write a chunk.
    expect([...CHUNKS.keys()].filter((s) => s.startsWith("store-")).sort()).toEqual([...STORE_PAGES_KEPT].filter((s) => CHUNKS.has(s)).sort());
  });

  it("a merged guide holds at most SECTION_MAX sections of SECTION_MIN to SECTION_CAP picks, by role; LSU at most 2", () => {
    let sections = 0;
    let planned = 0;
    const bad: string[] = [];
    for (const m of GUIDE_MERGES) {
      if (peopleGuideOf(m.parent)) continue; // For Her / For Him: interest sections (giftGuidePeople1120.test.ts)
      const list = CHUNKS.get(m.parent) ?? [];
      if (!list.some((p) => p.sectionId)) continue; // folded to one plain list
      if (PLANNED.has(m.parent)) { planned += 1; continue; } // her sections, sizes and order (giftGuideStandard1120.test.ts)
      const ids = list.map((p) => p.sectionId ?? "");
      const order = [...new Set(ids)];
      // Every section is one an old guide points to (or the guide's own Top picks), each in one run.
      // Follow-up 1120: the two 25 Days sponsor sections on Shop Small Louisiana (no old guide points to them).
      // Owner standard 11-20: a guide cut into sections by use (train 1120d `byUse`) holds exactly those sections.
      const byUse = BY_USE.find((u) => u.guide === m.parent)?.sections.map((x) => x.id);
      const known = new Set(byUse ?? ["top-picks", ...m.sections.map((s) => SECTION_ANCHORS[s]), ...SPONSOR_SECTIONS_1120.map((x) => x.id)]);
      for (const id of order) if (!known.has(id)) bad.push(`${m.parent}: unknown section "${id}"`);
      expect(order.length, m.parent).toBe(ids.filter((x, i) => i === 0 || ids[i - 1] !== x).length);
      expect(order.length, m.parent).toBeLessThanOrEqual(SECTION_MAX);
      for (const id of order) if (list.filter((p) => p.sectionId === id).length < SECTION_MIN) bad.push(`${m.parent}#${id}: under ${SECTION_MIN}`);
      for (const id of order) {
        const run = list.filter((p) => p.sectionId === id);
        sections += 1;
        if (run.length > SECTION_CAP) bad.push(`${m.parent}#${id}: ${run.length} picks`);
        if (run.filter((p) => /\bLSU\b/i.test(`${p.name} ${p.brand ?? ""}`)).length > 2) bad.push(`${m.parent}#${id}: more than 2 LSU`);
        if (run.some((p) => !p.section)) bad.push(`${m.parent}#${id}: a pick with no section title`);
      }
    }
    // The Monster Jam guide (owner 11-24: "with every item we can find") is her own researched list in its own groups, like
    // Her, Him and Kids: no SECTION_CAP.
    for (const [slug, list] of guideChunks) if (!GUIDE_MERGES.some((m) => m.parent === slug) && !peopleGuideOf(slug) && !isThemeGuide(slug) && list.length > SECTION_CAP) bad.push(`${slug}: ${list.length} picks`);
    // Follow-up 1120: 80 sections on the ~30 guides, measured 2026-11-20 (more on the 65 guides before).
    // Owner's standard plan (11-20 evening): the planned merged guides follow the plan, the rest keep these rules.
    expect(sections + planned).toBeGreaterThan(8);
    expect(bad).toEqual([]);
  });

  it("one place per item and color: no link, photo, name or product-and-color twice across every guide", () => {
    const seen = new Map<string, string>();
    const bad: string[] = [];
    let n = 0;
    for (const [slug, list] of guideChunks) {
      for (const p of list) {
        n += 1;
        const at = `${slug}#${p.sectionId ?? ""}`;
        // Owner 11-21: For Her is her own 25 saves (scripts/giftGuideHer1121.mjs); one she picked may also sit on another
        // guide (the Theragun Mini is on Healthcare too), so her picks are checked for repeats within For Her only.
        // Owner 11-21 ("Him = ALL of her men's saves"): For Him and For Kids are her own saves too, checked the same way.
        // Owner 11-22 PM ("add all items", Louisiana-popular-candidates-1122.md): her launch-day For Her adds are her picks
        // too, so a ready row from a hidden Louisiana guide (the Katie Kime tray, Haydel's, Match South) may sit on both.
        const own = slug === "her" && (HER_1121.some((r) => r.href === p.href) || (p as { ownerPick?: boolean }).ownerPick) ? "her-owner:" : (slug === "him" || slug === "kids") && (p as { ownerPick?: boolean }).ownerPick ? `${slug}-owner:` : "";
        const keys = [`h:${p.href}`, `n:${p.name.toLowerCase()}`, ...(p.image ? [`i:${p.image}`] : []), `p:${productKey1120(p.brand, p.name, plain)}#${colorOf(p.name)}`].map((k) => own + k);
        for (const k of keys) {
          if (seen.has(k)) bad.push(`${k.slice(0, 80)} at ${seen.get(k)} and ${at}`);
          else seen.set(k, at);
        }
      }
    }
    // Follow-up 1120: ~1,500 guide picks on the ~30 guides, measured 2026-11-20 (2,000+ on the 65 guides before).
    expect(n).toBeGreaterThan(530); // audits A+B combined (11-20): 1,131 measured
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("a Creator Connections swap keeps its old link and switches back the day after the campaign ends", () => {
    const swapped = [...CHUNKS.values()].flat().filter((p) => p.swappedFrom);
    expect(swapped.length).toBeGreaterThan(0);
    for (const p of swapped) {
      expect(p.href, p.name).toMatch(/^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}\?tag=louisianahelpr-20$/);
      expect(p.fallback_href, p.name).toBe(p.swappedFrom);
      const next = new Date(Date.parse(`${p.campaignEnds}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      expect(p.switch_on, p.name).toBe(next);
    }
  });

  it("the 1120 import: one row per product and color (higher commission), no Dr. Woof, old Ember Mug 2 or 0% link (but the owner's named shops); TikTok, pre-order and code flags", () => {
    const rows: Record<string, unknown[]> = {
      "_thin-fill-1119.json": [
        { guide: "dad", name: "johnnie-O Sully Quarter Zip Pullover", brand: "johnnie-O", href: "https://go.shopmy.us/p-1", image: "https://x/1.jpg", commission: 10 },
        { guide: "him", name: "Barbour Finn Quilted Gilet", brand: "Barbour", href: "https://go.shopmy.us/p-2", image: "https://x/2.jpg", commission: 10 },
        { guide: "rns", name: "Fabletics Evolve 3-Pocket Scrub Top, Navy", brand: "Fabletics", href: "https://go.shopmy.us/p-3", image: "https://x/3.jpg", commission: 16 },
        { guide: "healthcare-workers", name: "Fabletics Evolve 3-Pocket Scrub Top, Green Mystique", brand: "Fabletics", href: "https://go.shopmy.us/p-4", image: "https://x/4.jpg", commission: 16 },
        { guide: "vets-and-vet-techs", name: "Dr. Woof VetCore Scrub Top", brand: "Dr. Woof", href: "https://drwoofapparel.com/x", image: "https://x/5.jpg", commission: 0 },
        { guide: "doctors", name: "Ember Mug 2, 14 oz", brand: "Ember", href: "https://www.amazon.com/dp/B000000001?tag=louisianahelpr-20", image: "https://x/6.jpg", commission: 3 },
        { guide: "respiratory-therapists", name: "21 Collective Core Mockneck Navy", brand: "21 Collective", href: "https://21collectiveco.com/x", image: "https://x/7.jpg", commission: 0 },
        { guide: "respiratory-therapists", name: "21 Collective RT Sweatshirt", brand: "21 Collective", href: "https://go.shopmy.us/p-8", image: "https://x/8.jpg", commission: 10 },
      ],
      "_southern-picks-1119.json": [
        { guide: "golfer", name: "Johnnie-O Sully 1/4 Zip Pullover", brand: "Johnnie-O", color: "Royal Plum", href: "https://go.shopmy.us/p-11", image: "https://x/11.jpg", commission: 15, why: "owner TikTok pick" },
        { guide: "him", name: "Barbour Men's Finn Quilted Gilet", brand: "Barbour", color: "Navy", href: "https://go.shopmy.us/p-12", image: "https://x/12.jpg", commission: 10 },
        { guide: "grandpa", name: "Smathers & Branson Mallard Needlepoint Can Cooler", brand: "Smathers & Branson", color: "Classic Navy", href: "https://go.shopmy.us/p-13", image: "https://x/13.jpg", commission: 15 },
        { guide: "him", name: "Smathers & Branson x Tervis Mallard Needlepoint Tumbler", brand: "Smathers & Branson", color: "Classic Navy", href: "https://go.shopmy.us/p-14", image: "https://x/14.jpg", commission: 15 },
      ],
    };
    const out = importRows1120((f: string) => rows[f] ?? null, (v: unknown) => (Array.isArray(v) ? v : []), "");
    const names = out.map((r: { name: string }) => r.name);
    // The higher commission wins the one place (Sully: 15% Southern over 10% thin fill); a tie keeps the thin fill (Finn).
    expect(names).toContain("Johnnie-O Sully 1/4 Zip Pullover");
    expect(names).not.toContain("johnnie-O Sully Quarter Zip Pullover");
    expect(names).toContain("Barbour Finn Quilted Gilet");
    expect(names).not.toContain("Barbour Men's Finn Quilted Gilet");
    // Another color stays (the owner's Fabletics scrubs, one color per section); another product of a line stays.
    expect(names).toEqual(expect.arrayContaining(["Fabletics Evolve 3-Pocket Scrub Top, Navy", "Fabletics Evolve 3-Pocket Scrub Top, Green Mystique",
      "Smathers & Branson Mallard Needlepoint Can Cooler", "Smathers & Branson x Tervis Mallard Needlepoint Tumbler"]));
    expect(names.filter((x: string) => /Woof|Ember Mug 2/.test(x))).toEqual([]);
    // The small shops the owner asked for by name show at 0% (lead 11-20): 21 Collective, pre-order, code COLLECTIVE10.
    expect(out.find((r: { name: string }) => r.name === "21 Collective Core Mockneck Navy")).toMatchObject({ preorder: true, code: "COLLECTIVE10", _ownerShop: true });
    const sully = out.find((r: { name: string }) => r.name.startsWith("Johnnie-O Sully")) as { tiktok?: boolean };
    expect(sully.tiktok).toBe(true);
    const rt = out.find((r: { name: string }) => r.name === "21 Collective RT Sweatshirt") as { preorder?: boolean; code?: string };
    expect(rt).toMatchObject({ preorder: true, code: "COLLECTIVE10" });
  });

  it("reads the owner's swaps file: each swap and each swap_out line", () => {
    const text = "## Swaps (guide | REMOVE | ADD | why)\n\n- mom | REMOVE UGREEN Tracker | ADD Mom Rules Needlepoint Pillow | why\n\n## swap_out\n\n- mom: UGREEN Tracker\n\n## Skipped links\n\n- p-1 x: y\n";
    expect(parseSwaps(text)).toEqual({ swaps: [{ guide: "mom", remove: "UGREEN Tracker", add: "Mom Rules Needlepoint Pillow" }], out: [{ guide: "mom", item: "UGREEN Tracker" }] });
    // The owner's 12 swaps of 11-19 PM (~/Desktop/Gift-guide-picks/_owner-swaps-1119.md, a dated record): each new item
    // shows on its guide (a merged guide's section), and its old item is gone from there.
    const SWAPS_1119: [string, string, string][] = [
      ["new-mom", "Silicone Breast Pump", "Haakaa New Mom Breastfeeding Starter Pack"], ["new-mom", "Pecan Pralines 8 Count Tin", "Love Wellness Tired Mom Bundle"],
      ["new-mom", "Christmas Blend Ground Coffee", "Kiehl's New Mom & Baby Bundle"], ["new-mom", "Blue Floral Block Print Baby Bib", "Furbish Studio Cool Mom Needlepoint Pillow"],
      // Owner 11-20 9:12 PM: the Geometry "Greetings From Louisiana" tea towel left Home & Kitchen for Shop Small Louisiana
      // (Louisiana brands live only in Louisiana guides), so the hostess swap is no longer read here; giftGuideStandard1120 pins it.
      ["acadiana", "Louisiana State Safety Matches", "adidas Louisiana Ragin' Cajuns Vault Script Long Sleeve Tee"],
      ["game-day", "Ozark Trail Quad Folding Camp Chair with Cup Holder", "Stoney Clover Lane x '47 LSU Glitter Arch Oversized Crew"], ["girls-teens", "SWEETFULL Portable Neck Fan", "BaubleBar College Logo Hair Claw Clip"],
      ["self-care-lover", "Dr Teal's Epsom Salt Magnesium Soak", "VOESH Pedi Moments Pedicure Kit"], ["traveler", "Toiletry Bag for Men, Water-Resistant Dopp Kit", "Weezie Large Toiletry Bag"],
      ["mom", "UGREEN Bluetooth Tracker for Apple Find My", "Mom Rules Needlepoint Pillow"], ["girls-babies", "Baby Bath Time Essentials Gift Set", "Monogram Mary Complete Baby Bundle"],
    ];
    const on = (slug: string) => (peopleGuideOf(slug) ? (CHUNKS.get(peopleGuideOf(slug)!) ?? []).filter((p) => p.from === slug) : MERGED_INTO[slug] ? (CHUNKS.get(MERGED_INTO[slug].parent) ?? []).filter((p) => p.from === slug) : (CHUNKS.get(slug) ?? []).filter((p) => !p.from || p.from === slug));
    const fold = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const [guide, remove, add] of SWAPS_1119) {
      // Mom's swap-in (the needlepoint pillow) left with For Her's old list: Her is the owner's own 25 saves since 11-21.
      // Same for Kids (owner 11-21 ~2:47 AM): girls-babies folded into Kids, now her own Amazon kids list.
      if (!isOwnerList(guide) && !isOwnerList(MERGED_INTO[guide]?.parent ?? guide)) expect(on(guide).some((p) => fold(p.name).startsWith(fold(add).slice(0, 16))), `${guide}: ${add}`).toBe(true);
      expect(on(guide).some((p) => fold(p.name).startsWith(fold(remove).slice(0, 16))), `${guide}: ${remove}`).toBe(false);
    }
  });

  it("the page lists only the live guides (owner 11-21: Her, Him and Kids, plus the 25 Days sponsors page)", () => {
    // A relationship filter page (Mom, Dad ... on For Her / For Him) is a view of its guide, not another guide.
    const shown = GUIDES.filter((g) => !g.empty && !g.slug.startsWith("store-") && !(g as { view?: unknown }).view);
    // Follow-up 1120 (owner "FINAL MERGES -> ~30"): 28 guides measured 2026-11-20; owner 11-21: the live list only.
    // Owner 11-21: the deals days are live too, but each is its own page, no catalog guide.
    expect(shown.map((g) => g.slug).sort()).toEqual(LIVE_GUIDES_1121.filter((s) => !DEAL_DAY_SLUGS.includes(s)).sort());
  });
});
