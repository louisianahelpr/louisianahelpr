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
 * @mutate src/components/messages/HiddenUnreadBar.tsx |       <ListRow\n        onClick={onShowAll} |       <button type="button"\n        onClick={onShowAll}
 * @mutate src/components/messages/HiddenUnreadBar.tsx | w-auto justify-start gap-2 | w-auto gap-2
 *   4. The FLUSH variant (2026-11-04 night, lead's call): a row inside an existing grouped list (Declutter's Manage
 *      listing card). No radius, no offset, inset ring, the list's 60px floor + px-4 py-3.5, the same tint. Every row
 *      in that list wears LIST_ROW_FLUSH (its 6 action rows as flush ListRows, the Preview Link, the switch rows and
 *      the child rows handed rowClassName), so the list has ONE look and no hand-made <button> row is left.
 * @mutate src/components/ui/ListRow.tsx | variant === "flush" ? `${LIST_ROW_FLUSH} ${LIST_ROW_TINT}` : CARD | variant === "flush" ? `${LIST_ROW_FLUSH} rounded-xl` : CARD
 * @mutate src/components/ui/ListRow.tsx | text-left min-h-[60px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset | text-left min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
 * @mutate src/components/declutter/DeclutterManageListing.tsx | const ROW = LIST_ROW_FLUSH; | const ROW = "flex w-full items-center gap-3 px-4 py-3 text-left";
 * @mutate src/components/declutter/DeclutterManageListing.tsx | <ListRow variant="flush" onClick={() => setView("sold")} | <ListRow onClick={() => setView("sold")}
 * @mutate src/components/declutter/DeclutterManageListing.tsx | className={`${LIST_ROW_FLUSH} ${LIST_ROW_TINT}`} data-manage-preview="" | className="flex w-full px-4 py-3" data-manage-preview=""
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

  it("the inbox's hidden-unread bar shows all through a ListRow, its words on the left", async () => {
    const { HiddenUnreadBar } = await import("@/components/messages/HiddenUnreadBar");
    const src = read("src/components/messages/HiddenUnreadBar.tsx");
    expect(src).toMatch(/<ListRow\b[^>]*onClick=\{onShowAll\}/);
    expect(src).not.toMatch(/<button\b/);
    render(<HiddenUnreadBar count={2} onShowAll={() => {}} onDismiss={() => {}} />);
    const row = screen.getByRole("button", { name: /2 unread conversations/ });
    const cls = row.className.split(/\s+/);
    expect(cls).toContain("ctl-tint");
    expect(cls).toContain("justify-start"); // the dot and the words stay together on the left, never pushed apart
    expect(cls).not.toContain("justify-between");
  });

  it("the flush variant: no radius, no offset, an inset ring, the grouped list's 60px floor, the same tint", () => {
    render(<ListRow variant="flush" trailing={<span data-testid="mark">›</span>}>Flush</ListRow>);
    const row = screen.getByRole("button", { name: /Flush/ });
    expect(row.getAttribute("type")).toBe("button");
    const cls = row.className.split(/\s+/);
    for (const c of ["min-h-[60px]", "w-full", "px-4", "py-3.5", "ctl-tint", "focus-visible:ring-2", "focus-visible:ring-inset", "text-left"]) expect(cls).toContain(c);
    for (const c of ["rounded-xl", "ring-offset-background", "focus-visible:ring-offset-2", "min-h-11"]) expect(cls, `flush row wears ${c}`).not.toContain(c);
    expect(cls.some((c) => /^hover:/.test(c)), "a hand hover on the shared row").toBe(false);
    expect(row.lastElementChild).toBe(screen.getByTestId("mark"));
  });

  it("Declutter's Manage listing list is ONE look: flush ListRows and LIST_ROW_FLUSH siblings, no hand-made row", () => {
    const src = read("src/components/declutter/DeclutterManageListing.tsx");
    const flushRows = src.match(/<ListRow\s+variant="flush"/g) ?? [];
    expect(flushRows.length).toBeGreaterThan(5); // Edit, Price, Relist, Pause, Sold, Delete
    expect(src.match(/<ListRow\b/g)?.length, "every ListRow in the list is flush").toBe(flushRows.length);
    expect(src).toMatch(/const ROW = LIST_ROW_FLUSH;/);
    expect(src).toMatch(/className=\{`\$\{LIST_ROW_FLUSH\} \$\{LIST_ROW_TINT\}`\} data-manage-preview=""/);
    expect(src.match(/rowClassName=\{ROW\}/g)?.length ?? 0).toBeGreaterThan(4); // offers, delivery, auto-free, ship, keep up
    expect(src, "a hand-made row button is back").not.toMatch(/<button\b[^>]*className=\{ROW\}/);
  });

  it("the FAQ row is a ListRow with no hand-written button", () => {
    const src = read("src/components/marketing/FaqRow.tsx");
    expect(src).toMatch(/<ListRow\b/);
    expect(src).not.toMatch(/<button\b/);
    expect(src).not.toMatch(/hover:opacity/);
  });
});
