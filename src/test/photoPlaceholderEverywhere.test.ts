/**
 * A card with no photo shows its category icon on a soft tint of our palette,
 * never a blank grey box (owner-approved card designs, 2026-10-19 14:55Z), and
 * it does so through ONE shared component, PhotoPlaceholder.
 *
 * Inventory: every .tsx under the three photo-first sections (Declutter, Shops,
 * Homes), outside tests. A conditional photo whose "no photo" branch is
 * `null` (the blank box the owner named) fails, wherever it sits. The Browse
 * card files must render PhotoPlaceholder. Every category a Declutter item or
 * a shop can have gets its own icon (no silent fallback for a known key).
 *
 * @mutate src/components/declutter/MovingSaleBanner.tsx | <PhotoPlaceholder icon={categoryIcon(it.category)} seed={it.category} className="h-full w-full" /> | null
 * @mutate src/lib/declutter/categoryIcons.ts |   books_media: BookOpen, |   books_mediaz: BookOpen,
 */
import { readFileSync } from "node:fs";
import { trackedFiles } from "./helpers/trackedFiles";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { CATEGORY_LABEL } from "@/components/declutter/declutterUi";
import { CATEGORY_ICON } from "@/lib/declutter/categoryIcons";
import { placeholderTone, PHOTO_PLACEHOLDER_TONES } from "@/components/ui/PhotoPlaceholder";

const ROOT = process.cwd();
const DIRS = ["src/components/declutter", "src/components/shops", "src/components/rentals"];

// Tracked files only (noSrcDirectoryWalksInTests): never a raw directory walk of src/.
const FILES = DIRS.flatMap((d) => trackedFiles(d)).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f)).map((f) => join(ROOT, f));
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

/** The Browse cards (and the moving-sale cards) that must wear the shared placeholder. */
const CARD_FILES = [
  "src/components/declutter/DeclutterHomeView.tsx",
  "src/components/declutter/MovingSaleBanner.tsx",
];

/**
 * Not a card, and not blank: each names why. Two-way (an entry that no longer
 * matches fails), so the list cannot go stale.
 */
// @two-way src/test/photoPlaceholderEverywhere.test.ts:every exemption still names a real null-fallback photo
const EXEMPT: Record<string, string> = {
  "src/components/shops/ShopProfile.tsx":
    "the shop PAGE hero, not a Browse card: with no cover it shows its own olive-to-rust gradient band under the logo (SH2), never a grey box",
};

describe("a photo-less card shows its category on a tint, never a blank box", () => {
  it("no conditional photo falls back to nothing in Declutter, Shops or Homes", () => {
    expect(FILES.length).toBeGreaterThan(60);
    const blank: string[] = [];
    for (const f of FILES) {
      const src = blankComments(readFileSync(f, "utf8"));
      // `photo ? <img ... /> : null` and the parenthesised form.
      const re = /\?\s*\(?\s*<img\b[^>]*\/>\s*\)?\s*:\s*null\b/g;
      for (const m of src.matchAll(re)) blank.push(`${relative(ROOT, f)}:${src.slice(0, m.index).split("\n").length}`);
    }
    const isExempt = (b: string) => b.split(":")[0] in EXEMPT;
    expect(blank.filter((b) => !isExempt(b)), "a card shows an empty box where its photo would be; use PhotoPlaceholder").toEqual([]);
    // Two-way: every exemption still names a real null-fallback photo.
    expect(Object.keys(EXEMPT).filter((f) => !blank.some((b) => b.startsWith(`${f}:`)))).toEqual([]);
  });

  it("every Browse card renders the shared PhotoPlaceholder", () => {
    for (const f of CARD_FILES) expect(read(f), f).toMatch(/<PhotoPlaceholder\b[^>]*\bicon=\{[^}]+\}[^>]*\bseed=/);
  });

  it("every Declutter category has its own icon", () => {
    expect(Object.keys(CATEGORY_LABEL).length).toBeGreaterThan(10);
    expect(Object.keys(CATEGORY_LABEL).filter((k) => !CATEGORY_ICON[k])).toEqual([]);
  });

  it("one category always gets the same tint, and the tints are spread", () => {
    expect(placeholderTone("furniture")).toBe(placeholderTone("furniture"));
    const used = new Set(Object.keys(CATEGORY_LABEL).map(placeholderTone));
    expect(used.size).toBe(PHOTO_PLACEHOLDER_TONES);
  });
});
