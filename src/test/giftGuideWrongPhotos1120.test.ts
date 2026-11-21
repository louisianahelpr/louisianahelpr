/**
 * No gift guide shows a photo of the wrong product (photo review 11-20: a brand logo, a butter dish for a Dutch oven,
 * a The North Face fleece for a Columbia one). scripts/giftGuidePhotoFixes1120.mjs lists each wrong photo with the
 * right one from the maker's page, or "" to drop it; the picks generator applies it, so no generated guide carries one.
 *
 * @mutate scripts/giftGuidePhotoFixes1120.mjs |   return fix === undefined ? image : fix || undefined; |   return image;
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WRONG_PHOTOS_1120, droppedPhoto, rightPhoto } from "../../scripts/giftGuidePhotoFixes1120.mjs";

const DIR = join(__dirname, "..", "content", "giftGuidePicks");
type Pick = { name: string; image?: string };
const guides = readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => ({ slug: f.replace(".json", ""), picks: (JSON.parse(readFileSync(join(DIR, f), "utf8")).picks ?? []) as Pick[] }));

describe("gift guide wrong photos (photo review 11-20)", () => {
  it("swaps a wrong photo for the right one, drops one with no replacement, and leaves every other photo alone", () => {
    const [[logo, shot]] = [...WRONG_PHOTOS_1120].filter(([, to]) => to);
    expect(rightPhoto(logo)).toBe(shot);
    expect(rightPhoto(`${logo}?v=3&width=600`)).toBe(shot);
    const [[wrong]] = [...WRONG_PHOTOS_1120].filter(([, to]) => !to);
    expect(rightPhoto(wrong)).toBeUndefined();
    expect(droppedPhoto(`${wrong}?x=1`)).toBe(true);
    expect(droppedPhoto(logo)).toBe(false);
    expect(rightPhoto("https://shop.example/mug.jpg")).toBe("https://shop.example/mug.jpg");
    expect(rightPhoto(undefined)).toBeUndefined();
  });

  it("every replacement is an https photo that is not itself a wrong photo, and never an Amazon one", () => {
    expect(WRONG_PHOTOS_1120.size).toBeGreaterThan(10);
    for (const [from, to] of WRONG_PHOTOS_1120) {
      expect(from, from).toMatch(/^https:\/\/[^?]+$/);
      if (!to) continue;
      expect(to, from).toMatch(/^https:\/\//);
      expect(WRONG_PHOTOS_1120.has(to.split("?")[0]), from).toBe(false);
      expect(new URL(to).hostname, from).not.toMatch(/amazon/);
    }
  });

  it("no generated guide shows one of the wrong photos", () => {
    expect(guides.length).toBeGreaterThan(34);
    const shown = guides.flatMap((g) => g.picks.filter((p) => p.image && WRONG_PHOTOS_1120.has(p.image.split("?")[0])).map((p) => `${g.slug}: ${p.name}`));
    expect(shown).toEqual([]);
  });
});
