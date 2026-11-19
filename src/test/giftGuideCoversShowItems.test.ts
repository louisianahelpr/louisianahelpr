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
const CAREER_NEIGHBOURS = "3 usable photos; its other clean photos are on the career covers beside it";
const TEXT_ONLY: Record<string, string> = {
  "restaurant-servers": CAREER_NEIGHBOURS,
  ...Object.fromEntries(["store-lululemon", "store-sephora", "store-ulta-beauty", "store-tiktok-shop", "store-journeys", "store-durango-boots", "store-anthropologie", "store-free-people", "store-crate-and-barrel", "store-uniform-advantage", "store-saks-fifth-avenue", "store-neiman-marcus", "store-maisonette", "store-allmodern", "store-birch-lane", "store-splendid", "store-joss-and-main", "store-over-the-moon", "store-jomashop", "store-atlas-coffee-club", "store-bass-pro-shops", "store-baublebar", "store-bonne-et-filou", "store-cabelas", "store-chefman", "store-chord", "store-clinique-online", "store-columbia", "store-davids-cookies", "store-dermstore", "store-diamond-art-club", "store-dragontree", "store-ecreamery-ice-cream-and-gifts", "store-hanna-andersson", "store-hearthsong", "store-jcrew", "store-julie-vos", "store-kitty-kick-stix", "store-ll-bean", "store-lillypulitzer", "store-literie-candle", "store-little-sleepies", "store-mac-cosmetics", "store-magic-makers", "store-magnolia", "store-makerfire", "store-mason-new-york", "store-milk-bar", "store-momcozy", "store-mud-pie", "store-nixplay", "store-pura-vida-bracelets", "store-re-done", "store-sharper-image", "store-simms-fishing", "store-tarte-cosmetics", "store-tuft-paw", "store-wild-one", "store-zonli"].map((s) => [s, FEW_PHOTOS])),
};
/** Covers with four products whose photos read as gingham to the pixel check (clear glass and white jars). */
const PIXEL_PALE: Record<string, string> = { "store-mario-badescu": "clear and white skincare bottles" };

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
