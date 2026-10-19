/// <reference types="node" />
/**
 * No form uses a raw <optgroup> category <select> any more: a long grouped list
 * goes through the shared TwoStepCategoryPicker (owner, 2026-10-19: the Shops
 * "Choose a category" dropdown showed ~40 options at once).
 *
 * @mutate src/components/shops/ShopEditView.tsx | <TwoStepCategoryPicker | <select><optgroup label="x"></optgroup></select><TwoStepCategoryPicker
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

describe("grouped category selects", () => {
  const files = trackedFiles("src").filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f));
  it("scans a real inventory", () => {
    expect(files.length).toBeGreaterThan(100);
  });
  it("no .tsx uses <optgroup>", () => {
    const bad = files.filter((f) => /<optgroup\b/.test(blankComments(readFileSync(f, "utf8"))));
    expect(bad).toEqual([]);
  });
  it("Shops category uses the shared picker", () => {
    const src = blankComments(readFileSync("src/components/shops/ShopEditView.tsx", "utf8"));
    expect(src).toContain("<TwoStepCategoryPicker");
  });
});
