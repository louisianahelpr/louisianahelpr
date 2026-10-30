/**
 * CLASS GUARD (lead walkthrough 2026-10-28, shots 11 and 21): Declutter names each category ONE way. Browse's filter
 * sheet said "Decor", "Garden", "Toys", "Baby", "Books" while Sell and Wanted said "Home decor", "Outdoor and
 * garden", "Toys and games", ... because two maps existed (CATEGORY_WORD and CATEGORY_LABEL).
 *
 * Inventory from source: every non-test .ts/.tsx under src/ and supabase/functions/, comments blanked. A file
 * DEFINES a Declutter category-name map when it gives a Declutter-only category key ("home_decor",
 * "outdoor_garden", "books_media") a string. Exactly one file may: src/lib/declutter/categoryIcons.ts.
 *
 * @mutate src/components/declutter/declutterUi.tsx | export { CATEGORY_GROUPS, CATEGORY_LABEL } from "@/lib/declutter/categoryIcons"; | export { CATEGORY_GROUPS } from "@/lib/declutter/categoryIcons"; export const CATEGORY_LABEL: Record<string, string> = { home_decor: "Decor" };
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";
import { CATEGORY_LABEL } from "@/lib/declutter/categoryIcons";
import { CATEGORY_LABEL as UI_LABEL } from "@/components/declutter/declutterUi";

const ROOT = resolve(__dirname, "../..");
const files = walkSource([join(ROOT, "src"), join(ROOT, "supabase/functions")]).filter((f) => !/\.test\.tsx?$|\/src\/test\//.test(f));
// Either shape: a map entry (home_decor: "...") or a list entry ({ key: "home_decor", label: "..." }, owner 2026-10-30).
const DEFINES = /\b(home_decor|outdoor_garden|books_media)\s*:\s*["'`]|\bkey:\s*["'](home_decor|outdoor_garden|books_media)["']\s*,\s*label:/;

describe("Declutter has one category-name map", () => {
  it("reads a real source tree", () => {
    expect(files.length).toBeGreaterThan(800);
  });

  it("only src/lib/declutter/categoryIcons.ts gives a Declutter category a name", () => {
    const definers = files.filter((f) => DEFINES.test(blankComments(readFileSync(f, "utf8")))).map((f) => relative(ROOT, f));
    expect(definers).toEqual(["src/lib/declutter/categoryIcons.ts"]);
  });

  it("the screens' CATEGORY_LABEL is that one map, with the full names Sell and Wanted use", () => {
    expect(UI_LABEL).toBe(CATEGORY_LABEL);
    expect(Object.keys(CATEGORY_LABEL).length).toBeGreaterThan(10);
    expect(CATEGORY_LABEL.home_decor).toBe("Home decor");
    expect(CATEGORY_LABEL.outdoor_garden).toBe("Outdoor and garden");
  });
});
