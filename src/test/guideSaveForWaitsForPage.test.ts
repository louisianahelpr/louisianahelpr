import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

/**
 * Guide speed 1124 (speed-1122n S1/S8). The save-for-someone picker loaded at a guide page's first render, and its
 * chunk's preload list (~150 KB: the dialog, the planner store, signed-in-deep) shared the phone's link with the
 * guide's own picks chunk: her.json took 2.2-2.4 s to arrive instead of 0.8 s and the list drew at 7.0 s (cwv-lab,
 * local build, Slow 4G + 4x, 375, guest). It now starts once the page has settled (whenPageSettled); after the change
 * the list drew at 5.8 s on the same profile (~/.lh-shots/guide-speed-1124/after5.txt).
 *
 * @mutate src/pages/info/GiftGuides.tsx | const stop = whenPageSettled(() => { | const stop = ((f: () => void) => (f(), () => {}))(() => {
 */
describe("the save-for-someone picker loads after the guide page, not beside its picks", () => {
  it("LazySaveForSomeone starts its chunk only inside whenPageSettled, and stops waiting on unmount", () => {
    const page = blankComments(readFileSync(resolve(__dirname, "../pages/info/GiftGuides.tsx"), "utf8"));
    const fn = /function LazySaveForSomeone\b[\s\S]*?\n}\n/.exec(page)?.[0] ?? "";
    expect(fn.length).toBeGreaterThan(100);
    expect(fn).toMatch(/const stop = whenPageSettled\(\(\) => \{\s*void loadSaveFor\(\)/);
    // The only call of loadSaveFor in the component is that one.
    expect(fn.match(/loadSaveFor\(\)/g)?.length).toBe(1);
    expect(fn).toMatch(/return \(\) => \{[\s\S]*?stop\(\);/);
    expect(page).toMatch(/import \{ whenPageSettled \} from "@\/lib\/pageSettled";/);
  });
});
