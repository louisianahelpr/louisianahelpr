// @mutate supabase/functions/_shared/refundAmount.ts |   const feeKeptCents = Math.max(cents(i.customerFeeCents), cents(i.actualFeeCents)); |   const feeKeptCents = cents(i.customerFeeCents);
// @mutate supabase/functions/_shared/refundAmount.ts |   const remainingCents = Math.max(0, ceilingCents - cents(i.alreadyRefundedCents)); |   const remainingCents = ceilingCents;
// @mutate supabase/functions/_shared/refundAmount.ts |   if (pct == null \|\| pct === "" \|\| Number(pct) !== 0) return 0; |   if (pct == null \|\| pct === "") return 0;
// @mutate src/lib/refundAmount.ts |   const feeKeptCents = Math.max(cents(i.customerFeeCents), cents(i.actualFeeCents)); |   const feeKeptCents = cents(i.customerFeeCents);
import { describe, it, expect } from "vitest";
import {
  refundToPayerCents as uiRefund,
  cardCostFeeCents as uiCardCostFee,
  crewFeeShareReturnCents as uiCrew,
} from "./refundAmount";
// The edge module has zero imports, so vitest loads it directly. This is the
// guard that keeps the admin console's previews and the refunds Stripe is sent
// on one definition (owner, 2026-10-14: every refund keeps the card fee).
import {
  refundToPayerCents as edgeRefund,
  cardCostFeeCents as edgeCardCostFee,
  crewFeeShareReturnCents as edgeCrew,
} from "../../supabase/functions/_shared/refundAmount";
import { stripeProcessingCostCents } from "./stripeFees";

describe("refund amount: never absorb a fee (owner, 2026-10-14)", () => {
  it("b108a7ae-style admin full refund: a $26.06 charge returns $25.00, the $1.06 card fee is kept", () => {
    // Prod job b108a7ae (2026-10-14): budget $25, customer_fee_amount $1.06,
    // captured 2606; admin_refund_general refunded 2606 (the whole charge).
    const r = edgeRefund({ capturedCents: 2606, actualFeeCents: stripeProcessingCostCents(2606), customerFeeCents: 106 });
    expect(r.refundCents).toBe(2500);
    expect(r.feeKeptCents).toBe(106);
    expect(r.refundCents).not.toBe(2606);
  });

  it("keeps the larger of the fee paid and Stripe's real fee, plus the setup fee, less earlier refunds", () => {
    expect(edgeRefund({ capturedCents: 2806, actualFeeCents: 112, customerFeeCents: 106, setupFeeCents: 200 }).refundCents).toBe(2806 - 112 - 200);
    expect(edgeRefund({ capturedCents: 2606, actualFeeCents: 50, customerFeeCents: 106, alreadyRefundedCents: 1000 }).refundCents).toBe(1500 - 0);
    // A partial is capped at what is still refundable.
    expect(edgeRefund({ capturedCents: 2606, actualFeeCents: 106, requestedCents: 9999 }).refundCents).toBe(2500);
    expect(edgeRefund({ capturedCents: 2606, actualFeeCents: 106, requestedCents: 700 }).refundCents).toBe(700);
    // Never negative, never NaN.
    expect(edgeRefund({ capturedCents: 100, actualFeeCents: 33, setupFeeCents: 200 }).refundCents).toBe(0);
    expect(edgeRefund({ capturedCents: Number.NaN, actualFeeCents: 33 }).refundCents).toBe(0);
  });

  it("a dispute the poster WON keeps the card cost only, never a legacy 12% service fee (7440a72d-style)", () => {
    // Prod job 7440a72d: $100 budget, $12 legacy service fee (platform_fee_percent 12).
    const legacy = { customer_fee_amount: 12, platform_fee_percent: 12 };
    expect(edgeCardCostFee(legacy)).toBe(0);
    const captured = 11200;
    const r = edgeRefund({ capturedCents: captured, actualFeeCents: stripeProcessingCostCents(captured), customerFeeCents: edgeCardCostFee(legacy) });
    expect(r.feeKeptCents).toBe(355); // 2.9% of $112 + $0.30
    expect(r.refundCents).toBe(11200 - 355);
    // On a no-service-fee job the fee the poster paid IS the card cost, and counts.
    expect(edgeCardCostFee({ customer_fee_amount: 1.06, platform_fee_percent: 0 })).toBe(106);
    expect(edgeCardCostFee({ customer_fee_amount: "1.06", platform_fee_percent: "0.00" })).toBe(106);
    // Unknown pricing is treated as legacy: Stripe's real fee is what is kept.
    expect(edgeCardCostFee({ customer_fee_amount: 1.06, platform_fee_percent: null })).toBe(0);
  });

  it("a crew's unfilled-share refund never returns the card fee", () => {
    expect(edgeCrew({ customerFeeCents: 106, actualFeeCents: 106, proRataCents: 53 })).toBe(0);
    expect(edgeCrew({ customerFeeCents: 1200, actualFeeCents: 355, proRataCents: 600 })).toBe(600);
    expect(edgeCrew({ customerFeeCents: 1200, actualFeeCents: 900, proRataCents: 600 })).toBe(300);
  });

  it("UI mirror and edge module agree on a grid", () => {
    let n = 0;
    for (const capturedCents of [0, 100, 2606, 11200, 50_000]) {
      for (const actualFeeCents of [0, 30, 106, 355]) {
        for (const customerFeeCents of [0, 106, 1200]) {
          for (const setupFeeCents of [0, 200]) {
            for (const alreadyRefundedCents of [0, 1000]) {
              for (const requestedCents of [null, 500, 99_999]) {
                const i = { capturedCents, actualFeeCents, customerFeeCents, setupFeeCents, alreadyRefundedCents, requestedCents };
                expect(uiRefund(i), JSON.stringify(i)).toEqual(edgeRefund(i));
                expect(uiCrew({ customerFeeCents, actualFeeCents, proRataCents: requestedCents ?? 0 })).toBe(
                  edgeCrew({ customerFeeCents, actualFeeCents, proRataCents: requestedCents ?? 0 }),
                );
                n++;
              }
            }
          }
        }
      }
    }
    for (const job of [{ customer_fee_amount: 1.06, platform_fee_percent: 0 }, { customer_fee_amount: 12, platform_fee_percent: 12 }, null, {}]) {
      expect(uiCardCostFee(job)).toBe(edgeCardCostFee(job));
      n++;
    }
    expect(n).toBeGreaterThan(700);
  });
});
