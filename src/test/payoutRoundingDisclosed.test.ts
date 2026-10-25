/**
 * Owner 2026-10-21: Helpr payouts are rounded DOWN to the whole dollar and the
 * platform keeps the cents, and that MUST be disclosed in the Terms. The rule
 * itself is guarded by helprPayoutRoundedDown.test.ts (Jobs) and
 * helprDeliveryPayoutRoundedDown.test.ts (Declutter delivery).
 *
 * Owner 2026-10-25: members never see the fee's rate or maths, so no screen
 * states the fee in words any more (HELPR_FLAT_FEE_PHRASE is gone; the apply
 * sheet shows the take-home only). The disclosure stays in the Terms' fee
 * model and in the Help Center's fees answer, and the take-home every screen
 * shows is already the rounded-down figure.
 */
// @mutate src/pages/info/legal/TermsSection.tsx | is rounded down to the whole dollar, and Louisiana Helpr keeps the cents left over. Tips | is rounded down to the whole dollar. Tips
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | Job payouts are rounded down to the whole dollar (tips are paid in full). | Job payouts are paid (tips are paid in full).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const flat = (s: string) => s.replace(/\s+/g, " ");
const read = (f: string) => flat(readFileSync(f, "utf8"));

/** The two places that disclose the rounding, and the sentence each must carry. */
const DISCLOSES: Record<string, RegExp> = {
  "src/pages/info/legal/TermsSection.tsx":
    /Every payout to a Helpr, for a job or a delivery, is rounded down to the whole dollar, and Louisiana Helpr keeps the cents left over\. Tips are paid in full, and a card fee you owe for a refund you were at fault for comes off after the rounding, to the cent\./,
  "src/pages/info/helpCenter/helpCenterContent.ts":
    /Job payouts are rounded down to the whole dollar \(tips are paid in full\)\./,
};

describe("Helpr payout rounding is disclosed (owner 2026-10-21), and no screen states the fee in words (owner 2026-10-25)", () => {
  it("no non-test src file renders a fee phrase", () => {
    const files = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(1000);
    expect(files.filter((f) => /\bHELPR_FLAT_FEE_PHRASE\b/.test(blankComments(readFileSync(f, "utf8"))))).toEqual([]);
  });

  for (const [file, says] of Object.entries(DISCLOSES)) {
    it(`${file} says payouts are rounded down`, () => {
      expect(read(file)).toMatch(says);
    });
  }
});
