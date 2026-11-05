/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): the bunch photo sheet's "which item is
 * this photo?" pick row (thumbnail + name; DeclutterBunchPhotos ItemPicker) is the shared ListRow
 * (src/components/ui/ListRow: rounded-xl, the sanctioned ctl-tint hover, the app's offset focus ring), never a
 * hand-made <button>. It keeps its own card look: the 48px floor, the bordered card fill, p-1.5, gap-3, and the
 * thumbnail + name packed left (justify-start; ListRow's own justify-between would push the name right).
 * The file's hand-made button count fell 3 -> 2 in the same commit.
 *
 * @mutate src/components/declutter/DeclutterBunchPhotos.tsx | <ListRow aria-label={label(o.name)} | <button type="button" aria-label={label(o.name)}
 * @mutate src/components/declutter/DeclutterBunchPhotos.tsx | className="min-h-12 justify-start gap-3 border | className="min-h-12 gap-3 border
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(__dirname, "..", "..", "src/components/declutter/DeclutterBunchPhotos.tsx"), "utf8"));

describe("the bunch photo sheet's item pick row is the shared ListRow (Q2709)", () => {
  it("is a ListRow that keeps its card look and packs left", () => {
    const row = src.match(/<ListRow\b[^\n]*data-bunch-pick=\{o\.key\}\n[^\n]*/);
    expect(row, "the bunch pick row is not a ListRow").not.toBeNull();
    for (const c of ["min-h-12", "justify-start", "border border-border bg-card", "p-1.5"]) expect(row![0], c).toContain(c);
    // The photo tiles and their tick corners stay hand-made for now (a photo tile form is a later packet).
    expect(src.match(/<button\b/g)?.length ?? 0).toBeLessThan(3);
  });
});
