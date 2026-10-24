/**
 * CLASS GUARD (owner fee ruling 2026-10-23): on the PayPal path the jobs fee is ONE fee, 8% + $0.70,
 * from the Helpr's pay, stamped on a new job at post while `paypal_payments` is on for the poster
 * (20261023232438). So every member-facing sentence that quotes the jobs fee for a job not posted
 * yet must quote the VIEWER's fee (useHelprJobFee / helprJobFeeFor: 8% + 70c on the PayPal path,
 * 5% + 70c otherwise), and every figure for a job that exists must price it by the job's own stamp.
 * A hard-coded 5% + 70c in jobs copy would tell a PayPal-path member the wrong take-home.
 *
 * Inventory DERIVED from src (tests and src/lib/helprFlatFee.ts aside): every file that names the
 * jobs fee constants (HELPR_FLAT_FEE_* / PAYPAL_HELPR_FEE_*), the fee in words ("5% + $0.70",
 * "5% + 70¢", "5% + 70c"), or the viewer-fee helpers. Each is classified, EXACT both ways:
 *   FOLLOWS  quotes the viewer's fee: reads a viewer-fee helper, says no fee literal, and names the
 *            5% phrase only where the copy is about something else (counted exactly);
 *   STAMP    prices an existing job from its stamp (helprFlatFeeCents(share, job));
 *   EXEMPT   another section's fee or the hook's own definition, with the reason.
 *
 * Red on the base (ready/paypal-phase1-foundation): FirstJobHome, the Help Center and the quote
 * stepper quoted HELPR_FLAT_FEE_* directly and read no viewer-fee helper.
 *
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | Helpr keeps {fee.phrase} of a job | Helpr keeps {"5% + $0.70"} of a job
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | const FLAT_FEE_PHRASE = fee.phrase; | const FLAT_FEE_PHRASE = "5% + $0.70";
 * @mutate src/components/quotes/QuotePriceStepper.tsx | helper_fee_flat_cents: fee.cents, helper_fee_percent: fee.percent } | helper_fee_flat_cents: 70, helper_fee_percent: 5 }
 * @mutate src/pages/info/legal/TermsSection.tsx | every job carries the same {fee.phrase} Helpr fee. | every job carries the same {HELPR_FLAT_FEE_PHRASE} Helpr fee.
 * @mutate src/lib/helprFlatFee.ts |     ? { percent: PAYPAL_HELPR_FEE_PERCENT, cents: PAYPAL_HELPR_FEE_CENTS, phrase: PAYPAL_HELPR_FEE_PHRASE, paypal: true } |     ? { percent: HELPR_FLAT_FEE_PERCENT, cents: HELPR_FLAT_FEE_CENTS, phrase: HELPR_FLAT_FEE_PHRASE, paypal: true }
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";
import { helprJobFeeFor, helprFlatFeeCents, paidOnPayPalPath } from "@/lib/helprFlatFee";

const code = (f: string) => blankComments(readFileSync(f, "utf8"));
const NAMES_THE_FEE = /\bHELPR_FLAT_FEE_(?:PHRASE|PERCENT|CENTS)\b|\bPAYPAL_HELPR_FEE_(?:PHRASE|PERCENT|CENTS)\b|5% \+ (?:\$0\.70|70¢|70c)|\buseHelprJobFee\b|\bhelprJobFeeFor\b|\bpaidOnPayPalPath\b/;
const VIEWER_FEE = /\buseHelprJobFee\(\)|\bhelprJobFeeFor\(|\bpaidOnPayPalPath\(|\bPAYPAL_HELPR_FEE_PHRASE\b/;
const FEE_LITERAL = /5% \+ (?:\$0\.70|70¢|70c)/;

/** FOLLOWS: how many times the file may still name the 5% phrase, and why. */
const FOLLOWS: Record<string, { fivePercentPhrase: number; why?: string }> = {
  "src/pages/info/legal/TermsSection.tsx": { fivePercentPhrase: 2, why: "the jobs-posted-before-PayPal clause, and Declutter delivery (not on PayPal)" },
  "src/pages/home/homeDashboard/FirstJobHome.tsx": { fivePercentPhrase: 0 },
  "src/pages/info/helpCenter/helpCenterContent.ts": { fivePercentPhrase: 0 },
  "src/pages/info/HelpCenter.tsx": { fivePercentPhrase: 0 },
  "src/components/quotes/QuotePriceStepper.tsx": { fivePercentPhrase: 0 },
  "src/components/CancellationDialog.tsx": { fivePercentPhrase: 0 },
  "src/components/admin/settings/FeeModelCard.tsx": { fivePercentPhrase: 0, why: "admin: states both models, the 5% one from its numbers" },
};
const STAMP: Record<string, string> = {
  "src/components/dashboard/applyConfirmDialog/applyTakeHome.ts": "the apply sheet: the job's own stamp (HELPR_FLAT_FEE_CENTS only labels a stamp that has no cents)",
  "src/lib/cancellationHelperShare.ts": "the cancel fee's Helpr share: the job's own stamp",
};
// @two-way src/test/helprFeeCopyFollowsPayPalPath.test.ts:expect(found).toEqual([...Object.keys(FOLLOWS), ...Object.keys(STAMP), ...Object.keys(EXEMPT)].sort());
const EXEMPT: Record<string, string> = {
  "src/hooks/useHelprJobFee.ts": "the viewer-fee hook itself",
  "src/lib/posterJobFee.ts": "the poster-fee model (switch jobs_poster_fee); the PayPal path never uses it",
  "src/components/declutter/DeclutterDeliveryViews.tsx": "Declutter (paused): its own fees, moved to PayPal per section later",
  "src/components/declutter/DeclutterOfferPanel.tsx": "Declutter (paused): the buyer's fee",
  "src/components/declutter/DeclutterTradeViews.tsx": "Declutter (paused): the buyer's fee",
  "src/components/shops/ShopOrderSheet.tsx": "Shops (testers only): the shop service fee",
};

