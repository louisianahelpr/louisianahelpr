import { describe, expect, it } from "vitest";
import { cardCostFeeCents, refundToPayerCents } from "../../supabase/functions/_shared/refundAmount";
import { stripeProcessingCostCents } from "../../supabase/functions/_shared/stripeFees";

// Roadmap F3 (owner 2026-10-14/15): a poster refund on a flat-model job is the
// job price minus the card cost (never-absorb rule); our-mistake refunds stay
// full and are not priced here. create-payment stamps a flat job with
// customer_fee_amount = 0 and platform_fee_percent = 0, so the only thing a
// refund keeps is Stripe's real fee on the charge.
// @mutate supabase/functions/_shared/refundAmount.ts | const feeKeptCents = Math.max(cents(i.customerFeeCents), cents(i.actualFeeCents)); | const feeKeptCents = cents(i.customerFeeCents);
describe("refund on a flat-model job (F3)", () => {
  it("$100 job: the poster gets back the price minus Stripe's card cost", () => {
    const captured = 10_000;
    const stripeFee = stripeProcessingCostCents(captured); // $3.20
    expect(stripeFee).toBe(320);
    const job = { customer_fee_amount: 0, platform_fee_percent: 0 };
    const r = refundToPayerCents({
      capturedCents: captured,
      actualFeeCents: stripeFee,
      customerFeeCents: Math.round(Number(job.customer_fee_amount) * 100),
    });
    expect(r.refundCents).toBe(9_680);
    expect(r.feeKeptCents).toBe(320);
    // Dispute and admin paths keep only the card cost too: on a flat job the
    // card-cost fee field is 0, so Stripe's real fee is what is kept.
    expect(cardCostFeeCents(job)).toBe(0);
    const admin = refundToPayerCents({ capturedCents: captured, actualFeeCents: stripeFee, customerFeeCents: cardCostFeeCents(job) });
    expect(admin.refundCents).toBe(9_680);
  });
});
