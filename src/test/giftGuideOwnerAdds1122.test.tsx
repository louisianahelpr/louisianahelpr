/**
 * The owner's launch-day picks (2026-11-22, Desktop note "Gift guides and affiliate/Owner-adds-1122.md"): every pick she
 * sent as a ShopMy link is on the guide she named, priced from the store's own page that day, with a transparent cutout,
 * and her Camp Snap code on each campsnapphoto.com row. Owner answers via the lead, 11-22: the Swank Camp Snap pins go
 * to Camp Snap direct (sale price + LEXILOMBAS7); the sold-out Sleep Crown goes on now with a short "Back Dec 1" chip
 * that hides on Dec 1; the Kate McLeod lotion bar waits (sold out at The Sleep Code, no paying link elsewhere).
 *
 * @mutate scripts/giftGuideHer1121.mjs | export const HER_ROWS = [...HER_1121, ...HER_ADDS_1122, ...HER_POPULAR_1122]; | export const HER_ROWS = [...HER_1121, ...HER_POPULAR_1122];
 * @mutate scripts/giftGuideHimKids1121.mjs | export function kids1121Picks(rows = [...KIDS_1121, ...KIDS_ADDS_1122, ...KIDS_POPULAR_1122]) { | export function kids1121Picks(rows = [...KIDS_1121, ...KIDS_POPULAR_1122]) {
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |   const back = pick.backOn && today < pick.backOn ? G.backOnChip(pick.backOn) : undefined; |   const back = undefined;
 * @mutate src/content/giftGuideCatalog.ts | ...(p.backOn ? { backOn: p.backOn } : {}), |
 * @mutate scripts/giftGuideOwnerAdds1122.mjs | const dated = (r) => ({ ...r, priceAt: ADDS_PRICE_AT }); | const dated = (r) => r;
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ADDS_CUTOUTS_1122, ADDS_PRICE_AT, HER_ADDS_1122, HIM_ADDS_1122, KIDS_ADDS_1122 } from "../../scripts/giftGuideOwnerAdds1122.mjs";
import { CUTOUT_BASE, CUTOUTS_1120 } from "../../scripts/giftGuideCutouts1120.mjs";
import { RESEARCHED_STORES } from "@/content/giftGuidePicks";
import { guideBySlug, loadAllGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { PickRow } from "@/pages/info/giftGuides/GiftGuideView";

afterEach(() => { cleanup(); vi.useRealTimers(); });

type Pick = { name: string; href: string; image?: string; store: string; price?: number; priceAt?: string; priceFrom?: true; code?: string; backOn?: string; ownerPick?: true };
const chunk = (slug: string) => (JSON.parse(readFileSync(`src/content/giftGuidePicks/${slug}.json`, "utf8")) as { picks: Pick[] }).picks;
const pin = (p: string) => `https://go.shopmy.us/${p}`;

/** Copied from the Desktop note (not from the module): pin -> guide, store, price checked 11-22. */
const SENT: [string, string, string, number][] = [
  ["p-109140863", "her", "store-camp-snap", 59.99], // Camp Snap 2, Chestnut
  ["p-109143437", "her", "store-sleep-crown", 289], // Sleep Crown Classic (sold out until Dec 1)
  ["p-109143698", "her", "store-crown-affair", 59],
  ["p-109144140", "her", "store-macys", 84.79], // Serta pad, from (Twin)
  ["p-109144450", "her", "store-eadem", 24],
  ["p-109145379", "her", "store-aera", 98],
  ["p-109145823", "her", "store-macys", 199], // Coravin Pivot+
  ["p-107929152", "kids", "store-camp-snap", 59.99], // Camp Snap 2 Blue Rush: her Swank pin p-109142125 moved to Camp Snap direct
  ["p-104219842", "kids", "store-camp-snap", 59.99], // Camp Snap 2 Strawberry Splash: her Swank pin p-109142226 likewise
  // Batch 2.
  ["p-109147879", "her", "store-lemme", 30],
  ["p-109152557", "her", "store-huntandbloom", 42],
  ["p-109153848", "her", "store-stil", 18],
  ["p-109153960", "her", "store-stil", 18],
  ["p-109153910", "her", "store-stil", 24],
  ["p-109153811", "her", "store-stil", 44],
  ["p-109151082", "her", "store-emi-jay", 36],
  ["p-109154746", "her", "store-eleven-eleven", 158],
  ["p-109155269", "her", "store-eadem", 58], // owner via lead: Kids; owner 11-22 PM: moved to Her
  ["p-103892269", "him", "store-lake-pajamas", 138],
  ["p-104054474", "him", "store-lake-pajamas", 108],
  // Batch 2b.
  ["p-109150422", "her", "store-sleepy-tie", 29.99],
  ["p-109158379", "her", "store-foton", 36.99],
  ["p-103889077", "her", "store-lake-pajamas", 124], // in place of p-103884402 (gone from Lake's site)
  ["p-109156467", "kids", "store-yoto", 165.72],
  ["p-109156399", "kids", "store-yoto", 164.02],
  // Batch 2c.
  ["p-109147619", "her", "store-ulta-beauty", 18],
  ["p-109151385", "her", "store-target", 79.99],
  ["p-109149968", "her", "store-anthropologie", 89],
  ["p-109152299", "her", "store-cos-bar", 90],
  ["p-109155568", "her", "store-madewell", 158],
  ["p-109155784", "her", "store-ulta-beauty", 399],
  // Him batch 1 (her Nov 19 pins) and batch 2 (links the lead made 11-22), builder-guide-him.
  ["p-107850277", "him", "store-l-l-bean", 299.99], // Solo Stove Bonfire with stand
  ["p-107837448", "him", "store-l-l-bean", 165], // YETI Roadie 8 (the Roadie 15 is off: same cooler)
  ["p-107881822", "him", "store-the-warming-store", 195], // Muck Arctic Pro
  ["p-107847793", "him", "store-cavenders", 129.99], // Carhartt Duck Insulated Active Jacket
  ["p-107895312", "him", "store-tractor-supply", 64.99], // Duck Commander Phil Robertson Pro Series
  ["p-107895486", "him", "store-tractor-supply", 44.99], // Duck Commander Camo Max Mallard Hen
  ["p-109208695", "him", "store-smathers-and-branson", 195], // S&B Monogrammed Wallet, Hunter Green
  ["p-109208941", "him", "store-marley-lilly", 34.99], // Marley Lilly waxed canvas small cooler
  // Him batch 3 (her Nov 19 pins). The L.L.Bean sweater shows $130, the price on her pin data (lead 11-22).
  ["p-108089555", "him", "store-jomashop", 262], // Costa Sullivan polarized glass sunglasses
  ["p-108094779", "him", "store-l-l-bean", 130], // L.L.Bean Men's Waterfowl Sweater
  // owner 11-22 popular via new ShopMy links (builder-guide-links)
  ["p-109207730", "her", "store-esker-beauty", 75],
  ["p-109208209", "kids", "store-crunchlabs", 34.99],
  ["p-103757260", "kids", "store-maisonette", 129.99],
  ["p-109208104", "kids", "store-target", 44.99],
  ["p-109199365", "him", "store-saks-fifth-avenue", 154],
  ["p-109203985", "him", "store-st-bernard", 159],
  ["p-109204287", "him", "store-dsw", 139.99],
  // Owner 11-22 PM (builder-guide-emibauble; ShopMy-links-created-1122.md): the BaubleBar brush from her screenshots (the
  // red Emi Jay clip was skipped, her Doe is already on Her); the Pottery Barn Kids Anywhere Chair in place of the Melissa
  // & Doug Club Chair. The CS-8 camcorder (p-109141448) is off Her ("Choose one of these camp snap cameras").
  ["p-109289957", "her", "store-baublebar", 48], // Mini Fine Line Custom Hair Brush, Magenta
  ["p-109292071", "kids", "store-pottery-barn-kids", 119], // Anywhere Chair, Twill, from (personalization $17 more)
];
/** Amazon picks from her launch-day screenshots and asks (no ShopMy pin for them): ASIN -> guide, price 11-22. */
const AMAZON_1122: [string, string, number][] = [
  ["B0HKS18NW2", "her", 14.98], ["B0C1YBPJ43", "her", 35.98], ["B0F2937DQQ", "her", 56.98], ["B09X3WGJ3R", "her", 111.99],
  ["B0DQLLPYGM", "her", 184.89], ["B0GP2R8TBS", "her", 199], ["B0GZSMBDYZ", "her", 237], ["B089F9YDFC", "him", 19.99],
  // Him batch 2: the GE Profile Opal Mini (the method body wash stayed out: Him already has it).
  ["B0H51ZX6SB", "him", 299],
  // builder-guide-her4 block 2 (11-22)
  ["B0H2FQ5FV1", "her", 39.99], ["B0FXYGCYK6", "her", 24.99], ["B0F5K3B4Q7", "her", 29.94], ["B0CHMS3PVZ", "her", 27.99], ["B0D7GQVNNN", "her", 23.8], ["B0D1X4PNFD", "her", 29.95], ["B0F7M3HPBD", "her", 229], ["B0H3YXW87L", "her", 42.99], ["B0H9L8Z1DY", "her", 21.99], ["B0F79VTVFQ", "her", 85],
  // batch 2
  ["B0D92375JB", "her", 26.99], ["B0G4M22BQL", "her", 32.99], ["B0BGS3L9XS", "her", 27.99], ["B0DXWP12C8", "her", 13.99], ["B0HKYH5TF2", "her", 39.99], ["B0H2CSG4SZ", "her", 15.99], ["B0FXBBD5GS", "her", 17.5], ["B0G3948RG8", "her", 14.8], ["B0HKQYLRBB", "her", 22.99],
  ["B07XL9MFZQ", "her", 12.74], // owner 11-22 PM: tortoise blue light glasses in place of the Stoggles
];

