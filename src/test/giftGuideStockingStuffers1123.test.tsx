/**
 * Owner 2026-11-23 (pop-up "Under 10"): Her, Him and Kids each open with a first section "Stocking stuffers under $10"
 * holding every pick in that guide whose card reads under $10 (new and existing), cheapest first; the price sections
 * follow as before, and every section opens expanded. ONE rule (src/lib/pickPriceShown.mjs STOCKING_SECTION_ID, first
 * in PRICE_SECTIONS) shared by the page (GiftGuideView.tsx priceSections) and the Q&A counts (src/lib/guideQa.mjs).
 * Also: the owner's 11-23 Amazon keeps (14 For Him, 16 For Kids) are on their guides with the tagged link, and her
 * second keeps (~11:55 AM: 19 For Her, 9 For Him) with the price read on amazon.com that day, and the keeps whose links
 * came later (6 Ulta on Her, the Lodge skillet on Him, 6 on Kids; Capri Blue to Amazon) with their ShopMy links.
 *
 * @mutate src/lib/pickPriceShown.mjs |   { id: "stocking-stuffers", max: 10 }, |   { id: "stocking-stuffers", max: 0 },
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const grouped = [...stocking, ...order.filter((id) => id !== STOCKING_SECTION_ID) |   const grouped = [...order.filter((id) => id !== STOCKING_SECTION_ID)
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | const stocking = sortByPrice(priced.filter((p) => priceSectionOf(p) === STOCKING_SECTION_ID), "low"); | const stocking = sortByPrice(priced.filter((p) => priceSectionOf(p) === STOCKING_SECTION_ID), "high");
 * @mutate scripts/giftGuideHer1121.mjs | ...HER_POPULAR_1122, ...HER_KEEPS_1123, ...HER_LINKS_1123, ...HER_ADDS_1124, ...HER_AMAZON_BEAUTY_1124]; | ...HER_POPULAR_1122, ...HER_LINKS_1123, ...HER_ADDS_1124, ...HER_AMAZON_BEAUTY_1124];
 * @mutate scripts/giftGuideOwnerKeeps1123.mjs | 4.81, "61qGzw5ywoL", "Berkley PowerBait Power Worms, 7 in., Tequila Sunrise" | 4.81, "61qGzw5ywoL", "Berkley PowerBait Power Worms"
 * @mutate src/lib/guideQa.mjs |   const stocking = band("stocking-stuffers"); |   const stocking = band("under-25");
 * @mutate scripts/giftGuideHimKids1121.mjs | ...HIM_KEEPS_1123, ...HIM_LINKS_1123, ...HIM_WALMART_1123, ...HIM_ADDS_1124]) { | ...HIM_KEEPS_1123, ...HIM_WALMART_1123, ...HIM_ADDS_1124]) {
 * @mutate scripts/giftGuideHimKids1121.mjs | ...HIM_POPULAR_1122, ...HIM_KEEPS_1123, ...HIM_LINKS_1123, ...HIM_WALMART_1123, ...HIM_ADDS_1124]) { | ...HIM_POPULAR_1122, ...HIM_KEEPS_1123, ...HIM_LINKS_1123, ...HIM_ADDS_1124]) {
 * @mutate scripts/giftGuideOwnerKeeps1123.mjs | ["https://walmrt.us/4j41V4c", 20, | ["https://walmrt.us/4j41V4c", 25,
 * @mutate scripts/giftGuideHimKids1121.mjs | ...KIDS_KEEPS_1123, ...KIDS_LINKS_1123, ...KIDS_ADDS_1124]) { | ...KIDS_KEEPS_1123, ...KIDS_ADDS_1124]) {
 * @mutate scripts/giftGuideCutouts1120.mjs | for (const [from, file] of LINKS_CUTOUTS_1123) CUTOUTS_1120.set(from, file); | void LINKS_CUTOUTS_1123;
 * @mutate scripts/giftGuideOwnerKeeps1123.mjs | ["B09X55PDB7", 23, "51q7YVnVwnL" | ["B09X55PDB7", 25, "51q7YVnVwnL"
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AMAZON_PRICES_AT_1124, amazonPrice1124 } from "../../scripts/giftGuideAmazonPrices1124.mjs";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/content/giftGuideEarnRank.json", () => ({ default: { ranks: {} } }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import GiftGuides from "@/pages/info/GiftGuides";
import { guideBySlug, loadGuidePicks } from "@/content/giftGuideCatalog";
import { catalogGuideQa, toQaPick } from "@/lib/guideQa.mjs";
import { PRICE_SECTIONS, pickPriceShown, priceSectionId } from "@/lib/pickPriceShown.mjs";
import { pickAnchor } from "@/content/giftGuidePickAnchor";
import { her1121Picks } from "../../scripts/giftGuideHer1121.mjs";
import { him1121Picks, kids1121Picks } from "../../scripts/giftGuideHimKids1121.mjs";
import { existsSync } from "node:fs";
import her from "@/content/giftGuidePicks/her.json";
import him from "@/content/giftGuidePicks/him.json";
import kids from "@/content/giftGuidePicks/kids.json";
import { kidsThemeMovesLive1124 } from "../../scripts/giftGuideThemes1124.mjs";
import { PRICES_AT_1126, price1126 } from "../../scripts/giftGuidePrices1126.mjs";
/** Kids picks that moved to their themed guide 11-24 (scripts/giftGuideKidsThemeMoves1124.mjs; that move's own guard is
 *  src/test/giftGuideKidsThemeRow1124.test.tsx): off Kids by design, so not expected here. */
