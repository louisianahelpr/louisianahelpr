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
// Big batch 1120: rebuilt from the cover script's TEXT ONLY line after the merges (every entry a guide the page shows;
// the store pages under STORE_ROW_MIN_PICKS are thin and not shown, so not listed).
// Follow-up 1120 (~30 guides, the owner's 26 store pages): rebuilt from the cover script's TEXT ONLY line, 2026-11-20.
// Builder 3 1120b: covers now draw only non-Amazon picks that are still in the guide after the owner's removals, so more
// guides fall under four usable photos. Rebuilt from the cover script's TEXT ONLY line, 2026-11-20 8:17 PM.
const TEXT_ONLY: Record<string, string> = {
  heroes: `${FEW_PHOTOS}: 3 clean, fitting product photos once the sold-out Durango work boot left the guide (section audit 2026-11-20)`,
  "store-hoka": `${FEW_PHOTOS}: 3 of its 10 picks cut out cleanly (the rest are on-foot or coloured-backdrop shots), measured 2026-11-20`,
  "store-baublebar": `${FEW_PHOTOS}: 1 of its 10 picks is on white (the rest are coloured-backdrop shots), measured 2026-11-20`,
  "store-amazon": `${FEW_PHOTOS}: every pick is an Amazon photo, and Amazon photos never go on a cover`,
  "louisiana-by-region": `${FEW_PHOTOS}: 2 of its 8 non-Amazon picks are usable, measured 2026-11-20`,
  "car-lover": `${FEW_PHOTOS}: 1 of its 2 non-Amazon picks is usable, measured 2026-11-20`,
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
    expect(shown.length).toBeGreaterThan(45); // follow-up 1120: ~30 guides + 26 store pages (54 covers drawn, 2026-11-20)
    expect(checked.length).toBeGreaterThanOrEqual(43); // 43 measured 2026-11-20 night: the owner standard left Coffee Lover (7) and Gift Wrap & Cards (6) under SMALL_GUIDE picks (51 shown, 6 text only)
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