describe("the owner's launch-day picks (11-22)", () => {
  it("each is on the guide she named, once, at the store's own price checked 11-22, with a cutout photo", () => {
    expect(SENT.length).toBeGreaterThan(10);
    expect(HER_ADDS_1122.length + KIDS_ADDS_1122.length + HIM_ADDS_1122.length).toBe(SENT.length + AMAZON_1122.length);
    for (const [p, slug, store, price] of SENT) {
      const rows = chunk(slug).filter((x) => x.href === pin(p));
      expect(rows.length, `${slug}: ${p}`).toBe(1);
      const [row] = rows;
      expect(row.store, p).toBe(store);
      expect(row.price, p).toBe(price);
      expect(row.priceAt, p).toBe(ADDS_PRICE_AT);
      expect(row.ownerPick, p).toBe(true);
      expect(row.image?.startsWith(CUTOUT_BASE), `${p}: ${row.image}`).toBe(true);
      expect(existsSync(`public/gift-guides/cutouts/${String(row.image).slice(CUTOUT_BASE.length)}`), p).toBe(true);
      expect(RESEARCHED_STORES[store]?.name, store).toBeTruthy();
    }
    expect(ADDS_PRICE_AT).toBe("2026-11-22");
  });

  it("each Amazon pick is on its guide once, with her tag, Amazon's own photo (never cut out) and the price she'd see 11-22", () => {
    for (const [asin, slug, price] of AMAZON_1122) {
      const rows = chunk(slug).filter((x) => x.href === `https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`);
      expect(rows.length, `${slug}: ${asin}`).toBe(1);
      expect(rows[0].store, asin).toBe("store-amazon");
      expect(rows[0].image, asin).toMatch(/^https:\/\/m\.media-amazon\.com\/images\/I\//);
      expect(rows[0].price, asin).toBe(price);
      expect(rows[0].priceAt, asin).toBe(ADDS_PRICE_AT);
    }
  });

  it("every cutout of these photos is in the shared cutout map, so no add shows its boxed original", () => {
    expect(ADDS_CUTOUTS_1122.length).toBeGreaterThan(10);
    for (const [from, file] of ADDS_CUTOUTS_1122) expect(CUTOUTS_1120.get(from), from).toBe(file);
  });

  it("the Swank Camp Snap pins are not used; every Camp Snap row carries her code LEXILOMBAS7", () => {
    const all = ["her", "him", "kids"].flatMap(chunk);
    for (const swank of ["p-109140912", "p-109142125", "p-109142226"]) expect(all.some((x) => x.href === pin(swank)), swank).toBe(false);
    const camp = all.filter((x) => x.store === "store-camp-snap");
    expect(camp.length).toBeGreaterThan(2); // 3 since the owner kept one Camp Snap on Her (11-22 PM)
    for (const x of camp) expect(x.code, x.name).toBe("LEXILOMBAS7");
  });

  it("the Serta pad shows its lowest size price as \"from\"; the Kate McLeod bar waits for a restock", () => {
    expect(chunk("her").find((x) => x.href === pin("p-109144140"))?.priceFrom).toBe(true);
    // The Pottery Barn Kids chair is priced by size (from $119), so it shows "from" too.
    expect(chunk("kids").find((x) => x.href === pin("p-109292071"))?.priceFrom).toBe(true);
    expect(["her", "him", "kids"].flatMap(chunk).some((x) => x.href === pin("p-109144875"))).toBe(false);
  });
});

describe("owner 11-22 PM edits (builder-guide-emibauble)", () => {
  it("Her keeps one Emi Jay clip (the Doe) and one Camp Snap (the Chestnut), and the swapped-out rows are gone", () => {
    const her = chunk("her");
    expect(her.filter((x) => x.store === "store-emi-jay").map((x) => x.href)).toEqual([pin("p-109151082")]);
    expect(her.filter((x) => x.store === "store-camp-snap").map((x) => x.href)).toEqual([pin("p-109140863")]);
    const gone = ["B000S5VEA2", "B0FGDQ5BT9", "p-103899561", "B0F831FK2R", "B0B22SZ3W8", "p-108611500", "p-107929179", "p-109141448", "p-109290718"];
    for (const id of gone) expect(her.some((x) => x.href.includes(id)), id).toBe(false);
    expect(chunk("kids").some((x) => x.href.includes("p-108632059") || x.href.includes("p-109155269"))).toBe(false);
  });
});

describe("\"Back Dec 1\" on the sold-out Sleep Crown (owner 11-22)", () => {
  it("the page shows the chip before Dec 1 and drops it on Dec 1; a pick without one never shows it", async () => {
    await loadAllGuidePicks();
    const picks = guideBySlug("her")?.picks ?? [];
    expect(picks.length).toBeGreaterThan(40);
    const sleep = picks.find((p: CatalogPick) => p.href === pin("p-109143437"));
    expect(sleep?.backOn).toBe("2026-12-01");
    const at = (iso: string, p: CatalogPick) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(iso));
      const c = render(<MemoryRouter><ol><PickRow pick={p} /></ol></MemoryRouter>).container;
      const chip = c.querySelector("[data-gift-back-chip]")?.textContent ?? null;
      cleanup();
      vi.useRealTimers();
      return chip;
    };
    expect(at("2026-11-22T18:00:00Z", sleep as CatalogPick)).toBe("Back Dec 1");
    expect(at("2026-11-30T18:00:00Z", sleep as CatalogPick)).toBe("Back Dec 1");
    expect(at("2026-12-01T18:00:00Z", sleep as CatalogPick)).toBeNull();
    const other = picks.find((p: CatalogPick) => p.href === pin("p-109143698"));
    expect(at("2026-11-22T18:00:00Z", other as CatalogPick)).toBeNull();
  });
});