const MOVED_TO_THEME = new Set(kidsThemeMovesLive1124().map((m: { href: string }) => m.href));

const TODAY = "2026-11-23";
const GUIDES = ["her", "him", "kids"] as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T18:00:00Z`));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The page's arithmetic written out: a card reads rounded dollars, at least $1; under $10 is stocking. */
const dollars = (p: number) => Math.max(1, Math.round(p));
async function expectedStocking(slug: string) {
  await loadGuidePicks(slug);
  const picks = guideBySlug(slug)!.picks.filter((p) => p.name && pickPriceShown(p.price, p.priceAt, TODAY));
  return picks
    .filter((p) => dollars(p.price!) < 10)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.price! - b.p.price! || a.i - b.i)
    .map(({ p }) => p);
}

describe("the shared rule", () => {
  it("stocking stuffers come first and hold cards that read under $10", () => {
    expect(PRICE_SECTIONS[0]).toEqual({ id: "stocking-stuffers", max: 10 });
    expect(priceSectionId(9.4)).toBe("stocking-stuffers");
    expect(priceSectionId(9.56)).toBe("under-25"); // reads "~$10"
    expect(priceSectionId(12)).toBe("under-25");
  });
});

describe("Her, Him and Kids open with Stocking stuffers under $10", () => {
  for (const slug of GUIDES) {
    it(`${slug}: the first section is the stocking stuffers, exactly the picks under $10, cheapest first, open`, async () => {
      const want = await expectedStocking(slug);
      expect(want.length, slug).toBeGreaterThan(3); // her 19, him 23, kids 5 on 2026-11-23 (after the held links); kids 4 from 2026-11-24 ~10:45 PM (owner moved the Minecraft toothbrush to Minecraft)
      const { container } = render(
        <MemoryRouter initialEntries={[`/gift-guides/${slug}`]}>
          <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
        </MemoryRouter>,
      );
      await waitFor(() => expect(container.querySelector("section.gg-sec")).not.toBeNull(), { timeout: 8000 });
      const first = container.querySelector("section.gg-sec")!;
      expect(first.id).toBe("gg-sec-stocking-stuffers");
      expect(first.textContent).toContain("Stocking stuffers under $10");
      expect(first.textContent).toContain(`(${want.length})`);
      expect(first.querySelector("[aria-expanded]")?.getAttribute("aria-expanded")).toBe("true");
      const rows = [...first.querySelectorAll("li[data-gift-pick]")].map((li) => li.id);
      expect(rows).toEqual(want.map((p) => pickAnchor(p.name)));
      // Nothing under $10 is left in a later section, and the section after it is Under $25.
      const later = [...container.querySelectorAll("section.gg-sec")].slice(1);
      expect(later[0].id).toBe("gg-sec-under-25");
      const laterIds = new Set(later.flatMap((s) => [...s.querySelectorAll("li[data-gift-pick]")].map((li) => li.id)));
      for (const p of want) expect(laterIds.has(pickAnchor(p.name)), p.name).toBe(false);
    }, 20000);
  }

  it("the Q&A's stocking-stuffer count equals the section's", async () => {
    for (const slug of GUIDES) {
      const want = await expectedStocking(slug);
      const qa = catalogGuideQa(slug, guideBySlug(slug)!.picks.filter((p) => p.name).map(toQaPick), TODAY);
      expect(qa.find((x) => /stocking stuffers .* under \$10\?$/.test(x.q))!.a, slug).toContain(`This guide opens with ${want.length} stocking stuffers under $10.`);
    }
  });
});

describe("the owner's 11-23 Amazon keeps are on their guides", () => {
  const HIM = ["B0HDDLPQV5", "B002ZK45IQ", "B003IWI66W", "B0070XAL0E", "B000O8OTNC", "B01HRCU3SW", "B009IH0ICG", "B001E5FLT0", "B0G4XRP464", "B0CXGXT6W8", "B0C6XK77HJ", "B0G6GTRHCJ", "B07JCQ8GQJ", "B0DHT5XZR1"];
  const KIDS = ["B0DSCL9N58", "B083XNCRS3", "B0CBT2N7N1", "B078WM314M", "B0831R88S6", "B0HHL1768V", "B0CSYGLWN5", "B083QZLSXS", "B0G441FJ3G", "B0B4YWYGXG", "B082PZND3V", "B07ZYCKR15", "B001Q3KU9Q", "B0BRTCTT6X", "B0CRC73JTS", "B0CSP7M219"];
  for (const [name, list, asins] of [["him", him.picks, HIM], ["kids", kids.picks, KIDS]] as const) {
    it(`${name}: each keep once, with the tagged Amazon link, a price and today's check`, () => {
      expect(asins.length).toBeGreaterThan(13);
      for (const a of asins) {
        if (name === "kids" && MOVED_TO_THEME.has(`https://www.amazon.com/dp/${a}?tag=louisianahelpr-20`)) continue;
        const rows = (list as { href: string; price: number; priceAt: string; image: string }[]).filter((p) => p.href.includes(`/dp/${a}`));
        expect(rows.length, a).toBe(1);
        expect(rows[0].href).toBe(`https://www.amazon.com/dp/${a}?tag=louisianahelpr-20`);
        expect(rows[0].price).toBeGreaterThan(0);
        // Kids Black Friday sweep 11-24: a keep whose Amazon price changed shows the re-read price, dated that day.
        // Guides audit 1126: a keep whose price changed 11-26 shows that day (scripts/giftGuidePrices1126.mjs).
        expect(rows[0].priceAt).toBe(price1126(rows[0].href) !== undefined ? PRICES_AT_1126 : amazonPrice1124(rows[0].href) !== undefined ? AMAZON_PRICES_AT_1124 : "2026-11-23");
        expect(rows[0].image).toMatch(/^https:\/\/m\.media-amazon\.com\/images\/I\/[^/]+\._SL500_\.jpg$/);
      }
    });
  }
});

