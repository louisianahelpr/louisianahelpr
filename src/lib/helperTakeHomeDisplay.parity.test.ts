import { describe, it, expect } from "vitest";
import {
  helperDisplayFeePercent,
  helperPlatformFeeDollars,
  helperTakeHomeDollars,
  isSettledForDisplay,
  type HelperEarningsJob,
} from "./helperEarnings";
import { tierFeePercent } from "./subscriptionTiers";
import {
  helperCommissionDollars,
  feePercentForTier,
} from "../../supabase/functions/_shared/helperFees";
import { netUrgentFeeDollars } from "./stripeFees";

/**
 * THE guard for the display/payout agreement.
 *
 * A helper is shown a take-home figure long before it is paid. Those two
 * numbers must be the same number. They were not: `jobs.helper_fee_percent` is
 * stamped by `create-payment` from the GLOBAL
 * `platform_settings.helper_fee_percent` at ESCROW time — before any helper is
 * assigned — while every payout path re-resolves the helper's LIVE tier
 * (`getHelperFeePercent`). Three surfaces quoted take-home off the stamped
 * column as though it were the helper's rate.
 *
 * On a real $120 job in prod (helper on `elite`, stamp = 10):
 *   shown $108.00 · transferred $110.40.
 * And in the direction that actually breaks trust, a FREE helper (12%):
 *   shown $108.00 · transferred $105.60 — a displayed take-home HIGHER than
 *   the payout, which `JobPrice.tsx` states must never happen.
 *
 * This test asserts the two agree for the extremes of the ladder.
 */

/** What the edge actually transfers, mirroring release-payout/index.ts. */
function payoutTakeHomeDollars(
  budget: number,
  livePercent: number,
  urgentFee = 0,
  helpersCount = 1,
) {
  const perHelperBudget = budget / helpersCount;
  const gross = perHelperBudget + netUrgentFeeDollars(urgentFee) / helpersCount;
  return gross - helperCommissionDollars(perHelperBudget, livePercent);
}

const TIERS = [
  { tier: "free", percent: 12 },
  { tier: "elite", percent: 8 },
] as const;

describe("displayed take-home equals the payout for the helper's live tier", () => {
  for (const { tier, percent } of TIERS) {
    it(`${tier} (${percent}%): an unsettled job is shown at the live tier, not the escrow stamp`, () => {
      // The client and edge tier ladders must agree before anything else does.
      expect(tierFeePercent(tier)).toBe(percent);
      expect(feePercentForTier(tier)).toBe(percent);

      // A real escrowed row: create-payment stamped the GLOBAL 10% and the
      // matching whole-job amount, neither of which is this helper's rate.
      const job: HelperEarningsJob = {
        budget: 120,
        helper_fee_percent: 10,
        platform_fee_amount: 12,
        payment_status: "escrow",
      };

      expect(isSettledForDisplay(job)).toBe(false);
      expect(helperDisplayFeePercent(job, percent)).toBe(percent);
      expect(helperPlatformFeeDollars(job, percent)).toBeCloseTo((120 * percent) / 100, 10);
      expect(helperTakeHomeDollars(job, percent)).toBeCloseTo(
        payoutTakeHomeDollars(120, percent),
        10,
      );
      // And specifically NOT the stamped-column figure that produced the bug.
      expect(helperTakeHomeDollars(job, percent)).not.toBeCloseTo(108, 2);
    });

    it(`${tier} (${percent}%): a shown take-home never exceeds the payout`, () => {
      for (const budget of [20, 47.5, 120, 999.99]) {
        for (const urgent of [0, 15]) {
          const job: HelperEarningsJob = {
            budget,
            helper_fee_percent: 10,
            platform_fee_amount: (budget * 10) / 100,
            urgent_fee: urgent,
            payment_status: "escrow",
          };
          const shown = helperTakeHomeDollars(job, percent);
          const paid = payoutTakeHomeDollars(budget, percent, urgent);
          expect(shown).toBeLessThanOrEqual(paid + 0.005);
          expect(shown).toBeCloseTo(paid, 2);
        }
      }
    });
  }

  it("a RELEASED job trusts its stamp — the payout re-stamped it with the live tier", () => {
    // release-payout / process-scheduled-payouts write back the resolved
    // percent and the exact fee they deducted, so that row IS the record.
    const released: HelperEarningsJob = {
      budget: 120,
      helper_fee_percent: 8,
      platform_fee_amount: 9.6,
      payment_status: "released",
    };
    expect(isSettledForDisplay(released)).toBe(true);
    // Even asked to fall back to the free rate, the stamp wins.
    expect(helperDisplayFeePercent(released, 12)).toBe(8);
    expect(helperTakeHomeDollars(released, 12)).toBeCloseTo(110.4, 10);
    expect(helperTakeHomeDollars(released, 12)).toBeCloseTo(
      payoutTakeHomeDollars(120, 8),
      10,
    );
  });

  it("a caller that omits payment_status keeps the historical stamped behavior", () => {
    const legacy: HelperEarningsJob = {
      budget: 120,
      helper_fee_percent: 8,
      platform_fee_amount: 9.6,
    };
    expect(isSettledForDisplay(legacy)).toBe(true);
    expect(helperTakeHomeDollars(legacy, 12)).toBeCloseTo(110.4, 10);
  });

  it("group jobs: the live tier applies to each helper's share", () => {
    const job: HelperEarningsJob = {
      budget: 300,
      helpers_needed: 3,
      is_group_job: true,
      helper_fee_percent: 10,
      platform_fee_amount: 30,
      payment_status: "escrow",
    };
    expect(helperTakeHomeDollars(job, 12)).toBeCloseTo(
      payoutTakeHomeDollars(300, 12, 0, 3),
      10,
    );
  });
});
