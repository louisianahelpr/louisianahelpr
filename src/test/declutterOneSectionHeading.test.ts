/**
 * CLASS GUARD (owner 2026-10-28, "calmer screens": "consistent heading sizes"): a Declutter section heading is ONE
 * size, SectionHeading's `text-base font-semibold` (16px, semibold). The audit found "Haul it away" and "Donation
 * receipts" at text-ds-17 font-bold beside every other section's 16px semibold.
 *
 * Inventory from source: every <h2 className="..."> in a non-test .tsx under src/components/declutter. Exact
 * exceptions, each a page-level title rather than a section (listed with why): the item page's title under its
 * price, Wanted's form title, the sell flow's step title, the moving-sale banner's sale name, and the Selling
 * tab's small "Selling now" row label (the last three are the sell-flow builder's).
 *
 * @mutate src/components/declutter/DeclutterHaulAway.tsx | <h2 id="haul-away-title" className="text-base font-semibold"> | <h2 id="haul-away-title" className="text-ds-17 font-bold">
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const files = walkSource([join(ROOT, "src/components/declutter")], [".tsx"]).filter((f) => !/\.test\.tsx$/.test(f));
const SECTION = "text-base font-semibold";

/** Page-level titles, not sections: file -> how many such h2 it may hold. */
const TITLES: Record<string, number> = {
  "src/components/declutter/DeclutterItemView.tsx": 1,
  "src/components/declutter/DeclutterSellSteps.tsx": 1,
  // The one-screen listing (2026-10-29) carries the sell flow's titles: same page-title style as the old steps.
  "src/components/declutter/SellOneScreen.tsx": 1,
  "src/components/declutter/SellSummaryCard.tsx": 1,
  "src/components/declutter/MovingSaleBanner.tsx": 1,
  "src/components/declutter/SellingNowRow.tsx": 1,
  // The profile eyebrow beside Selling now (#61, 2026-10-28): same style as SellingNowRow.
  "src/components/declutter/DeclutterProfileSection.tsx": 1,
};

describe("Declutter section headings are one size", () => {
  it("every Declutter h2 is SectionHeading's size, but the listed page titles", () => {
    const other: Record<string, number> = {};
    let sections = 0;
    // Floor (vacuity, nightly-red #2894): 82 Declutter .tsx files on 2026-10-29.
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) {
      for (const m of blankComments(readFileSync(f, "utf8")).matchAll(/<h2\b[^>]*\bclassName="([^"]*)"/g)) {
        const cls = m[1].trim();
        if (cls === SECTION || cls.startsWith(`${SECTION} `)) { sections++; continue; }
        const key = relative(ROOT, f);
        other[key] = (other[key] ?? 0) + 1;
      }
    }
    expect(sections).toBeGreaterThan(15);
    expect(other).toEqual(TITLES);
  });
});