/**
 * The owner's SECOND 11-23 keeps (~11:55 AM, Desktop owner-keeps-1123b.json): 19 Her and 9 Him Amazon picks, each with
 * the price read on its amazon.com page 2026-11-23 12:02-12:04 PM CT and the main photo there. The 7 non-Amazon ones
 * (6 Ulta stocking stuffers, the Capri Blue car diffuser) wait on links and are not on the page.
 */
describe("the owner's second 11-23 keeps are on Her and Him", () => {
  const HER_B: [string, number, string, string][] = [
    ["B079FV8PLK", 3.17, "71oHjVJxhUL", "Sally Hansen Insta-Dri Nail Polish, Just In Wine"],
    ["B00A8S6HM4", 3.98, "61WISQB7KNL", "Gold Bond Healing Hand Cream, 3 oz"],
    // e.l.f. Lip Exfoliator (B0CB23NZGT, $4.78): moved to elfcosmetics.com through Later 10.5% ($6) 11-24 (scripts/giftGuideOwner1124.mjs).
    ["B00EUBPHR6", 4.9, "71-gXRUepFL", "Real Techniques Miracle Complexion Sponge"],
    ["B0B2WL4CSB", 6.97, "71uX7sknZYL", "Corissy Personalized Leather Travel Jewelry Box with Name and Birth Flower"],
    ["B0BX2TZZWG", 7.49, "61teCug7yHL", "Tree Hut Vanilla Shea Sugar Scrub, 18 oz"],
    ["B07L5QGF38", 8.49, "812oXq0wPPL", "Cleverfy Shower Steamers, 6-Pack"],
    ["B00GSH0KR2", 9.8, "61+-Ue8E4nL", "Kiehl's Lip Balm #1, 0.5 oz"],
    ["B01N9B27XA", 9.95, "71tfYZmjXkL", "Mont Bleu Crystal Glass Nail Files, Set of 3 in Pouch"],
    ["B010TCP3SC", 10.99, "6172rXS7RSL", "Dash Mini Waffle Maker, Red"],
    ["B01M10G9WJ", 11.99, "71rP7u8aCJL", "Jade Leaf Matcha Traditional Starter Set"],
    ["B0DWMNVVQV", 14.99, "81w+ZTsSNrL", "Candle Warmer Lamp with Timer and Dimmer, Amber"],
    ["1401971369", 17.05, "91ZVf3kNrcL", "The Let Them Theory by Mel Robbins (hardcover)"],
    // Sol de Janeiro Bum Bum Cream (B01EXQ582Q, $18): moved to soldejaneiro.com through ShopMy 16% (same $18) 11-24.
    ["B0GXGV6FRN", 19.99, "91BBhXvpvlL", "Carhartt Women's Rib Knit Beanie, Stone Brown"],
    ["B00023IT5S", 21.99, "51oiwmh2pIL", "Le Creuset Stoneware Mini Round Cocotte, 8 oz, Cerise"],
    ["006282015X", 24.98, "81PxN0B7CmL", "Magnolia Table, Volume 1 (Joanna Gaines)"],
    ["B0FHHG23TP", 24.99, "71UMvWt5y7L", "OCOOPA Dual-Sided Rechargeable Hand Warmers, 2-Pack, Black"],
    ["B092GM9NWH", 25, "616XeR9df9L", "We're Not Really Strangers Card Game"],
  ];
  const HIM_B: [string, number, string, string][] = [
    ["B0051USN3A", 2.74, "71TeJyhZ+0L", "HotHands Hand Warmers, 3 Pairs"],
    ["B000WUIGYA", 2.97, "711hCdRB86L", "Nite Ize S-Biner Dual Carabiner, Size 2, Black"],
    ["B000WNED08", 3.26, "61XkrUHeBJL", "Rain-X Windshield Treatment, 3.5 oz Spray"],
    ["B000050GET", 3.39, "616z-2GZeCL", "Bicycle Standard Playing Cards"],
    ["B004MMEHKQ", 3.68, "71G1Fkrj15L", "Nite Ize Original Gear Tie, 2-Pack"],
    ["B0BM5XZFWM", 3.79, "61pa4fWliRL", "CRAFTSMAN Keychain Tape Measure, 6 ft"],
    ["B06XFQNM8J", 4.66, "61F6+mLDiYL", "HME 3-Color Camo Face Paint Stick"],
    ["B00EO96HAA", 4.81, "61qGzw5ywoL", "Berkley PowerBait Power Worms, 7 in., Tequila Sunrise"],
    ["B003CTQ4U6", 4.97, "51aOoqbmkLL", "Strike King Redfish Magic Saltwater Spinnerbait"],
  ];
  for (const [name, list, keeps] of [["her", her.picks, HER_B], ["him", him.picks, HIM_B]] as const) {
    it(`${name}: each keep once, named, priced as read today, with Amazon's photo and the tagged link`, () => {
      expect(keeps.length).toBeGreaterThan(8);
      for (const [asin, price, img, title] of keeps) {
        const rows = (list as { name: string; href: string; price: number; priceAt: string; image: string }[]).filter((p) => p.href.includes(`/dp/${asin}`));
        expect(rows.length, asin).toBe(1);
        expect(rows[0].href).toBe(`https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`);
        expect(rows[0].name).toBe(title);
        // Guides audit 1126: a price that changed 11-26 shows that read and day (scripts/giftGuidePrices1126.mjs).
        expect(rows[0].price, title).toBe(price1126(rows[0].href) ?? price);
        expect(rows[0].priceAt).toBe(price1126(rows[0].href) !== undefined ? PRICES_AT_1126 : "2026-11-23");
        expect(rows[0].image).toBe(`https://m.media-amazon.com/images/I/${img}._SL500_.jpg`);
      }
    });
  }
  it("the pages are exactly what the builders make from scripts/giftGuideOwnerKeeps1123.mjs", () => {
    expect(her.picks).toEqual(her1121Picks());
    expect(him.picks).toEqual(him1121Picks());
    expect(kids.picks).toEqual(kids1121Picks());
  });
});

