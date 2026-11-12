/**
 * S2-012 (Shops audit 2, the rest): the item editor's two photo pickers are the shared HiddenFileInput (Q2709, no
 * hand-made sr-only inputs), their visible control is 44px (h-11, was h-9) with the peer focus ring, and the download
 * file picker shows keyboard focus too. (Labels and "Remove photo n" landed in 269e3eba5b.)
 *
 * @mutate src/components/shops/ShopDigitalFiles.tsx |           <HiddenFileInput\n            peer\n |           <HiddenFileInput\n
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The editor's two photo pickers live in its split-out parts (train 1112-j): Start with photos and the item's own photos.
const EDITOR = ["src/components/shops/ShopItemEditor.tsx", "src/components/shops/ShopItemStartPhotos.tsx", "src/components/shops/ShopItemPhotosSection.tsx"]
  .map((f) => readFileSync(f, "utf8")).join("\n");
const FILES = readFileSync("src/components/shops/ShopDigitalFiles.tsx", "utf8");
const tags = (s: string) => s.split("<HiddenFileInput").slice(1).map((t) => t.slice(0, t.indexOf("/>")));

describe("S2-012 Shops pickers", () => {
  it("the item editor's photo pickers are the shared input, 44px, with a focus ring", () => {
    expect(EDITOR).not.toMatch(/type="file"/);
    const t = tags(EDITOR);
    expect(t).toHaveLength(2);
    for (const x of t) {
      expect(x).toMatch(/\speer\s/);
      expect(x).toMatch(/accept="image\/\*"/);
    }
    const controls = EDITOR.match(/<span className=\{?[`"]inline-flex h-\d+[^>]*peer-focus-visible:ring-2/g) ?? [];
    expect(controls).toHaveLength(2);
    for (const c of controls) expect(c).toContain("h-11");
  });
  it("the download file picker shows keyboard focus", () => {
    const t = tags(FILES);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatch(/\speer\s/);
    expect(FILES).toMatch(/<span className="inline-flex h-11 [^"]*peer-focus-visible:ring-2 peer-focus-visible:ring-ring"/);
  });
});
