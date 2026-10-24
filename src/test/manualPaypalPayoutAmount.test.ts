/**
 * The manual PayPal payout amount (PayPal Plan A, phase 4) is release-payout's Helpr share, to the cent:
 * per-Helpr budget + urgent bonus, minus the job's STAMPED fee model, rounded DOWN to a whole dollar
 * (owner rule Q236, _shared/money.ts roundPayoutDownCents; the platform keeps the cents). The owner sends
 * exactly this amount by hand, and Mark paid refuses any other total, so a drift here is money.
 *
 * @mutate supabase/functions/_shared/payments/manualPayoutQueue.ts |     payoutCents: roundPayoutDownCents(Math.round((perHelperBudget + perHelperUrgent - commission) * 100)), |     payoutCents: roundPayoutDownCents(Math.round((perHelperBudget + perHelperUrgent) * 100)),
 */
import { describe, expect, it } from "vitest";
import { manualPayoutCents, type PayoutJobFields } from "../../supabase/functions/_shared/payments/manualPayoutQueue";
import { PAYPAL_HELPR_FEE_CENTS, PAYPAL_HELPR_FEE_PERCENT } from "../../supabase/functions/_shared/helprFlatFee";

const job = (over: Partial<PayoutJobFields>): PayoutJobFields => ({
  id: "j", helper_id: "h", budget: 100, urgent_fee: null, is_group_job: false, helpers_needed: 1,
  helper_fee_percent: null, helper_fee_flat_cents: null, poster_fee_flat_cents: null, ...over,
});

describe("manual PayPal payout amount", () => {
  it("a PayPal-path job stamped 8% + 70c: $100 owes $91.30, paid as $91 (whole dollars down), fee $8.70", () => {
    expect(manualPayoutCents(job({ helper_fee_percent: PAYPAL_HELPR_FEE_PERCENT, helper_fee_flat_cents: PAYPAL_HELPR_FEE_CENTS }), 99))
      .toEqual({ payoutCents: 9100, platformFeeCents: 870 });
  });
  it("the urgent bonus is in the share the stamp is taken on", () => {
    expect(manualPayoutCents(job({ budget: 80, urgent_fee: 20, helper_fee_percent: 8, helper_fee_flat_cents: 70 }), 99))
      .toEqual({ payoutCents: 9100, platformFeeCents: 870 });
  });
  it("a legacy (tier) job uses the tier percent it is given", () => {
    expect(manualPayoutCents(job({ budget: 50 }), 12)).toEqual({ payoutCents: 4400, platformFeeCents: 600 });
  });
  it("odd cents round the payout down to a whole dollar, never up", () => {
    const { payoutCents, platformFeeCents } = manualPayoutCents(job({ budget: 33.33, helper_fee_percent: 8, helper_fee_flat_cents: 70 }), 99);
    expect(payoutCents).toBe(2900);
    expect(payoutCents + platformFeeCents).toBeLessThanOrEqual(3333);
  });
});
