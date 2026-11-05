// @mutate scripts/perf/bootReach.mjs | hooks[\\/](useWheelStep\|useSpendableGiftCards))\.ts$/; | hooks[\\/]useWheelStep)\.ts$/;
/**
 * Lead 2026-11-05 (lander measured #4124): /declutter?tab=selling grew 532 -> 555 KB gz in bundle-size.yml's env
 * when the Declutter gift picker (Q2106 S5) shipped. Cause, measured on built dist/ chunk closures: the checkout
 * (DeclutterTradeViews) imports useSpendableGiftCards, which bootReach puts in signed-in-pages, so Selling's first
 * screen fetched that whole chunk and signed-in-dock (20.6 + 4.6 KB gz) for one small hook. vite.config.ts pins it
 * into declutter-item-pages by path (ITEM_PAGES_PINNED_RE), the chunk Selling already fetches, the way
 * useWheelStep and orderTalk were pinned (L46). Real-env build, critical-path.mjs KB gz: selling main 546 ->
 * picker 572 -> pinned 547 (the picker's own code); Post a job and the gift page closures unchanged (405.8/405.9,
 * 310.9/310.5). The budget check is criticalPathBudget / bundle-size.yml; this pins the cause.
 */
import { describe, expect, it } from "vitest";
import { ITEM_PAGES_PINNED_RE } from "../../scripts/perf/bootReach.mjs";

describe("the gift hook rides with Selling's trade chunk, not signed-in-pages", () => {
  it("is pinned into declutter-item-pages", () => {
    expect(ITEM_PAGES_PINNED_RE.test("/repo/src/hooks/useSpendableGiftCards.ts")).toBe(true);
    expect(ITEM_PAGES_PINNED_RE.test("C:\\repo\\src\\hooks\\useSpendableGiftCards.ts")).toBe(true);
  });

  it("and the pin stays narrow (the older pins hold, nothing else rides)", () => {
    for (const f of ["src/hooks/useWheelStep.ts", "src/lib/declutter/orderTalk.ts", "src/components/declutter/useMarkTalkRead.ts"]) {
      expect(ITEM_PAGES_PINNED_RE.test(`/repo/${f}`), f).toBe(true);
    }
    for (const f of ["src/hooks/useSpendableGiftCardsX.ts", "src/hooks/useCurrentUser.ts", "src/pages/GiftCard.tsx"]) {
      expect(ITEM_PAGES_PINNED_RE.test(`/repo/${f}`), f).toBe(false);
    }
  });
});