function inventory(): string[] {
  return trackedFiles("src")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.startsWith("src/test/") && f !== "src/lib/helprFlatFee.ts")
    .filter((f) => NAMES_THE_FEE.test(code(f)))
    .sort();
}

describe("jobs fee copy follows the PayPal path (owner ruling 2026-10-23)", () => {
  it("the viewer's fee is 8% + $0.70 on the PayPal path and today's 5% + $0.70 otherwise", () => {
    expect(helprJobFeeFor(true)).toEqual({ percent: 8, cents: 70, phrase: "8% + $0.70", paypal: true });
    expect(helprJobFeeFor(false)).toEqual({ percent: 5, cents: 70, phrase: "5% + $0.70", paypal: false });
    // The stamp the database writes at post is the fee the viewer is quoted.
    const stamp = { helper_fee_flat_cents: helprJobFeeFor(true).cents, helper_fee_percent: helprJobFeeFor(true).percent };
    expect(helprFlatFeeCents(10_000, stamp)).toBe(870);
    expect(paidOnPayPalPath(stamp)).toBe(true);
    expect(paidOnPayPalPath({ helper_fee_flat_cents: 70, helper_fee_percent: 5 })).toBe(false);
    expect(paidOnPayPalPath({ helper_fee_flat_cents: null, helper_fee_percent: 8 })).toBe(false); // a legacy Elite tier job
  });

  it("inventory: every file naming the jobs fee is classified, exact both ways", () => {
    const found = inventory();
    expect(found.length).toBeGreaterThan(10);
    expect(found).toEqual([...Object.keys(FOLLOWS), ...Object.keys(STAMP), ...Object.keys(EXEMPT)].sort());
  });

  for (const [file, rule] of Object.entries(FOLLOWS)) {
    it(`${file} quotes the viewer's fee`, () => {
      const src = code(file);
      expect(src).toMatch(VIEWER_FEE);
      expect(src).not.toMatch(FEE_LITERAL);
      expect((src.match(/\bHELPR_FLAT_FEE_PHRASE\b/g) ?? []).length - (src.match(/import \{[^}]*\bHELPR_FLAT_FEE_PHRASE\b/g) ?? []).length).toBe(rule.fivePercentPhrase);
      expect(src).not.toMatch(/helper_fee_percent:\s*(?:5|HELPR_FLAT_FEE_PERCENT)\b/);
    });
  }

  for (const file of Object.keys(STAMP)) {
    it(`${file} prices an existing job by its own stamp`, () => {
      expect(code(file)).toMatch(/helprFlatFeeCents\([^;]*?,\s*(?:job|confirmApplyJob)\)/);
    });
  }
});
