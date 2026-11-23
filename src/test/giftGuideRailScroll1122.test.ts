/**
 * Owner 2026-11-22 7:44 PM (desktop, Holiday Hub): "when i put my mouse over the left panel i should be able to scroll
 * up and down if needed but it doesnt".
 *
 * Measured on www (cc62e6bca8, 1470x946, headless Chromium): the sticky guides menu (.gg-side) is 815px tall and starts
 * at y=419, so its bottom (1234) sits below the window. It is an overflow-y:auto box that does not overflow (874px cap),
 * and overscroll-behavior:contain stopped the wheel from passing to the page: wheel 600px over the menu left scrollY 0
 * and the menu's scrollTop 0. Without contain, the wheel scrolls the menu when it overflows and the page otherwise.
 *
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | max-height:calc(100dvh - var(--gg-side-top,72px));overflow-y:auto} | max-height:calc(100dvh - var(--gg-side-top,72px));overflow-y:auto;overscroll-behavior:contain}
 * @mutate src/pages/info/giftGuides/giftGuidesStyles.ts | align-self:start;max-height:calc(100dvh - var(--gg-side-top,72px));overflow-y:auto} | align-self:start;max-height:calc(100dvh - var(--gg-side-top,72px));overflow-y:hidden}
 */
import { describe, expect, it } from "vitest";
import { GIFT_GUIDES_CSS } from "@/pages/info/giftGuides/giftGuidesStyles";

const sideRules = () => [...GIFT_GUIDES_CSS.matchAll(/(?:^|[}\s])\.gg-side\{([^}]*)\}/g)].map((m) => m[1]);

describe("owner 11-22: the desktop guides menu scrolls under the mouse", () => {
  it("the sticky menu scrolls itself when it overflows (overflow-y:auto under a viewport cap)", () => {
    const sticky = sideRules().find((r) => r.includes("position:sticky"));
    expect(sticky).toBeDefined();
    expect(sticky).toContain("max-height:calc(100dvh - var(--gg-side-top,72px))");
    expect(sticky).toContain("overflow-y:auto");
  });

  it("no .gg-side rule traps the wheel: it passes to the page when the menu has nothing left to scroll", () => {
    expect(sideRules().length).toBeGreaterThan(0);
    for (const r of sideRules()) expect(r).not.toMatch(/overscroll-behavior\s*:\s*(contain|none)/);
  });
});
