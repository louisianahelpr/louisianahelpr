/**
 * Declutter on a phone (lead walkthrough 2026-10-28):
 *   - shot 33: at 500x700 the dock's + sat on the item title, because the square photo alone was 460px tall. The item
 *     photo is capped at about half the screen below sm (DeclutterGallery's ASPECT.item), so the price and title
 *     start above the dock.
 *   - the filter sheet's chips (and Wanted's "Within", which now wears them) were h-10, 40px: under the 44px tap floor.
 * Read from the source (jsdom lays nothing out); the screenshots under ~/.lh-shots/declutter-audit-1028/phone-after
 * are the look.
 *
 * @mutate src/components/declutter/itemPhotoFrame.ts | aspect-square max-h-[52dvh] sm:max-h-none | aspect-square
 * Since Q2709 (11-04) the chips are the shared ToggleChip (src/components/ui/ToggleChip.tsx), so these read it.
 * @mutate src/components/ui/ToggleChip.tsx | "flex min-h-11 shrink-0 items-center | "flex h-10 shrink-0 items-center
 * @mutate src/components/ui/ToggleChip.tsx | : "border border-foreground/25 bg-background text-foreground", | : "border border-border bg-card text-foreground",
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("Declutter fits a phone", () => {
  it("the item photo is square on a phone but never taller than about half the screen", () => {
    const m = read("src/components/declutter/itemPhotoFrame.ts").match(/item:\s*"([^"]+)"/);
    expect(m, "ASPECT.item not found").not.toBeNull();
    const cls = m![1].split(/\s+/);
    expect(cls).toContain("aspect-square");
    const cap = cls.find((c) => /^max-h-\[(\d+)dvh\]$/.test(c));
    expect(cap, "no max-h-[Ndvh] on the phone photo").toBeDefined();
    expect(Number(/\d+/.exec(cap!)![0])).toBeLessThanOrEqual(60);
  });

  it("an unselected chip shows on a card in dark mode: the page fill and a firm edge, never card-on-card", () => {
    // Lead 2026-10-28: on Wanted's card, bg-card + border-border made "5 mi / 25 mi / 50 mi" plain floating words in dark.
    expect(read("src/components/declutter/DeclutterFilterPanel.tsx")).toMatch(/<ToggleChip\b/);
    const m = read("src/components/ui/ToggleChip.tsx").match(/pressed \? "[^"]*" : "([^"]*)"/);
    expect(m, "the unselected chip class was not found").not.toBeNull();
    const cls = m![1].split(/\s+/);
    expect(cls).toContain("bg-background");
    expect(cls).not.toContain("bg-card");
    const edge = cls.find((c) => /^border-foreground\/(\d+)$/.test(c));
    expect(edge, "no border-foreground/N edge").toBeDefined();
    expect(Number(edge!.split("/")[1])).toBeGreaterThanOrEqual(20);
  });

  it("Declutter's choice chips are at least 44px tall (h-11)", () => {
    expect(read("src/components/declutter/DeclutterFilterPanel.tsx")).toMatch(/<ToggleChip\b/);
    const m = read("src/components/ui/ToggleChip.tsx").match(/cn\(\s*"([^"]+)"/);
    expect(m, "ToggleChip's base class not found").not.toBeNull();
    const cls = m![1].split(/\s+/);
    expect(cls).toContain("min-h-11");
    expect(cls.filter((c) => /^h-(\d+)$/.test(c)).map((c) => Number(c.slice(2))).every((n) => n >= 11)).toBe(true);
  });
});
