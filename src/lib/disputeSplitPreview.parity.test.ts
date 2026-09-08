// The admin's split preview must quote the same dollars the executor moves.
//
// `disputeSplitPreview` inlines the commission rounding rather than importing
// `supabase/functions/_shared/helperFees` (app code must not reach into the
// edge tree). That is a copy, and a copy drifts — so this test holds the copy
// against the original, the way stripeFees.parity.test.ts and
// roleFeeParity.test.ts already do for their pairs.
import { describe, it, expect } from "vitest";
import { helperCommissionDollars } from "../../supabase/functions/_shared/helperFees";
import { netUrgentFeeDollars } from "../../supabase/functions/_shared/stripeFees";
import { previewDisputeSplit } from "./disputeSplitPreview";

const job = (over: Record<string, unknown> = {}) => ({
  budget: 180,
  urgent_fee: 0,
  helper_fee_percent: 12,
  customer_fee_amount: 5,
  sales_tax_amount: 0,
  payment_status: "escrow",
  ...over,
});

describe("previewDisputeSplit — the Helpr's leg matches the executor", () => {
  for (const share of [0, 0.05, 0.25, 0.5, 0.75, 1]) {
    it(`nets the helper the transferred amount at a ${share * 100}% share`, () => {
      const j = job({ urgent_fee: 15 });
      const p = previewDisputeSplit(j, share, "free");
      // The executor's own arithmetic, transcribed from
      // execute-dispute-split/index.ts § "helper leg".
      const budgetShare = 180 * share;
      const urgentShare = netUrgentFeeDollars(15) * share;
      const expected = budgetShare + urgentShare - helperCommissionDollars(budgetShare, 12);
      expect(p.helperNet).toBeCloseTo(expected, 10);
      expect(p.helperCommission).toBeCloseTo(helperCommissionDollars(budgetShare, 12), 10);
    });
  }

  it("quotes the LIVE tier rate while the job is unsettled — as the executor will", () => {
    // A disputed job has not been paid out, so `getHelperFeePercent` in the
    // executor resolves the helper's tier from `profiles` and only falls back
    // to the frozen `jobs.helper_fee_percent` if that read FAILS. The preview
    // must resolve in the same order or it quotes a rate no transfer will use:
    // an Elite helper is charged 8%, whatever the job was posted at.
    expect(previewDisputeSplit(job({ helper_fee_percent: 12 }), 1, "elite").helperFeePercent).toBe(8);
    expect(previewDisputeSplit(job({ helper_fee_percent: 8 }), 1, "free").helperFeePercent).toBe(12);
    expect(previewDisputeSplit(job({ helper_fee_percent: null }), 1, null).helperFeePercent).toBe(12);
  });

  it("honours the frozen rate once the job HAS been released", () => {
    // A settled row's stamped rate is the record of what was actually
    // deducted, so a later tier change must not restate it.
    const p = previewDisputeSplit(
      job({ helper_fee_percent: 8, payment_status: "released" }),
      1,
      "free",
    );
    expect(p.helperFeePercent).toBe(8);
  });

  it("splits a group job's budget across the roster", () => {
    const p = previewDisputeSplit(
      job({ is_group_job: true, helpers_needed: 3, helper_fee_percent: 12 }),
      1,
      "free",
    );
    expect(p.helperGross).toBeCloseTo(60, 10);
  });
});

describe("previewDisputeSplit — the poster's leg", () => {
  it("withholds Stripe's processing cost, pro rata to the poster's share", () => {
    // $180 budget + $5 service fee = $185 captured = 18500c. Stripe keeps
    // 2.9% + $0.30 → `stripeProcessingCostCents` rounds UP (toward the
    // platform, never toward minting money) to 567c. Refundable = 17933c.
    const full = previewDisputeSplit(job(), 0, "free");
    expect(full.posterNet).toBeCloseTo(179.33, 2);
    const half = previewDisputeSplit(job(), 0.5, "free");
    expect(half.posterNet).toBeCloseTo(89.67, 2);
  });

  it("never returns more than was captured", () => {
    const p = previewDisputeSplit(job(), 0, "free");
    expect(p.posterNet).toBeLessThan(185);
  });

  it("is zero when the helper takes the whole award", () => {
    expect(previewDisputeSplit(job(), 1, "free").posterNet).toBe(0);
  });
});

