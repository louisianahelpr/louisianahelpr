/**
 * Q2391: the + Create sheet, the Customize sections sheet and the section filter sheet took no focus when they
 * opened (each cancelled Radix's opening focus and focused nothing), so a keyboard or screen-reader member stayed on
 * the page behind them. ui-sweep's overlay sweep measured it as `focus-not-moved-into-overlay (trigger: Create)` on
 * every signed-in route and `(trigger: Customize)` on /browse and /home. They now go through focusSheetItself, the
 * Declutter sheets' helper (its focus-in and focus-back behaviour is rendered in declutterSheetsTakeFocus.test.tsx).
 * Inventory: no sheet under src/components/create or src/components/sections cancels the opening focus and focuses
 * nothing.
 *
 * @mutate src/components/create/CreateSheet.tsx | onOpenAutoFocus={focusSheetItself} | onOpenAutoFocus={(e) => e.preventDefault()}
 * @mutate src/components/sections/CustomizeSheet.tsx | onOpenAutoFocus={focusSheetItself} | onOpenAutoFocus={(e) => e.preventDefault()}
 * @mutate src/components/sections/ChoiceFilterRow.tsx | onOpenAutoFocus={focusSheetItself} | onOpenAutoFocus={(e) => e.preventDefault()}
 * @mutate src/components/create/CreateSheet.tsx | onOpenAutoFocus={focusSheetItself} | onOpenAutoFocus={(event) => { event.preventDefault(); }}
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

// A handler that only cancels the focus: `(e) => e.preventDefault()` or `(e) => { e.preventDefault(); }`.
const CANCEL_ONLY = /onOpenAutoFocus=\{\s*\(?\s*(\w+)\s*\)?\s*=>\s*(?:\{\s*\1\.preventDefault\(\)\s*;?\s*\}|\1\.preventDefault\(\))\s*\}/;

describe("nav sheets take focus when they open (Q2391)", () => {
  it("no Create / sections sheet cancels the opening focus and leaves it behind", () => {
    const files = [...trackedFiles("src/components/create"), ...trackedFiles("src/components/sections")]
      .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    const bad = files.filter((f) => CANCEL_ONLY.test(blankComments(readFileSync(f, "utf8"))));
    expect(bad).toEqual([]);
  });

  it("the three sheets the overlay sweep named hand focus to the sheet itself", () => {
    for (const f of [
      "src/components/create/CreateSheet.tsx",
      "src/components/sections/CustomizeSheet.tsx",
      "src/components/sections/ChoiceFilterRow.tsx",
    ]) {
      const src = blankComments(readFileSync(f, "utf8"));
      expect(src, f).toMatch(/onOpenAutoFocus=\{focusSheetItself\}/);
      expect(src, f).toMatch(/import \{ focusSheetItself \} from "@\/components\/declutter\/focusSheetItself";/);
    }
  });
});