/**
 * The keeps that waited on links (Desktop held-links-1123.json, links made in her ShopMy 11-23 12:18-12:34 PM): each on
 * its guide once with its ShopMy link, the price read on the store's own page 11-23, and its cutout photo (the file
 * exists). Capri Blue's car diffuser links to Amazon (4.5% vs ShopMy's 4% at capri-blue.com, same $23). The Blackstone
 * press (no ShopMy partner, not sold on Amazon) and the Walmart Dearfoams slippers (Walmart Creator sign-in) stay off.
 */
describe("the owner's held-link keeps are on Her, Him and Kids", () => {
  const LINKED: [string, string, number, string, string][] = [
    ["her", "109732072", 2.62, "TONYMOLY I Am Sugar Plum Sheet Mask", "tonymoly-sugar-plum-sheet-mask-be6d57.webp"],
    ["her", "109732263", 2.8, "method Mini Body Wash, Simply Nourish, 3.4 oz", "method-mini-body-wash-simply-nourish-3634b9.webp"],
    ["her", "109732413", 3.24, "Peach Slices Acne Spot Dots", "peach-slices-acne-spot-dots-cb0ce7.webp"],
    ["her", "109732687", 4.54, "STARFACE Star Balm Lip Balm", "starface-star-balm-lip-balm-f95d62.webp"],
    ["her", "109737953", 4.99, "Sweet & Shimmer Coconut Swirl Candy Cane Bath Fizzer", "sweet-shimmer-candy-cane-bath-fizzer-26713b.webp"],
    ["her", "109738168", 4.99, "Sweet & Shimmer Bow Claw Clip", "sweet-shimmer-bow-claw-clip-3ebe1f.webp"],
    ["him", "109739556", 24.9, "Lodge 10.25 in. Classic Cast Iron Skillet", "lodge-classic-skillet-10-25-in-ca4f91.webp"],
    ["kids", "109730393", 9.95, "OOLY Hair Doodlers Hair Crayons, Set of 6", "ooly-hair-doodlers-hair-crayons-f570a3.webp"],
    ["kids", "109730847", 16.15, "Floss & Rock Construction Memory Match", "floss-rock-construction-memory-match-29acea.webp"],
    ["kids", "109730984", 18.99, "Tender Leaf Toys Safari Binoculars", "tender-leaf-safari-binoculars-b6e1f3.webp"],
    ["kids", "109731305", 22.5, "Sweet Wink Pink Confetti Cape", "sweet-wink-pink-confetti-cape-09e68a.webp"],
    ["kids", "109731598", 23.99, "Brainstorm Toys Shark Torch & Projector", "brainstorm-shark-torch-projector-dfd233.webp"],
    ["kids", "109731941", 10.78, "Burt's Bees Baby Nostalgic Christmas Two-Piece Pajamas", "burts-bees-baby-nostalgic-christmas-pajamas-5ad7e3.webp"],
  ];
  const PAGES = { her: her.picks, him: him.picks, kids: kids.picks } as Record<string, { name: string; href: string; price: number; priceAt: string; image: string }[]>;
  it("each linked keep once, named, priced as read today, with its ShopMy link and its cutout", () => {
    expect(LINKED.length).toBeGreaterThan(12);
    for (const [guide, pin, price, name, file] of LINKED) {
      const rows = PAGES[guide].filter((p) => p.href === `https://go.shopmy.us/p-${pin}`);
      expect(rows.length, `${guide} ${name}`).toBe(1);
      expect(rows[0].name).toBe(name);
      // Guides audit 1126: a price that changed 11-26 shows that read and day (scripts/giftGuidePrices1126.mjs).
      expect(rows[0].price, name).toBe(price1126(rows[0].href) ?? price);
      expect(rows[0].priceAt).toBe(price1126(rows[0].href) !== undefined ? PRICES_AT_1126 : "2026-11-23");
      expect(rows[0].image).toBe(`https://www.louisianahelpr.com/gift-guides/cutouts/${file}`);
      expect(existsSync(`public/gift-guides/cutouts/${file}`), file).toBe(true);
    }
  });
  it("Capri Blue's car diffuser links to Amazon at $23, not the 4% ShopMy link", () => {
    const rows = PAGES.her.filter((p) => /Capri Blue Volcano Car Diffuser/.test(p.name));
    expect(rows.length).toBe(1);
    expect(rows[0].href).toBe("https://www.amazon.com/dp/B09X55PDB7?tag=louisianahelpr-20");
    expect(rows[0].price).toBe(23);
    expect(rows[0].image).toBe("https://m.media-amazon.com/images/I/51q7YVnVwnL._SL500_.jpg");
    expect(PAGES.her.some((p) => p.href.includes("p-109738464") || /(^|\.)capri-blue\.com$/.test(new URL(p.href).hostname))).toBe(false);
  });
  it("the Blackstone press stays off For Him", () => {
    const text = PAGES.him.map((p) => `${p.name} ${p.href}`).join("\n");
    expect(text).not.toMatch(/Smash Burger Press with Smash Guard|blackstoneproducts\.com/i);
  });
  // Train ab 11-23 (lead ~2:20 PM: her Walmart Creator link made): the Dearfoams slippers are on For Him once, on that
  // link, at the $20.00 read on walmart.com 11-23, with the cutout of Walmart's photo, in Under $25 (not a stocking stuffer).
  it("the Dearfoams slippers are on For Him with her Walmart Creator link, $20, a cutout", () => {
    for (const list of [PAGES.him, him1121Picks()] as { name: string; href: string; price?: number; priceAt?: string; image?: string; store?: string }[][]) {
      const rows = list.filter((p) => /Dearfoams/i.test(p.name));
      expect(rows.map((p) => p.href)).toEqual(["https://walmrt.us/4j41V4c"]);
      expect(rows[0]).toMatchObject({ price: 20, priceAt: "2026-11-23", store: "store-walmart", image: "https://www.louisianahelpr.com/gift-guides/cutouts/dearfoams-cozy-comfort-mens-moccasin-slippers-90e6c7.webp" });
    }
    expect(existsSync("public/gift-guides/cutouts/dearfoams-cozy-comfort-mens-moccasin-slippers-90e6c7.webp")).toBe(true);
    for (const g of ["her", "kids"] as const) expect(PAGES[g].some((p) => /Dearfoams/i.test(p.name)), g).toBe(false);
  });
  it("the KREWE sunglasses are on For Her only (owner 11-23 ~1:00 PM: \"there shouldn't be krewe sunglasses on him\")", () => {
    const krewe = (l: { name: string; href: string }[]) => l.filter((p) => /KREWE/i.test(p.name) || p.href.includes("p-109340844"));
    expect(krewe(PAGES.him)).toEqual([]);
    expect(krewe(him1121Picks())).toEqual([]);
    expect(krewe(PAGES.her).map((p) => p.href)).toEqual(["https://go.shopmy.us/p-109340844"]);
  });
  it("the Steve Madden Natan loafer is off For Him (owner 11-23 ~1:01 PM)", () => {
    const loafer = (l: { name: string; href: string }[]) => l.filter((p) => /Steve Madden|Natan/i.test(p.name) || p.href.includes("p-109204287"));
    expect(loafer(PAGES.him)).toEqual([]);
    expect(loafer(him1121Picks())).toEqual([]);
  });
  it("the Braun on For Her is the Silk-expert Pro 5 IPL alone at $279.99 (owner 11-23 ~12:52 PM \"Switch only the Braun\")", () => {
    const braun = PAGES.her.filter((p) => /Braun/.test(p.name));
    expect(braun.map((p) => [p.name, p.href, p.price, p.priceAt, p.image])).toEqual([
      ["Braun Silk-expert Pro 5 IPL", "https://www.amazon.com/dp/B07WYY6KKC?tag=louisianahelpr-20", 279.99, "2026-11-23", "https://m.media-amazon.com/images/I/71TXJv2ot-L._SL500_.jpg"],
    ]);
  });
  it("the Ulta stocking stuffers land in Stocking stuffers under $10", () => {
    for (const [guide, , price] of LINKED) if (guide === "her") expect(priceSectionId(price)).toBe("stocking-stuffers");
    expect(priceSectionId(9.95)).toBe("under-25"); // the OOLY crayons read "~$10"
  });
});
