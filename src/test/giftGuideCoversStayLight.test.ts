/**
 * The gift guide covers stay light (owner rule: nothing slow for users; photo covers 11-18): every cover in
 * public/gift-guides/covers is a 480x480 WebP of at most 20 KB, so swapping the gingham covers for the six-photo ones
 * (scripts/gift-guide-photo-covers.py) cannot make the landing's lazy tile rows heavier per tile than the budget.
 *
 * @mutate scripts/gift-guide-photo-covers.py | im.resize((480, 480), Image.LANCZOS) | im
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "public/gift-guides/covers";
const MAX_BYTES = 20 * 1024;

/** A WebP's width and height from its first chunk (VP8, VP8L or VP8X). */
function webpSize(b: Buffer): { w: number; h: number } | null {
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const kind = b.toString("ascii", 12, 16);
  if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (kind === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X") return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  return null;
}

describe("gift guide covers stay light", () => {
  it("every cover is a 480x480 WebP of at most 20 KB", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".webp"));
    expect(files.length).toBeGreaterThan(300);
    for (const f of files) {
      const b = readFileSync(`${DIR}/${f}`);
      expect(b.length, f).toBeLessThanOrEqual(MAX_BYTES);
      expect(webpSize(b), f).toEqual({ w: 480, h: 480 });
    }
  });
});
