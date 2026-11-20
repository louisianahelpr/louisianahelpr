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
import { CHUNK_PICK_COUNTS } from "@/content/giftGuidePicks";
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
/**
 * Re-measured 2026-11-19 after the r3 follow-up gathered store photos (scripts/gift-guide-store-cover-photos.json): 52
 * of the 59 store pages here now show products. These seven could not get four photos of products the store sells:
 * the site refuses automated requests or shoots on coloured, grey or model backdrops.
 */
const BIG_1120 = "under 4 clean product photos after the big batch 1120 (guide merges, 30 store pages, one place per item and color), measured 2026-11-20 by the cover script's TEXT ONLY line: the rest are lifestyle, on-model or not on white";
// Big batch 1120: rebuilt from the cover script's TEXT ONLY line after the merges (every entry a guide the page shows;
// the store pages under STORE_ROW_MIN_PICKS are thin and not shown, so not listed).
const TEXT_ONLY: Record<string, string> = {
  "book-lover": BIG_1120,
  "thinking-of-you": BIG_1120,
  "new-puppy": BIG_1120,
  "store-free-people": `${FEW_PHOTOS}: site and image server answer 403; its photos are grey-backdrop or on-model`,
  "store-kendra-scott": BIG_1120,
};
const PIXEL_PALE: Record<string, string> = {};

const manifest = readManifest();
const covers = new Set(COVER_SLUGS);
const shown = GUIDES.filter((g) => !g.empty && !g.thin && covers.has(g.slug)).map((g) => g.slug);
/**
 * Owner 11-19 ("just leave it, no one is looking anyway"): a guide shows from 1 pick (GUIDE_MIN_PICKS), so a guide with
 * fewer than SMALL_GUIDE picks (UNIQUE_FLOOR in scripts/gift-guide-picks.mjs; most were hidden until then) may show a cover with fewer than four products. Read from the
 * pick count, never from the cover.
 */
const SMALL_GUIDE = 8;
const small = (s: string) => !s.startsWith("store-") && (CHUNK_PICK_COUNTS[s] ?? 0) < SMALL_GUIDE;
const checked = shown.filter((s) => !(s in TEXT_ONLY) && !small(s));

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
    expect(shown.length).toBeGreaterThan(70); // 1120: ~65 guides + the kept store pages
    expect(checked.length).toBeGreaterThan(55);
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
