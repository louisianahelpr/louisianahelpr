/**
 * CLASS GUARD (Q2709, 11-05; owner 10-31 "Nothing hand-made"): twelve underlined text actions that were hand-made
 * <button>s are the shared InlineTextButton (src/components/ui: text-sized, the shared 44px touch overlay, the link
 * focus ring), each keeping its own type and colour:
 * - Series: "End series" / "Leave series", "Give up N dates".
 * - A job's schedule change: "Suggest another time", the withdraw action, "Ask for a (new|different) date or time".
 * - Shops: the daily cap's and an order card's "Try again".
 * - Reviews: "Clear" (the filter), "Add response", "Edit response".
 * - Lease: a missing field's jump-to-step link. A job card's nudge-to-confirm link.
 * Second slice (same night): Job confirmation's "Cancel job", Photo proof's "View all", a failed message's
 * retry, the filter sheet's "set hours", a tenancy's end link (their hand-written hover:underline goes: the shared
 * link draws its own underline on hover).
 * Third slice (sensitive paths, code-reviewed): Admin's credential "Open", payouts' "Select All with Stripe" /
 * "Clear Selection", a report's two names, disputes' "Reset Filters", the security check's "Retry", the App Store
 * "Restore purchases", sign-up's "Resend", "Skip and create account" and "Have a referral code?".
 * Fourth slice: the "See all" heading actions (Activity's bucket groups, the status boxes' group head, Search's
 * groups), text-sized so their 28px heading rows stay 28px.
 * Each file's hand-made button count fell in the same commit (docs/audit/hand-made-controls-baseline.json).
 *
 * @mutate src/components/series/EndSeriesControl.tsx | {trigger && <InlineTextButton | {trigger && <button type="button"
 * @mutate src/components/series/SeriesDatesPanel.tsx | <InlineTextButton\n                disabled={busy \|\| pickedMine.length === 0} | <button type="button"\n                disabled={busy \|\| pickedMine.length === 0}
 * @mutate src/components/schedule/ScheduleChangeControl.tsx | <InlineTextButton\n          onClick={() => setAsking(true)} | <button type="button"\n          onClick={() => setAsking(true)}
 * @mutate src/components/shops/ShopDailyCap.tsx | <InlineTextButton className="underline" onClick={() => void cap.refetch()}> | <button type="button" className="underline" onClick={() => void cap.refetch()}>
 * @mutate src/components/shops/ShopOrderCard.tsx | pickup address.{" "}\n        <InlineTextButton className="underline" onClick={() => void q.refetch()}> | pickup address.{" "}\n        <button type="button" className="underline" onClick={() => void q.refetch()}>
 * @mutate src/components/shops/ShopOrderCard.tsx | work address.{" "}\n        <InlineTextButton className="underline" onClick={() => void q.refetch()}> | work address.{" "}\n        <button type="button" className="underline" onClick={() => void q.refetch()}>
 * @mutate src/pages/user/ReviewsSection.tsx | <InlineTextButton\n                onClick={() => {\n                  onSetReviewCategoryFilter(null); | <button\n                onClick={() => {\n                  onSetReviewCategoryFilter(null);
 * @mutate src/components/rentals/LeasePanel.tsx | <InlineTextButton className="underline" onClick={() => setStep( | <button type="button" className="underline" onClick={() => setStep(
 * @mutate src/components/job-card/NudgeConfirmLink.tsx | <InlineTextButton\n          disabled={busy} | <button type="button"\n          disabled={busy}
 * @mutate src/components/JobConfirmation.tsx | <InlineTextButton\n            onClick={() => { setShowConfirmDialog(false); onCantMakeIt(); }} | <button type="button"\n            onClick={() => { setShowConfirmDialog(false); onCantMakeIt(); }}
 * @mutate src/components/PhotoProof.tsx | <InlineTextButton onClick={() => setViewOpen(true)} | <button type="button" onClick={() => setViewOpen(true)}
 * @mutate src/components/messages/MessageBubble.tsx | <InlineTextButton\n            onClick={() => m.clientId && retryMessage(m.clientId)} | <button type="button"\n            onClick={() => m.clientId && retryMessage(m.clientId)}
 * @mutate src/components/dashboard/filterSheet/FilterSheetRows.tsx | <InlineTextButton\n              onClick={() => navigate("/profile?tab=availability")} | <button type="button"\n              onClick={() => navigate("/profile?tab=availability")}
 * @mutate src/components/rentals/EndTenancyButton.tsx | <InlineTextButton className="text-sm | <button className="underline text-sm
 * @mutate src/components/admin/AdminCredentialQueue.tsx | <InlineTextButton\n      onClick={open} | <button type="button"\n      onClick={open}
 * @mutate src/components/admin/AdminPayoutBatches.tsx | <InlineTextButton onClick={selectAllReady} | <button type="button" onClick={selectAllReady}
 * @mutate src/components/admin/AdminReports.tsx | <InlineTextButton\n                          onClick={() => navigate(memberProfilePath(String(report.reporter_id)))} | <button type="button"\n                          onClick={() => navigate(memberProfilePath(String(report.reporter_id)))}
 * @mutate src/components/admin/adminDisputes/DisputeFilters.tsx | <InlineTextButton onClick={p.clearFilters} | <button type="button" onClick={p.clearFilters}
 * @mutate src/components/auth/TurnstileField.tsx | <InlineTextButton\n              onClick={() => { | <button type="button"\n              onClick={() => {
 * @mutate src/components/profile/SubscriptionTab.tsx | <InlineTextButton\n            onClick={handleRestorePurchases} | <button type="button"\n            onClick={handleRestorePurchases}
 * @mutate src/pages/auth/SignupPending.tsx | <InlineTextButton\n                onClick={handleResend} | <button type="button"\n                onClick={handleResend}
 * @mutate src/components/sections/StatusBoxes.tsx | <InlineTextButton onClick={onSeeAll} | <button type="button" onClick={onSeeAll}
 * @mutate src/pages/auth/signup/SignupStep2.tsx | <InlineTextButton\n          data-testid="referral-code-toggle" | <button type="button"\n          data-testid="referral-code-toggle"
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
  ["src/components/JobConfirmation.tsx", 1],
  ["src/components/PhotoProof.tsx", 1],
  ["src/components/messages/MessageBubble.tsx", 1],
  ["src/components/dashboard/filterSheet/FilterSheetRows.tsx", 1],
  ["src/components/rentals/EndTenancyButton.tsx", 1],
  ["src/components/admin/AdminCredentialQueue.tsx", 1],
  ["src/components/admin/AdminPayoutBatches.tsx", 2],
  ["src/components/admin/AdminReports.tsx", 2],
  ["src/components/admin/adminDisputes/DisputeFilters.tsx", 1],
  ["src/components/auth/TurnstileField.tsx", 1],
  ["src/components/profile/SubscriptionTab.tsx", 1],
  ["src/pages/auth/SignupPending.tsx", 1],
  ["src/pages/auth/signup/SignupStep2.tsx", 2],
  ["src/components/job-card/ActivityBucketGroups.tsx", 1],
  ["src/components/sections/StatusBoxes.tsx", 1],
  ["src/pages/search/SearchPage.tsx", 1],
];

function scan(file: string) {
  const sf = ts.createSourceFile(file, readFileSync(resolve(REPO, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let inline = 0, underlinedButtons = 0;
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(sf);
      if (tag === "InlineTextButton") inline += 1;
      if (tag === "button" && /className="[^"]*\b(hover:)?underline\b/.test(n.getText(sf))) underlinedButtons += 1;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { inline, underlinedButtons };
}

describe("underlined text actions are the shared InlineTextButton (Q2709)", () => {
  it("checks all twenty-four files, thirty-one actions (an empty list would pass every case)", () => {
    expect(CASES.length).toBe(24);
    expect(CASES.reduce((a, [, n]) => a + n, 0)).toBe(31);
  });

  it.each(CASES)("%s", (file, n) => {
    const { inline, underlinedButtons } = scan(file);
    expect(inline).toBeGreaterThanOrEqual(n);
    expect(underlinedButtons).toBe(0);
  });
});
