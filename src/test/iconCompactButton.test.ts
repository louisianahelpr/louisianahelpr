/**
 * The shared compact icon Button: a 40px visual circle inside a 44px tap area (lead decision 10-31, B41 handoff item
 * 5; B44). The hit area is padded, not the visual: the box stays 44 (the app's tap floor) and a 2px transparent
 * border holds the fill, and an inset ring, to the 40px padding box.
 *
 * Measured at 1440 (headless Chromium, mocked session) on Jobs Browse's toolbar: Search, Filters and the map toggle
 * render 44x44 at x 1228 / 1276 / 1324 before and after; clientWidth 40, border 2px, background-clip padding-box after.
 * Before, the map toggle was a hand-made <button> with a 14px radius beside two pills.
 *
 * Class half, from source: no Button in the Browse toolbar folder is size="icon" (56px) or hand-sizes h-/w-, and the
 * three toolbar icon files (map toggle, Filters square, Search/Filters/Saved actions) have no hand-made <button>.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buttonVariants } from "@/components/ui/button";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

// @mutate src/components/ui/button.tsx |         iconCompact: "h-11 w-11 border-2 border-transparent bg-clip-padding [&_svg]:size-5", |         iconCompact: "h-10 w-10 [&_svg]:size-5",
// @mutate src/components/dashboard/browseTasksToolbar/MapToggleButton.tsx |       size="iconCompact" |       size="icon"
// @mutate src/components/dashboard/browseTasksToolbar/FiltersIconButton.tsx |       className={`relative shrink-0 btn-press | className={`relative h-10 w-10 shrink-0 btn-press

const REPO = resolve(__dirname, "../..");
const code = (f: string) => blankComments(readFileSync(resolve(REPO, f), "utf8"));

describe("the compact icon Button", () => {
  it("is a 44px box whose fill sits in a 40px padding box", () => {
    const cls = buttonVariants({ variant: "ghost", size: "iconCompact" }).split(/\s+/);
    for (const c of ["h-11", "w-11", "border-2", "border-transparent", "bg-clip-padding", "rounded-full"]) expect(cls).toContain(c);
  });

  it("every icon control in the Browse toolbar is the shared Button at iconCompact", () => {
    const files = trackedFiles("src/components/dashboard/browseTasksToolbar").filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"));
    expect(files.length).toBeGreaterThan(3);
    const named = ["MapToggleButton.tsx", "FiltersIconButton.tsx", "BrowseTasksActions.tsx"];
    for (const n of named) expect(files.some((f) => f.endsWith(`/${n}`)), n).toBe(true);
    const offenders: string[] = [];
    for (const f of files) {
      const src = code(f);
      // The toolbar's icon squares; BrowseSearchBar's raw buttons are a text "Clear", combobox options and the in-field ✕.
      if (named.some((n) => f.endsWith(`/${n}`)) && /<button\b/.test(src)) offenders.push(`${f}: hand-made <button>`);
      for (const m of src.matchAll(/<Button\b[\s\S]*?>/g)) {
        const tag = m[0];
        if (/size="icon"/.test(tag)) offenders.push(`${f}: size="icon" (56px) in the toolbar`);
        if (/className=\{?[`"'][^`"']*\b(?:h|w)-(?:\d|\[)/.test(tag)) offenders.push(`${f}: hand-set h-/w- on a Button`);
      }
    }
    expect(offenders).toEqual([]);
    const compact = files.flatMap((f) => [...code(f).matchAll(/size="iconCompact"/g)]).length;
    expect(compact).toBeGreaterThan(3);
  });
});
