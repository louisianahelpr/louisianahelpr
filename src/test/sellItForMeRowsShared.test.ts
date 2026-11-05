/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): Sell it for me's two "who helps" rows (the
 * Sell page's entry row and the sheet's "Hire a local Helpr") are the shared ListRow (src/components/ui/ListRow.tsx:
 * the 44px floor, the ctl-tint hover, the app's focus ring), never hand-made <button>s. They keep their card look
 * (ROW: rounded-2xl, border, bg-card, px-4 py-3) and the age gate's props. The hand-made ratchet lost the file's entry
 * (2 buttons) in the same commit.
 *
 * @mutate src/components/declutter/SellItForMe.tsx | <ListRow className={ROW} onClick={tap} | <button type="button" className={ROW} onClick={tap}
 * @mutate src/components/declutter/SellItForMe.tsx | <ListRow className={ROW} onClick={hireHelpr} data-testid="sell-for-me-hire-helpr" {...gatedProps("post")}> | <ListRow className={ROW} onClick={hireHelpr} data-testid="sell-for-me-hire-helpr">
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(__dirname, "..", "..", "src/components/declutter/SellItForMe.tsx"), "utf8"));

describe("Sell it for me's rows are the shared ListRow (Q2709)", () => {
  it("both rows are ListRows in the card look, keeping the age gate", () => {
    const rows = [...src.matchAll(/<ListRow\b[^\n]*>/g)].map((m) => m[0]);
    expect(rows.length).toBeGreaterThan(1);
    const entry = rows.find((t) => t.includes('data-testid="sell-it-for-me-entry"'));
    const hire = rows.find((t) => t.includes('data-testid="sell-for-me-hire-helpr"'));
    expect(entry, "the entry row is not a ListRow").toBeDefined();
    expect(hire, "the hire row is not a ListRow").toBeDefined();
    expect(entry!).toContain('gatedProps("post")');
    expect(hire!).toContain('{...gatedProps("post")}');
    expect(src).toContain('const ROW = "gap-3 rounded-2xl border border-border bg-card px-4 py-3";');
    expect(src).not.toMatch(/<button\b/);
  });
});
