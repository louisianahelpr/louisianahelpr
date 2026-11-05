/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): the item page's "N more from {seller}" row
 * (scrolls to the seller's other items) is the shared ListRow (src/components/ui/ListRow.tsx: the 44px floor, the
 * sanctioned ctl-tint hover, the app's focus ring with its offset), never a hand-made <button>. It keeps its own look:
 * a dashed 20px-radius card, 48px floor, px-4 py-3, icon + text from the left (justify-start over ListRow's
 * justify-between). The hand-made ratchet lost the file's entry in the same commit.
 *
 * @mutate src/components/declutter/DeclutterBundleRow.tsx |     <ListRow\n      data-bundle-row="" |     <button type="button"\n      data-bundle-row=""
 * @mutate src/components/declutter/DeclutterBundleRow.tsx | className="min-h-[48px] justify-start gap-3 | className="min-h-[48px] gap-3
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(__dirname, "..", "..", "src/components/declutter/DeclutterBundleRow.tsx"), "utf8"));

describe("the item page's bundle row is the shared ListRow (Q2709)", () => {
  it("is a ListRow that keeps its dashed card look and reads from the left", () => {
    // The open tag ends on its own line ("\n    >"): its onClick arrow has a ">" of its own.
    const rows = [...src.matchAll(/<ListRow\b[\s\S]*?\n\s*>/g)].map((m) => m[0]);
    expect(rows.length).toBeGreaterThan(0);
    const row = rows.find((t) => t.includes('data-bundle-row=""'));
    expect(row, "the bundle row is not a ListRow").toBeDefined();
    for (const c of ["justify-start", "rounded-[20px]", "border-dashed", "min-h-[48px]"]) expect(row!, c).toContain(c);
    expect(src).not.toMatch(/<button\b/);
  });
});
