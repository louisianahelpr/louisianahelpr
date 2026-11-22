/**
 * The owner's launch-day picks (2026-11-22, Desktop note "Gift guides and affiliate/Owner-adds-1122.md"): every pick she
 * sent as a ShopMy link is on the guide she named, priced from the store's own page that day, with a transparent cutout,
 * and her Camp Snap code on each campsnapphoto.com row. Owner answers via the lead, 11-22: the Swank Camp Snap pins go
 * to Camp Snap direct (sale price + LEXILOMBAS7); the sold-out Sleep Crown goes on now with a short "Back Dec 1" chip
 * that hides on Dec 1; the Kate McLeod lotion bar waits (sold out at The Sleep Code, no paying link elsewhere).
 *
 * @mutate scripts/giftGuideHer1121.mjs | export const HER_ROWS = [...HER_1121, ...HER_ADDS_1122]; | export const HER_ROWS = [...HER_1121];
 * @mutate scripts/giftGuideHimKids1121.mjs | export function kids1121Picks(rows = [...KIDS_1121, ...KIDS_ADDS_1122]) { | export function kids1121Picks(rows = [...KIDS_1121]) {
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
  ["p-107929179", "her", "store-camp-snap", 79], // CS-Pro: her Swank pin p-109140912 ($99) moved to Camp Snap direct
  ["p-109141448", "her", "store-camp-snap", 159], // CS-8 camcorder
  ["p-109143437", "her", "store-sleep-crown", 289], // Sleep Crown Classic (sold out until Dec 1)
  ["p-109143698", "her", "store-crown-affair", 59],
  ["p-109144140", "her", "store-macys", 84.79], // Serta pad, from (Twin)
  ["p-109144450", "her", "store-eadem", 24],
  ["p-109145379", "her", "store-aera", 98],
  ["p-109145823", "her", "store-macys", 199], // Coravin Pivot+
  ["p-107929152", "kids", "store-camp-snap", 59.99], // Camp Snap 2 Blue Rush: her Swank pin p-109142125 moved to Camp Snap direct
  ["p-104219842", "kids", "store-camp-snap", 59.99], // Camp Snap 2 Strawberry Splash: her Swank pin p-109142226 likewise
];

describe("the owner's launch-day picks (11-22)", () => {
  it("each is on the guide she named, once, at the store's own price checked 11-22, with a cutout photo", () => {
    expect(SENT.length).toBeGreaterThan(10);
    expect(HER_ADDS_1122.length + KIDS_ADDS_1122.length + HIM_ADDS_1122.length).toBe(SENT.length);
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

  it("every cutout of these photos is in the shared cutout map, so no add shows its boxed original", () => {
    expect(ADDS_CUTOUTS_1122.length).toBeGreaterThan(10);
    for (const [from, file] of ADDS_CUTOUTS_1122) expect(CUTOUTS_1120.get(from), from).toBe(file);
  });

  it("the Swank Camp Snap pins are not used; every Camp Snap row carries her code LEXILOMBAS7", () => {
    const all = ["her", "him", "kids"].flatMap(chunk);
    for (const swank of ["p-109140912", "p-109142125", "p-109142226"]) expect(all.some((x) => x.href === pin(swank)), swank).toBe(false);
    const camp = all.filter((x) => x.store === "store-camp-snap");
    expect(camp.length).toBeGreaterThan(5);
    for (const x of camp) expect(x.code, x.name).toBe("LEXILOMBAS7");
  });

  it("the Serta pad shows its lowest size price as \"from\"; the Kate McLeod bar waits for a restock", () => {
    expect(chunk("her").find((x) => x.href === pin("p-109144140"))?.priceFrom).toBe(true);
    expect(["her", "him", "kids"].flatMap(chunk).some((x) => x.href === pin("p-109144875"))).toBe(false);
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
