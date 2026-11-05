/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): four admin text actions that were
 * hand-made <button>s are the shared InlineTextButton (src/components/ui: text-sized, the shared 44px touch
 * overlay, the link focus ring), each keeping its own type and colour:
 * - Analytics drill-down's "Analytics" breadcrumb back link.
 * - Signup leads' "Show all N" / "Show fewer" (it already wore link-standard by hand, plus a 44px box).
 * - Rentals ownership's open-the-file link.
 * - A user's audit log "Reverse this strike".
 * Each file's hand-made button count fell by one in the same commit (docs/audit/hand-made-controls-baseline.json).
 *
 * @mutate src/components/admin/AdminAnalyticsDrilldowns.tsx | <InlineTextButton\n        onClick={onBack} | <button type="button"\n        onClick={onBack}
 * @mutate src/components/admin/adminAnalytics/SignupLeadsCard.tsx | <InlineTextButton\n              onClick={() => setShowAll | <button type="button"\n              onClick={() => setShowAll
 * @mutate src/components/admin/settings/RentalsOwnershipCard.tsx | <InlineTextButton\n      className="underline font-semibold" | <button type="button"\n      className="underline font-semibold"
 * @mutate src/components/admin/userDetail/UserAuditLog.tsx | <InlineTextButton\n                      onClick={() => { setReversing(e); | <button type="button"\n                      onClick={() => { setReversing(e);
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (f: string) => blankComments(readFileSync(resolve(__dirname, "..", "..", f), "utf8"));

const CASES: [string, RegExp][] = [
  ["src/components/admin/AdminAnalyticsDrilldowns.tsx", /<InlineTextButton\s+onClick=\{onBack\}/],
  ["src/components/admin/adminAnalytics/SignupLeadsCard.tsx", /<InlineTextButton\s+onClick=\{\(\) => setShowAll\(\(v\) => !v\)\}\s+className="mt-3 text-ds-13 font-medium text-primary"/],
  ["src/components/admin/settings/RentalsOwnershipCard.tsx", /<InlineTextButton\s+className="underline font-semibold"/],
  ["src/components/admin/userDetail/UserAuditLog.tsx", /<InlineTextButton\s+onClick=\{\(\) => \{ setReversing\(e\);/],
];

describe("admin text actions are the shared InlineTextButton (Q2709)", () => {
  it.each(CASES)("%s", (file, re) => {
    const src = read(file);
    expect(src).toMatch(re);
    expect(src).not.toMatch(/<button\b/);
  });
});
