#!/usr/bin/env node
/**
 * EVERY GIFT GUIDE COVER THE SITE SHOWS CARRIES ITS PRODUCTS (r3 H1, 11-19: 90 of 278 landing covers went out as gingham
 * and the arch only, because scripts/gift-guide-photo-covers.py drew a text-only cover whenever fewer than four product
 * photos survived its rules, and said nothing). Two independent reads:
 *   - the manifest (scripts/gift-guide-cover-items.json): at least MIN_ITEMS products listed for the cover;
 *   - the pixels: the cover file itself, outside the arch, holds product (not gingham) in at least MIN_SLOTS of its six
 *     product places (three a side). An empty cover reads 0 there; a four-item cover 3 or 4; a six-item cover 5 or 6.
 * Guard: src/test/giftGuideCoversShowItems.test.ts.
 */
import { readFileSync } from "node:fs";

export const MANIFEST = "scripts/gift-guide-cover-items.json";
export const COVER_DIR = "public/gift-guides/covers";
export const MIN_ITEMS = 4;
export const MIN_SLOTS = 3;
/** A product place counts as filled when this share of its pixels is far from every gingham colour. */
export const SLOT_FILL = 0.02;
export const SIZE = 480;

const CREAM = [250, 247, 239];
const mix = (c, t) => c.map((x, i) => Math.round(x + (CREAM[i] - x) * t));
const family = (a, b, k, kb) => [mix(a, k), mix(b, kb), CREAM];
/** The cover script's three softened gingham families (FAMILY in gift-guide-photo-covers.py), nine colours. */
export const GINGHAM = [
  ...family([123, 148, 119], [186, 198, 180], 0.45, 0.3),
  ...family([206, 186, 154], [228, 215, 196], 0.3, 0.15),
  ...family([177, 104, 100], [215, 176, 168], 0.45, 0.3),
];
const FAR = 40;
/** The six product places on a 480 px cover, outside the arch's cream and its shadow: [x0, x1, y0, y1]. */
export const SLOTS = [
  [12, 96, 30, 170], [384, 468, 30, 170],
  [12, 96, 175, 310], [384, 468, 175, 310],
  [12, 96, 315, 455], [384, 468, 315, 455],
];

/** The share of non-gingham pixels in each product place of a SIZE x SIZE RGB buffer (3 bytes a pixel). */
export function slotFill(rgb) {
  return SLOTS.map(([x0, x1, y0, y1]) => {
    let off = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * SIZE + x) * 3;
        let near = Infinity;
        for (const [r, g, b] of GINGHAM) {
          const d = (rgb[i] - r) ** 2 + (rgb[i + 1] - g) ** 2 + (rgb[i + 2] - b) ** 2;
          if (d < near) near = d;
        }
        if (near > FAR * FAR) off++;
      }
    }
    return off / ((x1 - x0) * (y1 - y0));
  });
}

/** How many of the six product places hold a product. */
export const filledSlots = (rgb) => slotFill(rgb).filter((v) => v > SLOT_FILL).length;

/** Each slug whose manifest entry lists fewer than MIN_ITEMS products (or has none), as "slug (n)". */
export function shortInManifest(manifest, slugs) {
  return slugs.filter((s) => (manifest[s]?.items?.length ?? 0) < MIN_ITEMS).map((s) => `${s} (${manifest[s]?.items?.length ?? 0})`);
}

export const readManifest = () => JSON.parse(readFileSync(MANIFEST, "utf8"));
