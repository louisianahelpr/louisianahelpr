/**
 * Owner 2026-11-22, 10:15 PM (final), on the 1200x630 link previews (public/gift-guides/og-wide/<key>.jpg, drawn by
 * scripts/gift-guide-wide-og.py): "Her, Him and Kids show the same picture as their covers on the guide (the gingham
 * arch with that cover's gifts). Every other page (Black Friday, Cyber Monday, sponsors, printables, Hub, planner and so
 * on) shows just its gingham and arch with the words, no items."
 *
 * Two-way, two reads:
 *   - config: COVER_KEYS is exactly her, him, kids; every PAGES entry is four string literals (no photo source); the only
 *     Image.open is in manifest_photos, which reads the cover's own items (scripts/gift-guide-cover-items.json), and the
 *     photos come only from COVER_KEYS;
 *   - pixels: outside the arch (x < 300 or x >= 900 on the 1200x630 card, cell edges skipped) every arch-only card is its
 *     gingham to within 48 per channel (measured 2026-11-22: 0 pixels off, worst 12), and each of her/him/kids has
 *     thousands of pixels off it (measured 36,447..41,214: its cover's six cutouts).
 *
 * @mutate scripts/gift-guide-wide-og.py | COVER_KEYS = ("her", "him", "kids", | COVER_KEYS = ("her", "him", "kids", "black-friday",
 * @mutate scripts/gift-guide-wide-og.py |     "gift-tags": ("/gift-guides/printables/gift-tags", "red", "free printables", "Gift Tags"), |     "gift-tags": ("/gift-guides/printables/gift-tags", "red", "free printables", "Gift Tags", lambda: [Image.open("public/printables/tags/a.webp")]),
 * @mutate scripts/gift-guide-wide-og.py |         photos = manifest_photos(key) if key in COVER_KEYS else [] |         photos = manifest_photos("her")
 */
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { WIDE_OG_VERSIONS } from "@/lib/giftGuideWideOg.mjs";
import { blankHashComments } from "./helpers/blankNonCode";
import { THEME_GUIDES_1124 } from "@/content/giftGuideLive.mjs";

const SCRIPT = "scripts/gift-guide-wide-og.py";
const DIR = "public/gift-guides/og-wide";
// Owner 2026-11-24: each themed kids guide's card (Monster Jam, Bluey ...) carries its cover's six gifts too, like Her, Him and Kids.
const COVERS = ["her", "him", "kids", ...THEME_GUIDES_1124];

/** The generator's own gingham families (FAMILY in the script): base, stripe, crossing. */
const CREAM: [number, number, number] = [250, 247, 239];
const FAMILY: Record<string, [number, number, number][]> = {
  green: [[38, 94, 60], [150, 178, 154], CREAM],
  oat: [[219, 204, 180], [231, 220, 202], CREAM],
  red: [[168, 36, 42], [222, 150, 148], CREAM],
};
const CELL = 42; // c = 42 * S drawn at 2x, so 42 px on the 1200x630 card

function code(): string {
  return blankHashComments(readFileSync(SCRIPT, "utf8"));
}

/** Each PAGES entry: key -> the raw tuple text between its parentheses. */
function pages(src: string): Map<string, string> {
  const start = src.indexOf("PAGES = {");
  expect(start, "PAGES = { not found in the generator").toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf("\n}\n", start));
  const out = new Map<string, string>();
  for (const m of body.matchAll(/^\s*"([\w-]+)":\s*\((.*)\),?\s*$/gm)) out.set(m[1], m[2]);
  return out;
}

/** Pixels outside the arch that are more than 48 off the ideal gingham in some channel. */
async function offGingham(key: string, tint: string): Promise<number> {
  const { data, info } = await sharp(`${DIR}/${key}.jpg`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const [a, b, o] = FAMILY[tint];
  let off = 0;
  for (let y = 0; y < info.height; y++) {
    const ry = y % CELL;
    if (ry < 2 || ry > CELL - 3) continue;
    for (let x = 0; x < info.width; x++) {
      if (x >= 300 && x < 900) continue;
      const rx = x % CELL;
      if (rx < 2 || rx > CELL - 3) continue;
      const col = Math.floor(x / CELL) % 2 === 1;
      const row = Math.floor(y / CELL) % 2 === 1;
      const ideal = col && row ? o : col || row ? b : a;
      const i = (y * info.width + x) * info.channels;
      const d = Math.max(Math.abs(data[i] - ideal[0]), Math.abs(data[i + 1] - ideal[1]), Math.abs(data[i + 2] - ideal[2]));
      if (d > 48) off++;
    }
  }
  return off;
}

describe("link previews: only Her, Him and Kids carry their cover's gifts (owner 2026-11-22, 10:15 PM)", () => {
  const src = code();
  const entries = pages(src);
  const tintOf = (key: string) => (entries.get(key) ?? "").match(/^\s*"[^"]*",\s*"(\w+)"/)?.[1] ?? "";

  it("COVER_KEYS is exactly her, him, kids, and every page's config has no photo source", () => {
    expect(entries.size).toBeGreaterThan(15); // 17 measured 2026-11-22
    expect([...entries.keys()].sort()).toEqual(Object.keys(WIDE_OG_VERSIONS).sort());
    const cover = src.match(/^COVER_KEYS = \(([^)]*)\)$/m);
    expect(cover, "COVER_KEYS = (...) not found").not.toBeNull();
    expect([...(cover?.[1] ?? "").matchAll(/"([\w-]+)"/g)].map((m) => m[1])).toEqual(COVERS);
    for (const [key, tuple] of entries) {
      expect(tuple, `${key}: four quoted strings only`).toMatch(/^\s*"[^"]*",\s*"[^"]*",\s*"[^"]*",\s*"[^"]*"\s*$/);
    }
  });

  it("photos come only from COVER_KEYS' own cover items; nothing else opens an image", () => {
    expect(src.match(/Image\.open\s*\(/g) ?? []).toHaveLength(1);
    const fn = src.slice(src.indexOf("def manifest_photos(slug):"), src.indexOf("\ndef ", src.indexOf("def manifest_photos(slug):") + 1));
    expect(fn).toMatch(/for it in MANIFEST\[slug\]\["items"\]:/);
    expect(fn).toMatch(/Image\.open\s*\(/);
    expect(src).toMatch(/^ {8}photos = manifest_photos\(key\) if key in COVER_KEYS else \[\]$/m);
    expect(src).toMatch(/^ {8}kind = "products" if key in COVER_KEYS else "none"$/m);
    const manifest = JSON.parse(readFileSync("scripts/gift-guide-cover-items.json", "utf8")) as Record<string, { items: unknown[] }>;
    for (const k of COVERS) expect(manifest[k]?.items.length, `${k}: its cover's six gifts`).toBe(6);
  });

  it.each(Object.keys(WIDE_OG_VERSIONS))("%s.jpg: gifts beside the arch only if it is Her, Him or Kids", async (key) => {
    const tint = tintOf(key);
    expect(Object.keys(FAMILY)).toContain(tint);
    const off = await offGingham(key, tint);
    if (COVERS.includes(key)) expect(off, `${key}: its cover's cutouts beside the arch`).toBeGreaterThan(10_000);
    else expect(off, `${key}: gingham and arch only, no picture`).toBe(0);
  });
});
