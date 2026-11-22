/**
 * CLASS GUARD (deep audit 11-22 #41): a sheet or dialog footer never replaces the shared footer row with a grid.
 *
 * SheetFooter / DialogFooter / AlertDialogFooter use POPUP_FOOTER_ROW (flex, wrap-reverse) and the commit takes
 * POPUP_COMMIT_CLS (basis half, grow, min-w-max), so a label wider than its half wraps onto its own row. The Offer a
 * trade sheet passed `grid grid-cols-2`: two fixed 164px cells at 375, and "Send trade offer" (181px, min-w-max) ran
 * flush to the screen edge while Cancel kept its margin. Any `grid` on a footer does the same to its longest label.
 *
 * Inventory from source: every non-test .tsx under src/ (comments blanked), each <SheetFooter|DialogFooter|
 * AlertDialogFooter ...> opening tag's className.
 */
// @mutate src/components/declutter/DeclutterOfferTrade.tsx | <SheetFooter className="sticky bottom-0 -mx-4 -mb-4 border-t | <SheetFooter className="sticky bottom-0 -mx-4 -mb-4 grid grid-cols-2 border-t
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

const FOOTER_TAG = /<(SheetFooter|DialogFooter|AlertDialogFooter)\b([^>]*)>/g;

describe("popup footers keep the shared wrapping row (deep audit 11-22 #41)", () => {
  const files = walkSource(["src"], [".tsx"]).filter((f) => !/\.test\.tsx$/.test(f));
  const footers: { file: string; tag: string }[] = [];
  for (const file of files) {
    const src = readSource(file);
    if (!src) continue;
    for (const m of blankComments(src).matchAll(FOOTER_TAG)) footers.push({ file, tag: m[0] });
  }

  it("finds the footers it checks", () => {
    expect(footers.length).toBeGreaterThan(20);
    expect(footers.some((f) => f.file.endsWith("DeclutterOfferTrade.tsx"))).toBe(true);
  });

  it("no footer turns the row into a grid", () => {
    const offenders = footers
      .filter(({ tag }) => /className=/.test(tag) && /(^|[\s"'`])(sm:|md:|lg:)?(grid|grid-cols-\d+)(?=[\s"'`])/.test(tag))
      .map(({ file, tag }) => `${file}: ${tag.slice(0, 140)}`);
    expect(offenders).toEqual([]);
  });
});
