/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): the Money screens' last hand-made
 * <button>s are the shared ones (src/components/ui), each keeping its size:
 * - Earnings: the "More insights" disclosure row (a CollapsibleTrigger asChild) and the "Advanced analytics" door
 *   -> ListRow in their rounded-2xl liquid-glass look, px-4 py-3 (their 0.99 press-scale goes for the shared tint).
 * - Payout history: a payout's open row -> flush ListRow (the card clips it; py-3), and a payout line's link to the
 *   job or order it paid -> InlineTextButton (still truncates, still carries its full text as a title).
 * Both files' hand-made button counts fell to 0 in the same commit (docs/audit/hand-made-controls-baseline.json).
 *
 * @mutate src/components/profile/EarningsTab.tsx | <ListRow className="group rounded-2xl liquid-glass gap-3 px-4 py-3"> | <ListRow className="group gap-3">
 * @mutate src/pages/profile/PayoutHistory.tsx | <ListRow\n        variant="flush"\n        onClick={onOpen} | <ListRow\n        onClick={onOpen}
 * @mutate src/pages/profile/PayoutHistory.tsx | <InlineTextButton className="text-left min-w-0 truncate" style={ink} title={l.label} | <InlineTextButton className="text-left min-w-0 truncate" style={ink}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (f: string) => blankComments(readFileSync(resolve(__dirname, "..", "..", f), "utf8"));

describe("Money rows and links are the shared controls (Q2709)", () => {
  it("Earnings: More insights and Advanced analytics are ListRows in their glass look", () => {
    const src = read("src/components/profile/EarningsTab.tsx");
    expect(src).toMatch(/<CollapsibleTrigger asChild>\s*<ListRow className="group rounded-2xl liquid-glass gap-3 px-4 py-3">/);
    expect(src).toMatch(/\(<ListRow\s+onClick=\{\(\) => navigate\("\/profile\?tab=analytics"\)\}\s+className="rounded-2xl liquid-glass gap-3 px-4 py-3"/);
    expect(src).not.toMatch(/<button\b/);
  });

  it("Payout history: the payout row is a flush ListRow and a line's link an InlineTextButton with its title", () => {
    const src = read("src/pages/profile/PayoutHistory.tsx");
    expect(src).toMatch(/<ListRow\s+variant="flush"\s+onClick=\{onOpen\}\s+data-payout-row=\{p\.id\}\s+className="py-3"/);
    expect(src).toMatch(/<InlineTextButton className="text-left min-w-0 truncate" style=\{ink\} title=\{l\.label\} onClick=\{\(\) => navigate\(l\.href!\)\}>/);
    expect(src).not.toMatch(/<button\b/);
  });
});
