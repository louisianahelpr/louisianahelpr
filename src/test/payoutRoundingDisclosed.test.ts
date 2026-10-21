/**
 * Owner 2026-10-21: Helpr payouts are rounded DOWN to the whole dollar and the
 * platform keeps the cents, and that MUST be disclosed in the fee copy and the
 * Terms. The rule itself is guarded by helprPayoutRoundedDown.test.ts (Jobs)
 * and helprDeliveryPayoutRoundedDown.test.ts (Declutter delivery). This guard
 * holds the disclosure on every surface that states the Helpr fee in words:
 *
 *  - the Terms' "Fee model" Helpr fee line (jobs AND deliveries, cents kept);
 *  - the first-job Home's "How you get paid";
 *  - the apply sheet's breakdown line for the dropped cents.
 *
 * Inventory: every non-test src file that renders HELPR_FLAT_FEE_PHRASE (the
 * fee in words) is listed here, exact both ways, with the disclosure it must
 * carry or the reason it need not.
 */
// @mutate src/pages/info/legal/TermsSection.tsx | is rounded down to the whole dollar, and Louisiana Helpr keeps the cents left over. Tips | is rounded down to the whole dollar. Tips
// @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | of a job, and your payout is rounded down to the whole dollar (Helpr keeps the cents; tips are paid in full). | of a job.
// @mutate src/components/dashboard/applyConfirmDialog/ApplyEarningsBreakdown.tsx | − Rounded down to the dollar | − Other
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | Job payouts are rounded down to the whole dollar (tips are paid in full), | Job payouts are paid (tips are paid in full),
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const flat = (s: string) => s.replace(/\s+/g, " ");
const read = (f: string) => flat(readFileSync(f, "utf8"));

/** Files that say the Helpr fee in words, and the sentence each must carry (or the reason it need not). */
const FEE_IN_WORDS: Record<string, { says: RegExp } | { exempt: string }> = {
  "src/pages/info/legal/TermsSection.tsx": {
    says: /Every payout to a Helpr, for a job or a delivery, is rounded down to the whole dollar, and Louisiana Helpr keeps the cents left over\. Tips are paid in full, and a card fee you owe for a refund you were at fault for comes off after the rounding, to the cent\./,
  },
  "src/pages/home/homeDashboard/FirstJobHome.tsx": {
    says: /of a job, and your payout is rounded down to the whole dollar \(Helpr keeps the cents; tips are paid in full\)\./,
  },
  // The fee answer says it and quotes the rounded take-home (floorPayoutDollars, Q236).
  "src/pages/info/helpCenter/helpCenterContent.ts": {
    says: /Job payouts are rounded down to the whole dollar \(tips are paid in full\), so on a \$100 job you receive \$\$\{FLAT_TAKE_HOME_ON_100\}/,
  },
};

function filesNamingTheFee(): string[] {
  const files = trackedFiles("src")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && f !== "src/lib/helprFlatFee.ts");
  return files.filter((f) => /\bHELPR_FLAT_FEE_PHRASE\b/.test(blankComments(readFileSync(f, "utf8")))).sort();
}

describe("Helpr payout rounding is disclosed wherever the fee is stated (owner 2026-10-21)", () => {
  it("inventory: every file stating the Helpr fee in words is classified, exact both ways", () => {
    const found = filesNamingTheFee();
    expect(found.length).toBeGreaterThan(2);
    expect(found).toEqual(Object.keys(FEE_IN_WORDS).sort());
  });

  for (const [file, rule] of Object.entries(FEE_IN_WORDS)) {
    if (!("says" in rule)) continue;
    it(`${file} says payouts are rounded down and the cents are kept`, () => {
      expect(read(file)).toMatch(rule.says);
    });
  }

  it("the apply sheet names the dropped cents as its own line", () => {
    expect(read("src/components/dashboard/applyConfirmDialog/ApplyEarningsBreakdown.tsx")).toContain("− Rounded down to the dollar");
  });
});
