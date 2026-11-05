/**
 * CLASS GUARD (Q2709, 11-05; owner 10-31 "Nothing hand-made"): twelve underlined text actions that were hand-made
 * <button>s are the shared InlineTextButton (src/components/ui: text-sized, the shared 44px touch overlay, the link
 * focus ring), each keeping its own type and colour:
 * - Series: "End series" / "Leave series", "Give up N dates".
 * - A job's schedule change: "Suggest another time", the withdraw action, "Ask for a (new|different) date or time".
 * - Shops: the daily cap's and an order card's "Try again".
 * - Reviews: "Clear" (the filter), "Add response", "Edit response".
 * - Lease: a missing field's jump-to-step link. A job card's nudge-to-confirm link.
 * Each file's hand-made button count fell in the same commit (docs/audit/hand-made-controls-baseline.json).
 *
 * @mutate src/components/series/EndSeriesControl.tsx | {trigger && <InlineTextButton | {trigger && <button type="button"
 * @mutate src/components/series/SeriesDatesPanel.tsx | <InlineTextButton\n                disabled={busy || pickedMine.length === 0} | <button type="button"\n                disabled={busy || pickedMine.length === 0}
 * @mutate src/components/schedule/ScheduleChangeControl.tsx | <InlineTextButton\n          onClick={() => setAsking(true)} | <button type="button"\n          onClick={() => setAsking(true)}
 * @mutate src/components/shops/ShopDailyCap.tsx | <InlineTextButton className="underline" onClick={() => void cap.refetch()}> | <button type="button" className="underline" onClick={() => void cap.refetch()}>
 * @mutate src/components/shops/ShopOrderCard.tsx | <InlineTextButton className="underline" onClick={() => void q.refetch()}> | <button type="button" className="underline" onClick={() => void q.refetch()}>
 * @mutate src/pages/user/ReviewsSection.tsx | <InlineTextButton\n                onClick={() => {\n                  onSetReviewCategoryFilter(null); | <button\n                onClick={() => {\n                  onSetReviewCategoryFilter(null);
 * @mutate src/components/rentals/LeasePanel.tsx | <InlineTextButton className="underline" onClick={() => setStep( | <button type="button" className="underline" onClick={() => setStep(
 * @mutate src/components/job-card/NudgeConfirmLink.tsx | <InlineTextButton\n          disabled={busy} | <button type="button"\n          disabled={busy}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const REPO = resolve(__dirname, "..", "..");

/** [file, InlineTextButtons it must hold at least]; it may hold no underlined hand-made <button>. */
const CASES: [string, number][] = [
  ["src/components/series/EndSeriesControl.tsx", 1],
  ["src/components/series/SeriesDatesPanel.tsx", 1],
  ["src/components/schedule/ScheduleChangeControl.tsx", 3],
  ["src/components/shops/ShopDailyCap.tsx", 1],
  ["src/components/shops/ShopOrderCard.tsx", 1],
  ["src/pages/user/ReviewsSection.tsx", 3],
  ["src/components/rentals/LeasePanel.tsx", 1],
  ["src/components/job-card/NudgeConfirmLink.tsx", 1],
];

function scan(file: string) {
  const sf = ts.createSourceFile(file, readFileSync(resolve(REPO, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let inline = 0, underlinedButtons = 0;
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(sf);
      if (tag === "InlineTextButton") inline += 1;
      if (tag === "button" && /className="[^"]*\bunderline\b/.test(n.getText(sf))) underlinedButtons += 1;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { inline, underlinedButtons };
}

describe("underlined text actions are the shared InlineTextButton (Q2709)", () => {
  it("checks all eight files, twelve actions (an empty list would pass every case)", () => {
    expect(CASES.length).toBe(8);
    expect(CASES.reduce((a, [, n]) => a + n, 0)).toBe(12);
  });

  it.each(CASES)("%s", (file, n) => {
    const { inline, underlinedButtons } = scan(file);
    expect(inline).toBeGreaterThanOrEqual(n);
    expect(underlinedButtons).toBe(0);
  });
});
