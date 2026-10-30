/**
 * A card or item photo asks the image edge for a small copy. A seller's photo is the full 1920 px upload: 1,355,122 bytes
 * measured on prod, 21,093 bytes at w=384 through /_vercel/image (2026-10-30). Served raw, it took /declutter's LCP on a
 * slow phone to 14.9 s.
 *
 * @mutate src/components/declutter/DeclutterItemCard.tsx | const small = buildImageUrl(original, { width: CARD_PHOTO_WIDTH }); | const small = original;
 * @mutate src/components/declutter/DeclutterGallery.tsx | src={buildImageUrl(url, { width: GALLERY_PHOTO_WIDTH })} | src={url}
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const code = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));

describe("listing photos on the first screens are small copies", () => {
  it("the Browse card and the item gallery ask for a sized copy, and keep the original to fall back on", () => {
    const card = code("src/components/declutter/DeclutterItemCard.tsx");
    expect(card).toContain("const small = buildImageUrl(original, { width: CARD_PHOTO_WIDTH });");
    expect(card).toContain('photoFails === 1 && small !== original ? original : null');
    const gallery = code("src/components/declutter/DeclutterGallery.tsx");
    expect(gallery).toContain("src={buildImageUrl(url, { width: GALLERY_PHOTO_WIDTH })}");
    expect(gallery).toMatch(/fallback=\{\s*<FallbackImg\s+src=\{url\}/);
    const raw = (src: string) => [...src.matchAll(/<img[^>]*src=\{photoPublicUrl\(/g)].length;
    expect(raw(card)).toBe(0);
  });
});
