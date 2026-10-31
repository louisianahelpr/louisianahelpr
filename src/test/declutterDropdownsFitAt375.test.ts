/**
 * B30 (2026-10-31, LEAD-OFFERS-CHOICE screenshots at 375): in Declutter settings > Listing defaults, the "make it free after"
 * dropdown read "Never make it fr" and the Bundle discount one would cut "Buy 2+, 20% off": both were capped at 55% of
 * their row. Measured 2026-10-31 in a real 375 px page (~/.lh-shots/b30/shots.mjs, the select's width with no cap):
 *   - make it free after: 189 px in a 301 px row (62.8%);
 *   - Bundle discount: 163 px in a 277 px row (58.8%).
 * The cap is now 65%, so both fit; the rows stay one row (LEAD-FREE-AFTER-DROPDOWN keeps label left, dropdown right).
 */
// @mutate src/components/declutter/AutoFreeRow.tsx | className="h-11 w-auto max-w-[65%] shrink-0 | className="h-11 w-auto max-w-[55%] shrink-0
// @mutate src/components/declutter/BundleDiscountCard.tsx | className="h-11 w-auto max-w-[65%] shrink-0 | className="h-11 w-auto max-w-[55%] shrink-0
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const REPO = join(__dirname, "..", "..");
// The widest option's share of its row at 375, measured; the cap must be at least this.
const NEEDS: Record<string, number> = {
  "src/components/declutter/AutoFreeRow.tsx": 62.8,
  "src/components/declutter/BundleDiscountCard.tsx": 58.8,
};

describe("Declutter settings dropdowns fit at 375", () => {
  it("each one-row dropdown's width cap leaves room for its longest option", () => {
    let checked = 0;
    for (const [file, need] of Object.entries(NEEDS)) {
      const src = blankComments(readFileSync(join(REPO, file), "utf8"));
      const select = src.slice(src.indexOf("<select"), src.indexOf("</select>"));
      expect(select.length, `${file}: no <select>`).toBeGreaterThan(0);
      const cap = /\bmax-w-\[(\d+)%\]/.exec(select);
      expect(cap, `${file}: the select's width cap`).not.toBeNull();
      expect(Number(cap![1]), `${file}: cap ${cap![1]}% < ${need}% measured`).toBeGreaterThanOrEqual(need);
      checked++;
    }
    expect(checked).toBeGreaterThan(1);
  });
});
