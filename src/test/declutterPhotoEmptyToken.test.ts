/**
 * Spec v2 §2 --photo-empty (Builder 1 request, 2026-10-20): an empty or
 * loading Declutter photo paints warm sand (#DCD5C7 light, #3A3731 dark),
 * never the cool grey of bg-muted. The token is declared in both themes,
 * exposed to Tailwind, and every Declutter photo frame (an <img> or an
 * aspect-ratio photo box, incl. skeletons) wears it.
 * @mutate src/index.css |   --photo-empty: 40 23% 82%; |   --photo-empty: 220 13% 91%;
 * @mutate src/components/declutter/DeclutterItemCard.tsx | overflow-hidden rounded-2xl bg-photo-empty"> | overflow-hidden rounded-2xl bg-muted">
 * @mutate src/components/declutter/DeclutterGallery.tsx | overflow-hidden rounded-2xl bg-photo-empty"; | overflow-hidden rounded-2xl";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { blankComments, blankCssComments } from "./helpers/blankNonCode";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("Declutter photos paint --photo-empty, never cool grey", () => {
  it("the token is declared in light and dark with the spec's values, and Tailwind exposes it", () => {
    const css = blankCssComments(read("src/index.css"));
    expect(css).toMatch(/--photo-empty:\s*40 23% 82%;/);
    const dark = css.slice(css.indexOf('[data-theme="dark"] {'));
    expect(dark).toMatch(/--photo-empty:\s*40 8% 21%;/);
    expect(read("tailwind.config.ts")).toMatch(/"photo-empty": "hsl\(var\(--photo-empty\)\)"/);
  });

  it("every Declutter photo frame (an <img>, or an aspect-ratio photo box) wears bg-photo-empty", () => {
    const dir = "src/components/declutter";
    const frames: string[] = [];
    for (const f of readdirSync(join(ROOT, dir)).filter((n) => n.endsWith(".tsx") && !n.includes(".test."))) {
      const src = blankComments(read(`${dir}/${f}`));
      // The class string of every <img ...> and every className / FRAME holding an aspect ratio.
      for (const m of src.matchAll(/<img[\s\S]*?\/>/g)) frames.push(`${f}: ${m[0]}`);
      for (const m of src.matchAll(/"[^"\n]*\baspect-(?:square|\[[^\]]+\])[^"\n]*"/g)) frames.push(`${f}: ${m[0]}`);
    }
    // Inventory floor: card, gallery, sell tiles x2, preview, skeletons, moving sale, delivery photo.
    expect(frames.length).toBeGreaterThan(8);
    // The dashed "Add photos" tile is a button, not a photo.
    const photoFrames = frames.filter((s) => !/border-dashed/.test(s));
    const ownFrame = (s: string) => /bg-photo-empty/.test(s) || /\bFRAME\b|h-full w-full object-cover|w-full h-full object-cover/.test(s);
    expect(photoFrames.filter((s) => /\bbg-muted\b/.test(s))).toEqual([]);
    expect(photoFrames.filter((s) => !ownFrame(s))).toEqual([]);
  });
});
