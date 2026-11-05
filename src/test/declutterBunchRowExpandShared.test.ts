/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): a bunch row's open/close row (thumbnail,
 * name, category line, chevron; DeclutterBunchRow) is the shared ListRow (src/components/ui/ListRow: rounded-xl, the
 * sanctioned ctl-tint hover, the app's offset focus ring), never a hand-made <button>. It keeps its own layout: the
 * 56px floor, no padding of its own (the row card brings it), and it fills the space beside the price box (flex-1).
 * The hand-made ratchet lost the file's entry in the same commit.
 *
 * @mutate src/components/declutter/DeclutterBunchRow.tsx | <ListRow aria-expanded={open} | <button type="button" aria-expanded={open}
 * @mutate src/components/declutter/DeclutterBunchRow.tsx | className="min-h-14 min-w-0 flex-1 p-0" | className="min-h-14 min-w-0 flex-1"
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(__dirname, "..", "..", "src/components/declutter/DeclutterBunchRow.tsx"), "utf8"));

describe("a bunch row's open/close row is the shared ListRow (Q2709)", () => {
  it("is a ListRow with the 56px floor, no padding of its own, filling the row", () => {
    const row = src.match(/<ListRow\b[^\n]*data-bunch-expand=""\n[^\n]*/);
    expect(row, "the bunch row's expand row is not a ListRow").not.toBeNull();
    for (const c of ["min-h-14", "flex-1", "p-0", "aria-expanded={open}"]) expect(row![0], c).toContain(c);
    expect(src).not.toMatch(/<button\b/);
  });
});
