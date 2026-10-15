import { describe, it, expect } from "vitest";
import * as client from "./helprFlatFee";
import * as edge from "../../supabase/functions/_shared/helprFlatFee";
import { stripeProcessingCostCents } from "./stripeFees";
import { jobHelprCommissionDollars, helperCommissionDollars } from "../../supabase/functions/_shared/helperFees";
import { roundPayoutDownCents } from "../../supabase/functions/_shared/money";
import * as clientEarnings from "./helperEarnings";
import * as edgeEarnings from "../../supabase/functions/_shared/helperEarnings";

// Roadmap F3 (owner, 2026-10-14/15): the Helpr pays a flat 5% + $0.70 out of
// their pay; the poster pays exactly the job price; the card cost comes out of
// the 5% + 70c. These are the owner's own worked numbers.
// @mutate supabase/functions/_shared/helprFlatFee.ts | export const HELPR_FLAT_FEE_CENTS = 70; | export const HELPR_FLAT_FEE_CENTS = 60;
// @mutate src/lib/helprFlatFee.ts | return Math.min(share, Math.round((share * pct) / 100) + flat); | return Math.min(share, Math.round((share * pct) / 100));

describe("Helpr flat fee (F3): edge and client agree, and match the owner's numbers", () => {
  it("$100 job: the Helpr receives $94.30 (owner's example)", () => {
    for (const m of [client, edge]) expect(m.helprFlatFeeCents(10_000)).toBe(570);
    expect(client.helprFlatTakeHomeCents(10_000)).toBe(9_430);
    expect(10_000 - edge.helprFlatFeeCents(10_000)).toBe(9_430);
  });

  it("$20 job: the Helpr receives $18.30", () => {
    expect(client.helprFlatTakeHomeCents(2_000)).toBe(1_830);
    expect(2_000 - edge.helprFlatFeeCents(2_000)).toBe(1_830);
  });

  it("the platform never absorbs the card cost: 5% + 70c covers Stripe's cost on the job price at every price from $1 to $5,000", () => {
    for (let c = 100; c <= 500_000; c += 37) {
      expect(edge.helprFlatFeeCents(c)).toBeGreaterThanOrEqual(stripeProcessingCostCents(c));
    }
  });

  it("constants and every price agree between the two runtimes", () => {
    expect(client.HELPR_FLAT_FEE_PERCENT).toBe(edge.HELPR_FLAT_FEE_PERCENT);
    expect(client.HELPR_FLAT_FEE_CENTS).toBe(edge.HELPR_FLAT_FEE_CENTS);
    const stamped = { helper_fee_flat_cents: 70, helper_fee_percent: 5 };
    for (let c = 0; c <= 200_000; c += 13) {
      expect(client.helprFlatFeeCents(c)).toBe(edge.helprFlatFeeCents(c));
      expect(client.helprFlatFeeCents(c, stamped)).toBe(edge.helprFlatFeeCents(c, stamped));
    }
  });

  it("a job keeps the numbers it was stamped with; a legacy tier percent is never read as the flat percent", () => {
    for (const m of [client, edge]) {
      expect(m.isFlatFeeJob({ helper_fee_flat_cents: 70, helper_fee_percent: 5 })).toBe(true);
      expect(m.isFlatFeeJob({ helper_fee_flat_cents: null, helper_fee_percent: 12 })).toBe(false);
      expect(m.isFlatFeeJob(null)).toBe(false);
      // Stamped 4% + 50c (a future change) keeps 4% + 50c on this job.
      expect(m.helprFlatFeeCents(10_000, { helper_fee_flat_cents: 50, helper_fee_percent: 4 })).toBe(450);
      // A legacy job's 12% is NOT the flat percent.
      expect(m.helprFlatFeeCents(10_000, { helper_fee_flat_cents: null, helper_fee_percent: 12 })).toBe(570);
      // Never more than the share.
      expect(m.helprFlatFeeCents(50)).toBe(50);
    }
    expect(client.helprFlatTakeHomeCents(50)).toBe(0);
    expect(50 - edge.helprFlatFeeCents(50)).toBe(0);
  });

  it("flatFeePercentOf: the stamped percent on a flat job, null on a legacy job", () => {
    for (const m of [client, edge]) {
      expect(m.flatFeePercentOf({ helper_fee_flat_cents: 70, helper_fee_percent: 5 })).toBe(5);
      expect(m.flatFeePercentOf({ helper_fee_flat_cents: 70, helper_fee_percent: null })).toBe(5);
      expect(m.flatFeePercentOf({ helper_fee_flat_cents: 50, helper_fee_percent: 4 })).toBe(4);
      expect(m.flatFeePercentOf({ helper_fee_flat_cents: null, helper_fee_percent: 12 })).toBeNull();
      expect(m.flatFeePercentOf(undefined)).toBeNull();
    }
  });

  // @mutate supabase/functions/_shared/helperFees.ts | return helprFlatFeeCents(Math.round(Number(perHelperBudgetDollars) * 100) + urgentCents, job) / 100; | return helprFlatFeeCents(Math.round(Number(perHelperBudgetDollars) * 100), job) / 100;
  it("payout commission (F3a/F3b): flat job pays 5% + 70c on budget + urgent bonus, transfer floors to whole dollars; legacy job unchanged", () => {
    const flat = { helper_fee_flat_cents: 70, helper_fee_percent: 5 };
    // $100 job: fee $5.70, take-home $94.30, the transfer is $94 (Q236 floor kept, owner 2026-10-15).
    expect(jobHelprCommissionDollars(flat, 100, 5, 0)).toBe(5.7);
    expect(roundPayoutDownCents(10_000 - 570)).toBe(9_400);
    // $100 + $20 urgent bonus: 5% of $120 + 70c = $6.70 (the bonus is part of the price).
    expect(jobHelprCommissionDollars(flat, 100, 5, 20)).toBe(6.7);
    // A legacy job keeps the tier commission on the budget only; the bonus stays outside it.
    expect(jobHelprCommissionDollars({ helper_fee_flat_cents: null, helper_fee_percent: 12 }, 100, 12, 20))
      .toBe(helperCommissionDollars(100, 12));
    expect(jobHelprCommissionDollars(null, 100, 12, 20)).toBe(12);
  });

  // @mutate src/lib/helperEarnings.ts | if (isFlatFeeJob(job)) return flatFeePercentOf(job) ?? feeFallbackPercent; | if (false) return 0;
  it("take-home display (web and edge): a flat job shows 5% and floors $94.30 to $94 whatever the viewer's tier", () => {
    const job = { budget: 100, urgent_fee: 20, helper_fee_flat_cents: 70, helper_fee_percent: 5, payment_status: "escrow", platform_fee_amount: null };
    for (const m of [clientEarnings, edgeEarnings]) {
      expect(m.helperDisplayFeePercent(job, 12)).toBe(5);
      expect(m.helperPlatformFeeDollars(job, 12)).toBe(6.7);
      expect(m.helperTakeHomeDollars(job, 12)).toBe(113);
    }
    const legacy = { budget: 100, helper_fee_percent: 12, payment_status: "released", platform_fee_amount: 12 };
    for (const m of [clientEarnings, edgeEarnings]) expect(m.helperTakeHomeDollars(legacy, 12)).toBe(88);
  });
});
