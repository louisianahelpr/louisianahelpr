/**
 * CLASS GUARD (Q2709, 11-04; owner 10-31 "Nothing hand-made"): a full-width tappable list row is the shared ListRow
 * (src/components/ui/ListRow.tsx), built from the category picker's row tokens.
 *   1. One look: 44px floor, the sanctioned hover tint (ctl-tint), the app's focus ring with the page-coloured
 *      offset, a real type="button", label left and the trailing mark last.
 *   2. ListRow is a control to controlInteractionSameness (its CONTROL_TAG names it), so a hand-set hover fade on a
 *      ListRow is still caught there; the FAQ row's old `hover:opacity-80` ledger entry is gone with the move.
 *   3. The migrated rows wear it: FaqRow (Help Center) has no hand-written <button> left.
 * The hand-made-control ratchet (noNewHandMadeControls, docs/audit/hand-made-controls-baseline.json) counts what is
 * left: FaqRow's entry was removed in the same commit.
 *
 * @mutate src/components/ui/ListRow.tsx | rounded-xl px-3 py-2 text-left ctl-tint | rounded-xl px-3 py-2 text-left hover:opacity-80
 * @mutate src/components/ui/ListRow.tsx | "flex min-h-11 w-full | "flex w-full
 * @mutate src/components/ui/ListRow.tsx |     {children}\n    {trailing}\n |     {trailing}\n    {children}\n
 * @mutate src/test/controlInteractionSameness.test.ts | (button\|a\|Button\|ListRow\|Link | (button\|a\|Button\|Link
 * @mutate src/components/marketing/FaqRow.tsx |       <ListRow\n |       <button type="button"\n
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { ListRow } from "@/components/ui/ListRow";

const REPO = resolve(__dirname, "..", "..");
const read = (p: string) => blankComments(readFileSync(resolve(REPO, p), "utf8"));

describe("ListRow is the one tappable list row (Q2709)", () => {
  it("wears the shared row tokens: 44px, the sanctioned tint, the ring, a real button", () => {
    render(<ListRow trailing={<span data-testid="mark">›</span>}>Label</ListRow>);
    const row = screen.getByRole("button", { name: /Label/ });
    expect(row.getAttribute("type")).toBe("button");
    const cls = row.className.split(/\s+/);
    for (const c of ["min-h-11", "w-full", "ctl-tint", "focus-visible:ring-2", "ring-offset-background", "text-left"]) expect(cls).toContain(c);
    expect(cls.some((c) => /^hover:/.test(c)), "a hand hover on the shared row").toBe(false);
    expect(row.lastElementChild).toBe(screen.getByTestId("mark"));
    expect(row.firstChild?.textContent).toBe("Label");
  });

  it("controlInteractionSameness treats ListRow as a control", () => {
    const m = read("src/test/controlInteractionSameness.test.ts").match(/const CONTROL_TAG =\s*\/<\(([^)]+)\)/);
    expect(m, "CONTROL_TAG not found").not.toBeNull();
    expect(m![1].split("|")).toContain("ListRow");
  });

  it("the FAQ row is a ListRow with no hand-written button", () => {
    const src = read("src/components/marketing/FaqRow.tsx");
    expect(src).toMatch(/<ListRow\b/);
    expect(src).not.toMatch(/<button\b/);
    expect(src).not.toMatch(/hover:opacity/);
  });
});