describe("previewDisputeSplit — the two legs never over-draw the escrow", () => {
  for (const share of [0, 0.2, 0.5, 0.8, 1]) {
    it(`stays within the capture at a ${share * 100}% share`, () => {
      const p = previewDisputeSplit(job({ urgent_fee: 10 }), share, "free");
      const captured = 180 + 5 + 10;
      expect(p.helperNet + p.posterNet).toBeLessThanOrEqual(captured + 0.005);
    });
  }
});

describe("previewDisputeSplit — each column reconciles: gross − deduction = net", () => {
  // The regression this guards. `posterGross` was `budget × posterShare` while
  // `posterNet` was a share of the CAPTURE, so on the $60 + $6-fee seed dispute
  // the admin card printed a net ABOVE its own gross:
  //   "$31.90 refunded / $30.00 gross / −$1.11 Stripe keeps".
  // The bases must be each leg's own, and the deduction must be the remainder.
  const seed = (over: Record<string, unknown> = {}) =>
    job({ budget: 60, customer_fee_amount: 6, urgent_fee: 0, sales_tax_amount: 0, ...over });

  // $66.00 captured = 6600c. Stripe keeps round(6600 × 2.9%) + 30 = 221c.
  // Refundable = 6379c.
  it("50/50 on the $60 + $6 job: poster $33.00 gross → $31.90 refunded", () => {
    const p = previewDisputeSplit(seed(), 0.5, "free");
    expect(p.posterGross).toBeCloseTo(33.0, 10);
    expect(p.posterNet).toBeCloseTo(31.9, 10); // round(6379 × 0.5) = 3190c
    expect(p.posterProcessingCost).toBeCloseTo(1.1, 10);
    // The Helpr's half of the $60 budget, less the 12% free-tier commission.
    expect(p.helperGross).toBeCloseTo(30.0, 10);
    expect(p.helperCommission).toBeCloseTo(3.6, 10);
    expect(p.helperNet).toBeCloseTo(26.4, 10);
  });

  it("0/100 — the poster takes the whole award and the Helpr's column is empty", () => {
    const p = previewDisputeSplit(seed(), 0, "free");
    expect(p.posterGross).toBeCloseTo(66.0, 10);
    expect(p.posterNet).toBeCloseTo(63.79, 10);
    expect(p.posterProcessingCost).toBeCloseTo(2.21, 10);
    expect(p.helperGross).toBe(0);
    expect(p.helperNet).toBe(0);
    expect(p.helperCommission).toBe(0);
  });

  it("100/0 — the Helpr takes the whole award and nothing is refunded", () => {
    const p = previewDisputeSplit(seed(), 1, "free");
    expect(p.posterGross).toBe(0);
    expect(p.posterNet).toBe(0);
    expect(p.posterProcessingCost).toBe(0);
    expect(p.helperGross).toBeCloseTo(60.0, 10);
    expect(p.helperCommission).toBeCloseTo(7.2, 10);
    expect(p.helperNet).toBeCloseTo(52.8, 10);
  });

  for (const share of [0, 0.05, 0.25, 0.5, 0.75, 1]) {
    it(`both columns reconcile at a ${share * 100}% share, urgent fee included`, () => {
      // The urgent fee is on BOTH bases: net of Stripe's marginal cost on the
      // Helpr's leg, at face value on the poster's (they paid the gross).
      const p = previewDisputeSplit(seed({ urgent_fee: 10, sales_tax_amount: 3 }), share, "free");
      expect(p.posterGross - p.posterProcessingCost).toBeCloseTo(p.posterNet, 10);
      expect(p.helperGross - p.helperCommission).toBeCloseTo(p.helperNet, 10);
      // And a net never exceeds its own gross — the shape of the original bug.
      expect(p.posterNet).toBeLessThanOrEqual(p.posterGross);
      expect(p.helperNet).toBeLessThanOrEqual(p.helperGross);
    });
  }

  it("the Helpr's gross includes the urgent-fee share its net is paid from", () => {
    // `helperGross` was `budget × share` alone while `helperNet` added the net
    // urgent fee — the same net-above-gross break as the poster column, just
    // latent until a job carried an urgent fee.
    const p = previewDisputeSplit(seed({ urgent_fee: 10 }), 1, "free");
    expect(p.helperGross).toBeCloseTo(60 + netUrgentFeeDollars(10), 10);
    expect(p.helperGross).toBeGreaterThan(60);
  });
});
