/**
 * Q2558: the four /shops/* loading placeholders reserve what the 2026-11-02
 * 01:07Z loading-states refresh measured (bot PR #3963, 375, both test
 * accounts; src/test/loadingStateShape.test.ts refused all four):
 *   /shops/orders    two 144px order bones (300px) -> the 98px "No orders yet." card
 *   /shops/dashboard two 144px order bones (300px) -> the 154px "no shop yet" card
 *   /shops/mine      224px of bones -> the 1472px "Open a shop" form
 *   /shops/test      296px of bones -> 345px (the unavailable card)
 * loadingStateShape reads a measurement only a browser run can make, so until
 * the next refresh this pins each placeholder to those numbers in source.
 * jsdom has no layout; the heights are Tailwind arbitrary values read from the
 * code (comments blanked).
 */
// @mutate src/components/shops/ShopMyOrdersView.tsx | <li><Skeleton className="h-[98px] w-full rounded-2xl" /></li> | {[0, 1].map((i) => <li key={i}><Skeleton className="h-36 w-full rounded-2xl" /></li>)}
// @mutate src/components/shops/ShopDashboardView.tsx | <li><Skeleton className="h-[154px] w-full rounded-2xl" /></li> | {[0, 1].map((i) => <li key={i}><Skeleton className="h-36 w-full rounded-2xl" /></li>)}
// @mutate src/components/shops/ShopEditView.tsx | <div className="space-y-4 min-h-[1472px]" role="status" aria-label="Loading your shop"> | <div className="space-y-4" role="status" aria-label="Loading your shop">
// @mutate src/components/shops/ShopView.tsx | <Skeleton className="h-[145px] w-full rounded-2xl" /> | <Skeleton className="h-24 w-full rounded-2xl" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(resolve(process.cwd(), p), "utf8"));

/** The status block a skeleton renders, from its aria-label to the block's end. */
const statusBlock = (src: string, label: string): string => {
  const at = src.indexOf(`aria-label="${label}"`);
  expect(at, `no loading block labelled "${label}"`).toBeGreaterThan(0);
  const start = src.lastIndexOf("<", at);
  const tag = src.slice(start + 1, src.indexOf(" ", start)); // ul / div
  return src.slice(start, src.indexOf(`</${tag}>`, at));
};

/** Pixel heights of every bone and min-height in a block: h-36 = 144, h-[98px] = 98, min-h-[1472px] = 1472. */
const heights = (block: string) =>
  [...block.matchAll(/(?<![\w-])(min-h|h)-(\[(\d+)px\]|(\d+))(?![\w\]])/g)].map((m) => ({
    min: m[1] === "min-h",
    px: m[3] ? Number(m[3]) : Number(m[4]) * 4,
  }));

const CASES = [
  { file: "src/components/shops/ShopMyOrdersView.tsx", label: "Loading your orders", bones: [98] },
  { file: "src/components/shops/ShopDashboardView.tsx", label: "Loading your shop's orders", bones: [154] },
  { file: "src/components/shops/ShopView.tsx", label: "Loading the shop", bones: [144, 24, 145] },
] as const;

describe("Q2558: the /shops placeholders reserve the measured heights", () => {
  it("checks every case (never passes on an empty list)", () => {
    expect(CASES.length).toBeGreaterThan(2);
  });

  for (const c of CASES) {
    it(`${c.file}: bones ${c.bones.join(" + ")}px`, () => {
      const hs = heights(statusBlock(read(c.file), c.label)).filter((h) => !h.min).map((h) => h.px);
      expect(hs).toEqual([...c.bones]);
    });
  }

  it("ShopView's bones total 345px with the 16px gaps (the measured block)", () => {
    const hs = heights(statusBlock(read("src/components/shops/ShopView.tsx"), "Loading the shop")).map((h) => h.px);
    expect(hs.reduce((a, b) => a + b, 0) + 16 * (hs.length - 1)).toBe(345);
  });

  it("ShopEditView reserves the 1472px form", () => {
    const hs = heights(statusBlock(read("src/components/shops/ShopEditView.tsx"), "Loading your shop"));
    expect(hs.filter((h) => h.min).map((h) => h.px)).toEqual([1472]);
  });
});
