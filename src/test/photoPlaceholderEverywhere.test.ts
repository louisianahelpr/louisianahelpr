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
 * @mutate src/components/declutter/MovingSaleBanner.tsx | ) : (\n                  <PhotoPlaceholder icon={categoryIcon(it.category)} seed={it.category} className="h-full w-full" /> | ) : (\n                  null
 * DA-15: a photo shown only when there is one, in a tile with no placeholder under it, is the same blank box.
 * @mutate src/components/declutter/DeclutterMap.tsx |                 <PhotoPlaceholder icon={categoryIcon(selected.item.category)} seed={selected.item.category} className="absolute inset-0 h-full w-full" iconClassName="h-6 w-6" /> | <span />
 * @mutate src/components/declutter/DeclutterManageListing.tsx |         <PhotoPlaceholder icon={categoryIcon(item.category)} seed={item.category} className="absolute inset-0 h-full w-full" iconClassName="h-6 w-6" /> | <span />
 * @mutate src/components/shops/ShopBrowseCard.tsx | <PhotoPlaceholder icon={shopGroupIcon(group)} seed={group} className="h-full w-full" /> | <span />
 * @mutate src/components/rentals/listings/RentBrowse.tsx | <PhotoPlaceholder icon={Home} seed={kind} className="h-full w-full" /> | <Home className="h-8 w-8" />
 * @mutate src/lib/declutter/categoryIcons.ts | { key: "books_media", label: "Books and media", icon: BookOpen, | { key: "books_media", label: "Books and media", icon: undefined as never,
 * @mutate src/lib/shops/categoryIcons.ts |   pets: PawPrint, |   petz: PawPrint,
 */
import { readFileSync } from "node:fs";
import { readdirSync, trackedFiles } from "./helpers/trackedFiles";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { CATEGORY_LABEL } from "@/components/declutter/declutterUi";
import { CATEGORY_ICON } from "@/lib/declutter/categoryIcons";
import { SHOP_GROUP_ICON } from "@/lib/shops/categoryIcons";
import { placeholderTone, PHOTO_PLACEHOLDER_TONES } from "@/components/ui/PhotoPlaceholder";

const ROOT = process.cwd();
const DIRS = ["src/components/declutter", "src/components/shops", "src/components/rentals"];

// Tracked files only (noSrcDirectoryWalksInTests): never a raw directory walk of src/.
const FILES = DIRS.flatMap((d) => trackedFiles(d)).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f)).map((f) => join(ROOT, f));
const read = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

/** The Browse cards (and the moving-sale cards) that must wear the shared placeholder. */
const CARD_FILES = [
  "src/components/declutter/DeclutterItemCard.tsx",
  "src/components/declutter/MovingSaleBanner.tsx",
  "src/components/shops/ShopBrowseCard.tsx",
  "src/components/rentals/listings/RentBrowse.tsx",
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

  it("DA-15: `photo && <FallbackImg/>` always has the placeholder under it", () => {
    let seen = 0;
    const blank: string[] = [];
    for (const f of FILES) {
      const src = blankComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/&&\s*\(?\s*<FallbackImg\b/g)) {
        seen++;
        if (!/<PhotoPlaceholder\b/.test(src.slice(Math.max(0, m.index - 300), m.index))) blank.push(`${relative(ROOT, f)}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    // Not an item's tile (each names why); two-way.
    const notATile: Record<string, string> = {
      "src/components/declutter/DeclutterWantedReplies.tsx": "a Wanted post's own photo: with none, no tile is drawn at all",
      "src/components/declutter/DeclutterWantedViews.tsx": "a line of text for a seller's reply: with no photo, no tile is drawn at all",
      "src/components/declutter/DeclutterBunchPhotos.tsx": "a photo the seller just took, on this device, while its blob loads; every tile has a photo",
      "src/components/declutter/DeclutterBunchRow.tsx": "an item being sorted always has a photo; only its local blob can be loading",
      "src/components/declutter/DeclutterBunchIntake.tsx": "a photo the seller just picked, while its small copy is made; every tile has a photo",
      "src/components/declutter/SellerDeliveryOrder.tsx": "the delivery proof photo while its link loads; a failed read says so in words",
    };
    expect(seen).toBeGreaterThan(2);
    expect(blank.filter((b) => !(b.split(":")[0] in notATile)), "this tile is blank when there is no photo; put PhotoPlaceholder under it").toEqual([]);
    expect(Object.keys(notATile).filter((f) => !blank.some((b) => b.startsWith(`${f}:`)))).toEqual([]);
  });

  it("every Browse card renders the shared PhotoPlaceholder", () => {
    for (const f of CARD_FILES) expect(read(f), f).toMatch(/<PhotoPlaceholder\b[^>]*\bicon=\{[^}]+\}[^>]*\bseed=/);
  });

  it("every Declutter category and every shop group has its own icon", () => {
    expect(Object.keys(CATEGORY_LABEL).length).toBeGreaterThan(10);
    expect(Object.keys(CATEGORY_LABEL).filter((k) => !CATEGORY_ICON[k])).toEqual([]);
    // The shop groups as the migrations leave them: the newest file that
    // restates the whole list, plus any later file that upserts single rows
    // (e.g. 20261019210636's one category; the newest alone is not the list).
    const groups = new Set<string>();
    for (const sql of readdirSync(join(ROOT, "supabase/migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort()
      .map((n) => blankSqlComments(readFileSync(join(ROOT, "supabase/migrations", n), "utf8")))) {
      // A file that restates the whole list (and deletes the rest) starts over.
      if (/DELETE FROM public\.shop_categories WHERE slug <> ALL/.test(sql)) groups.clear();
      for (const part of sql.split("INSERT INTO public.shop_categories").slice(1)) {
        for (const m of part.matchAll(/\(\s*'[a-z_]+',\s*'([a-z_]+)',\s*'[^']+',/g)) groups.add(m[1]);
      }
    }
    expect(groups.size).toBeGreaterThan(8);
    expect([...groups].filter((g) => !SHOP_GROUP_ICON[g])).toEqual([]);
  });

  it("one category always gets the same tint, and the tints are spread", () => {
    expect(placeholderTone("furniture")).toBe(placeholderTone("furniture"));
    const used = new Set(Object.keys(CATEGORY_LABEL).map(placeholderTone));
    expect(used.size).toBe(PHOTO_PLACEHOLDER_TONES);
  });
});
