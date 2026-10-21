/**
 * Audit #51 (2026-10-21): the block sheet's only commit read "Just Block" (no
 * alternative); its cancellation paragraph was all red; its reason label was
 * uppercase. Now: "Block" when it is the only commit ("Just block" beside
 * "Block and report"), plain text with only the money amount in rust, and a
 * sentence-case label.
 *
 * @mutate src/components/BlockUserDialog.tsx |                 "Block"\n |                 "Just Block"\n
 * @mutate src/components/BlockUserDialog.tsx | <li className="not-italic font-sans font-medium text-foreground"> | <li className="not-italic font-sans font-medium" style={{ color: "hsl(var(--burnt-sienna))" }}>
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(join(resolve(__dirname, "..", ".."), "src/components/BlockUserDialog.tsx"), "utf8"));

describe("the block sheet speaks plainly", () => {
  it("no 'Just Block' as the lone commit, sentence case throughout", () => {
    expect(src).not.toMatch(/"Just Block"|"Block and Report"/);
    expect(src).toMatch(/"Block"\n/);
  });
  it("only the money is rust", () => {
    expect(src).not.toMatch(/<li[^>]*burnt-sienna/);
    expect(src).toMatch(/sienna-ink\)\)" \}\}>\$\{formatPriceExact\(estimatedFee\)\}/);
  });
  it("the reason label is not uppercase", () => {
    expect(src).toContain("Reason (optional, only our team sees it)");
    expect(src).not.toMatch(/uppercase[^"]*">\s*Reason/);
  });
});
