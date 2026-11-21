/**
 * Gift guide photos have no background (owner 11-20: "None of the images should have a background"). A photo the
 * 11-20 photo review marked busy-background is shown as a transparent cutout from public/gift-guides/cutouts
 * (scripts/giftGuideCutouts1120.mjs); the picks generator applies the swap, so no generated guide still shows the
 * busy original. Amazon photos are never cut out (Associates rules).
 *
 * @mutate scripts/giftGuideCutouts1120.mjs |   return file ? CUTOUT_BASE + file : image; |   return image;
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CUTOUTS_1120, CUTOUT_BASE, cutoutPhoto } from "../../scripts/giftGuideCutouts1120.mjs";

const ROOT = join(__dirname, "..", "..");
const DIR = join(ROOT, "src", "content", "giftGuidePicks");
type Pick = { name: string; image?: string };
const guides = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => ({ slug: f.replace(".json", ""), picks: (JSON.parse(readFileSync(join(DIR, f), "utf8")).picks ?? []) as Pick[] }));

describe("gift guide photo cutouts (photo review 11-20)", () => {
  it("shows the cutout for a listed photo, with or without a query string, and leaves every other photo alone", () => {
    const [[from, file]] = [...CUTOUTS_1120];
    expect(cutoutPhoto(from)).toBe(CUTOUT_BASE + file);
    expect(cutoutPhoto(`${from}?width=600`)).toBe(CUTOUT_BASE + file);
    expect(cutoutPhoto("https://shop.example/mug.jpg")).toBe("https://shop.example/mug.jpg");
    expect(cutoutPhoto(undefined)).toBeUndefined();
  });

  it("every cutout is a transparent WebP in public/gift-guides/cutouts, and none is cut from an Amazon photo", () => {
    expect(CUTOUTS_1120.size).toBeGreaterThan(0);
    for (const [from, file] of CUTOUTS_1120) {
      expect(from, from).toMatch(/^https:\/\/[^?]+$/);
      expect(new URL(from).hostname, from).not.toMatch(/amazon/);
      expect(file, from).toMatch(/^[a-z0-9-]+\.webp$/);
      const path = join(ROOT, "public", "gift-guides", "cutouts", file);
      expect(existsSync(path), file).toBe(true);
      // A WebP with an alpha channel: the VP8X header's alpha flag (0x10), or a lossless (VP8L) file.
      const head = readFileSync(path).subarray(0, 32);
      const chunk = head.subarray(12, 16).toString("latin1");
      expect(chunk === "VP8L" || (chunk === "VP8X" && (head[20] & 0x10) !== 0), `${file} has no alpha channel`).toBe(true);
    }
  });

  it("no generated guide still shows a photo that has a cutout", () => {
    expect(guides.length).toBeGreaterThan(40);
    const shown = guides.flatMap((g) => g.picks.filter((p) => p.image && CUTOUTS_1120.has(p.image.split("?")[0])).map((p) => `${g.slug}: ${p.name}`));
    expect(shown).toEqual([]);
    const used = new Set(guides.flatMap((g) => g.picks.map((p) => p.image)).filter((i) => i?.startsWith(CUTOUT_BASE)));
    expect(used.size).toBeGreaterThan(0);
  });
});
