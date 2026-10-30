/*
 * GUARD (owner 2026-10-30, via the lead): "MORE CATEGORIES. The owner listed a dog bed and had to pick 'Other'." The
 * app's one category list (src/lib/declutter/categoryIcons.ts CATEGORIES) and the listing helper's list
 * (supabase/functions/declutter-ai-draft/sanitize.ts DECLUTTER_CATEGORIES, the tool schema's enum) must name the
 * same keys in the same order, or the helper picks a category the app has no name or icon for (or never picks a new
 * one). Every category has a name, an icon and exactly one heading; "Other" is last; the owner's list is all there;
 * the helper's prompt carries the rule that sends a dog bed to Pets and a cast net to Hunting and fishing.
 */
// @mutate supabase/functions/declutter-ai-draft/sanitize.ts | "pets", "office_school", | "office_school",
// @mutate src/lib/declutter/categoryIcons.ts | { key: "pets", label: "Pets", icon: PawPrint, group: "Family" },\n | \n
// @mutate supabase/functions/declutter-ai-draft/index.ts | ${CATEGORY_RULE}\n${PRICE_RULE} | ${PRICE_RULE}
// @mutate src/components/declutter/DeclutterFilterPanel.tsx | {CATEGORY_GROUPS.map((g) => ( | {[{ heading: "All", values: Object.keys(CATEGORY_LABEL) }].map((g) => (
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { CATEGORIES, CATEGORY_GROUPS, CATEGORY_ICON, CATEGORY_LABEL } from "@/lib/declutter/categoryIcons";
import { DECLUTTER_CATEGORIES } from "../../supabase/functions/declutter-ai-draft/sanitize";

const OWNER_ADDED = [
  "Pets", "Bedding and bath", "Office and school", "Crafts and hobbies", "Holiday and seasonal", "Hunting and fishing", "Boats and marine",
  "Camping", "Bikes", "Auto parts and accessories", "Musical instruments", "Health and beauty", "Jewelry and accessories",
  "Collectibles and antiques", "Exercise and fitness", "Tailgating and game day", "Party and events", "Storage and organization",
  "Moving boxes and supplies",
];
const ORIGINAL_13 = ["furniture", "appliances", "electronics", "kitchen", "home_decor", "tools", "outdoor_garden", "sports_outdoors", "toys_games", "baby_kids", "clothing", "books_media", "other"];

describe("Declutter's one category list", () => {
  it("the app and the listing helper name the same categories, in the same order", () => {
    expect(CATEGORIES.length).toBeGreaterThan(30);
    expect([...DECLUTTER_CATEGORIES]).toEqual(CATEGORIES.map((c) => c.key));
  });

  it("keeps the original 13, adds every category the owner listed, and ends with Other", () => {
    for (const k of ORIGINAL_13) expect(CATEGORY_LABEL[k], k).toBeTruthy();
    const labels = Object.values(CATEGORY_LABEL);
    for (const l of OWNER_ADDED) expect(labels, l).toContain(l);
    expect(Object.keys(CATEGORY_LABEL).at(-1)).toBe("other");
    for (const c of CATEGORIES) expect(c.key).toMatch(/^[a-z][a-z0-9_]{1,39}$/); // declutter_items_category_check
  });

  it("every category has an icon and sits under exactly one heading", () => {
    for (const c of CATEGORIES) expect(CATEGORY_ICON[c.key], c.key).toBeTruthy();
    const placed = CATEGORY_GROUPS.flatMap((g) => g.values);
    expect([...placed].sort()).toEqual(CATEGORIES.map((c) => c.key).sort());
    expect(new Set(placed).size).toBe(placed.length);
    expect(CATEGORY_GROUPS.every((g) => g.values.length > 0)).toBe(true);
  });

  it("the listing helper is told to pick the specific category (a dog bed is pets, a cast net is hunting_fishing)", () => {
    const src = blankComments(readFileSync("supabase/functions/declutter-ai-draft/index.ts", "utf8"));
    const rule = /const CATEGORY_RULE = `([^`]*)`/.exec(src)?.[1] ?? "";
    expect(rule).toMatch(/dog bed[^;]*is pets/);
    expect(rule).toMatch(/cast net[^;]*is hunting_fishing/);
    // In the one-item prompt and the room prompt.
    expect(src.match(/\$\{CATEGORY_RULE\}/g)?.length ?? 0).toBeGreaterThan(1);
  });

  it("the Browse filter and the Sell pickers show the categories under their headings", () => {
    const filter = blankComments(readFileSync("src/components/declutter/DeclutterFilterPanel.tsx", "utf8"));
    expect(filter).toMatch(/\{CATEGORY_GROUPS\.map\(\(g\) => \(/);
    for (const f of ["src/components/declutter/SellSummaryCard.tsx", "src/components/declutter/DeclutterSellView.tsx", "src/components/declutter/DeclutterEditListing.tsx"]) {
      expect(blankComments(readFileSync(f, "utf8")), f).toMatch(/groups=\{CATEGORY_GROUPS\}/);
    }
  });
});
