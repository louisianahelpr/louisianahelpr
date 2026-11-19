/**
 * Every gift guide cover the site shows carries its products (r3 H1, 2026-11-19: 90 of 278 landing covers went out as
 * gingham and the arch only; scripts/gift-guide-photo-covers.py drew a text-only cover whenever fewer than four product
 * photos survived its rules, and said nothing). For every guide the site lists (not empty, not a thin store page) that
 * has a cover file, two independent reads (scripts/check-gift-cover-items.mjs):
 *   - the manifest lists at least four products for it;
 *   - the cover file's pixels hold product, not gingham, in at least three of its six product places.
 * TEXT_ONLY names a shown guide that has no product photo the cover rules allow, with why; it is two-way (an entry whose
 * cover now has items fails, so the list cannot go stale).
 *
 * @mutate scripts/check-gift-cover-items.mjs | export const MIN_ITEMS = 4; | export const MIN_ITEMS = 0;
 *
 * @mutate scripts/check-gift-cover-items.mjs |         if (near > FAR * FAR) off++; |         if (near > FAR * FAR * 99) off++;
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { GUIDES } from "@/content/giftGuideCatalog";
import { COVER_SLUGS } from "@/content/giftGuideCoverSlugs";
import {
  COVER_DIR, GINGHAM, MIN_SLOTS, SIZE, filledSlots, readManifest, shortInManifest,
} from "../../scripts/check-gift-cover-items.mjs";

/**
 * Shown guides with fewer than four clean product photos the cover rules allow, so their cover is the text-only arch
 * (measured 2026-11-19 on main after #4759; the cover script prints each one's reasons as "SHORT <slug>"). Store pages
 * here have only lifestyle or model shots, photos the store's CDN refuses (L.L.Bean answers 403), or under four
 * products at all. Two-way: an entry whose cover gains products fails until it is removed.
 */
const FEW_PHOTOS = "fewer than 4 clean product-only photos";
const CAREER_NEIGHBOURS = "2 usable photos; its other clean photos are on the career covers beside it";
/**
 * Re-measured 2026-11-19 after the r3 follow-up gathered store photos (scripts/gift-guide-store-cover-photos.json): 52
 * of the 59 store pages here now show products. These seven could not get four photos of products the store sells:
 * the site refuses automated requests or shoots on coloured, grey or model backdrops.
 */
const TEXT_ONLY: Record<string, string> = {
  "restaurant-servers": CAREER_NEIGHBOURS,
  // Fit r4 (11-19): the brand cap of 3 now holds in the Louisiana guides, and North Louisiana keeps only North Louisiana
  // items (one, the Duck Commander call, on a lifestyle photo); the shops' remaining photos are lifestyle shots.
  "louisiana-sweets-and-bakeries": `${FEW_PHOTOS}: 2 clean photos after the brand cap; the bakeries' other photos are lifestyle shots`,
  "housekeepers": `${FEW_PHOTOS}: 2 clean photos left once fit r4 took out its cleaning supplies, medical and duplicate items`,
  "north-louisiana": `${FEW_PHOTOS}: its one North Louisiana item (Duck Commander's RDC 200 call) has no clean product photo`,
  "store-free-people": `${FEW_PHOTOS}: site and image server answer 403; its photos are grey-backdrop or on-model`,
  "store-crate-and-barrel": `${FEW_PHOTOS}: site answers 403; its studio photos sit on a grey gradient`,
  "store-birch-lane": `${FEW_PHOTOS}: Wayfair's sites answer 429; no clean photo of a product Birch Lane lists`,
  "store-joss-and-main": `${FEW_PHOTOS}: Wayfair's sites answer 429; one clean photo of a product it lists`,
  "store-chord": `${FEW_PHOTOS}: every cap photo on its site is on a coloured backdrop`,
  "store-tuft-paw": `${FEW_PHOTOS}: 79 of its 80 product photos are on coloured backdrops`,
  "store-zonli": `${FEW_PHOTOS}: its site sits behind a bot challenge; its linked photos are on coloured backdrops`,
  // New approval 11-19: its 133-product Shopify catalog (first 8 photos each) has one plain-backdrop photo, a scarf on
  // cream; the rest are on-model shots beside care-icon or text panels.
  "store-cashmere-boutique": `${FEW_PHOTOS}: one plain-backdrop photo in its catalog; the rest are on-model with text panels`,
};
/** Covers with four products whose photos read as gingham to the pixel check (clear glass and white jars). */
const PIXEL_PALE: Record<string, string> = {
  "store-mario-badescu": "clear and white skincare bottles",
  "store-magnifique": "cream and oatmeal clay pots",
  cnas: "a white Hatch clock and a pale pink pocket organizer (fit r4 redraw)",
};

const manifest = readManifest();
const covers = new Set(COVER_SLUGS);
const shown = GUIDES.filter((g) => !g.empty && !g.thin && covers.has(g.slug)).map((g) => g.slug);
const checked = shown.filter((s) => !(s in TEXT_ONLY));

const rgb = async (file: string) =>
  sharp(file).removeAlpha().resize(SIZE, SIZE).raw().toBuffer();

/** A text-only cover's product places: plain gingham checks, as the cover script paints them. */
function plainGingham(): Buffer {
  const buf = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = GINGHAM[(Math.floor(x / 27) % 2) + (Math.floor(y / 27) % 2)];
      buf.set(c, (y * SIZE + x) * 3);
    }
  }
  return buf;
}

describe("gift guide covers show their products", () => {
  it("reads every shown guide's cover", () => {
    expect(shown.length).toBeGreaterThan(250);
    expect(checked.length).toBeGreaterThan(250);
    for (const s of shown) expect(existsSync(`${COVER_DIR}/${s}.webp`), s).toBe(true);
  });

  it("the pixel read finds no product on plain gingham, and products on a full cover", async () => {
    expect(filledSlots(plainGingham())).toBe(0);
    expect(filledSlots(await rgb(`${COVER_DIR}/mom.webp`))).toBeGreaterThanOrEqual(5);
  });

  it("the manifest read flags a cover with too few products", () => {
    expect(shortInManifest({ a: { items: [1, 2, 3] }, b: { items: [1, 2, 3, 4] } }, ["a", "b", "c"])).toEqual(["a (3)", "c (0)"]);
  });

  it("every shown cover lists at least four products in the manifest", () => {
    expect(shortInManifest(manifest, checked)).toEqual([]);
  });

  it("every shown cover file shows products outside the arch", async () => {
    const empty: string[] = [];
    for (const s of checked.filter((x) => !(x in PIXEL_PALE))) {
      const n = filledSlots(await rgb(`${COVER_DIR}/${s}.webp`));
      if (n < MIN_SLOTS) empty.push(`${s} (${n} of 6 places)`);
    }
    expect(empty).toEqual([]);
  });

  it("PIXEL_PALE lists only shown four-item covers the pixel read misses (two-way)", async () => {
    for (const s of Object.keys(PIXEL_PALE)) {
      expect(shown, s).toContain(s);
      expect(manifest[s]?.items.length ?? 0, s).toBeGreaterThanOrEqual(4);
      expect(filledSlots(await rgb(`${COVER_DIR}/${s}.webp`)), s).toBeLessThan(MIN_SLOTS);
    }
  });

  it("TEXT_ONLY lists only shown guides whose cover really has no products (two-way)", () => {
    for (const s of Object.keys(TEXT_ONLY)) {
      expect(shown, s).toContain(s);
      expect(manifest[s]?.items.length ?? 0, s).toBe(0);
    }
  });
});
