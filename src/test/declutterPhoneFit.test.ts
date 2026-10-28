/**
 * Declutter on a phone (lead walkthrough 2026-10-28):
 *   - shot 33: at 500x700 the dock's + sat on the item title, because the square photo alone was 460px tall. The item
 *     photo is capped at about half the screen below sm (DeclutterGallery's ASPECT.item), so the price and title
 *     start above the dock.
 *   - the filter sheet's chips (and Wanted's "Within", which now wears them) were h-10, 40px: under the 44px tap floor.
 * Read from the source (jsdom lays nothing out); the screenshots under ~/.lh-shots/declutter-audit-1028/phone-after
 * are the look.
 *
 * @mutate src/components/declutter/DeclutterGallery.tsx | aspect-square max-h-[52dvh] sm:max-h-none | aspect-square
 * @mutate src/components/declutter/DeclutterFilterPanel.tsx | const CHIP = "flex h-11 min-h-11 items-center | const CHIP = "flex h-10 items-center
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("Declutter fits a phone", () => {
  it("the item photo is square on a phone but never taller than about half the screen", () => {
    const m = read("src/components/declutter/DeclutterGallery.tsx").match(/item:\s*"([^"]+)"/);
    expect(m, "ASPECT.item not found").not.toBeNull();
    const cls = m![1].split(/\s+/);
    expect(cls).toContain("aspect-square");
    const cap = cls.find((c) => /^max-h-\[(\d+)dvh\]$/.test(c));
    expect(cap, "no max-h-[Ndvh] on the phone photo").toBeDefined();
    expect(Number(/\d+/.exec(cap!)![0])).toBeLessThanOrEqual(60);
  });

  it("Declutter's choice chips are at least 44px tall (h-11)", () => {
    const m = read("src/components/declutter/DeclutterFilterPanel.tsx").match(/const CHIP = "([^"]+)"/);
    expect(m, "CHIP not found").not.toBeNull();
    const cls = m![1].split(/\s+/);
    expect(cls).toContain("min-h-11");
    expect(cls.filter((c) => /^h-(\d+)$/.test(c)).map((c) => Number(c.slice(2))).every((n) => n >= 11)).toBe(true);
  });
});
