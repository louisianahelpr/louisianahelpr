/**
 * Q1177, owner 2026-10-04 ("Fix Spent first"): the Money tab's Spent total and
 * its "Jobs you paid for" list count only what a poster's card was really
 * charged and kept paying. Before this rule the Spent total summed `budget` for
 * every completed posted job, so the poster account showed $50 spent on
 * "Q337 seed: closed no payment" (payment_status 'cancelled', no PaymentIntent).
 *
 * Cases (owner's list): paid job, closed with no payment ($0), full refund ($0,
 * left out), partial refund (the kept amount), chargeback ($0), gift card cover
 * (only the card part), and total = the sum of the rows.
 */
// @mutate src/lib/posterSpend.ts | if (!job.stripe_payment_intent_id) return 0; | if (!job.stripe_payment_intent_id && false) return 0;
// @mutate src/lib/posterSpend.ts | if (!(CHARGED_PAYMENT_STATUSES as readonly string[]).includes(job.payment_status ?? "")) return 0; | if (job.payment_status === "__never__") return 0;
// @mutate src/lib/posterSpend.ts | if (job.payment_status === "refunded" && refundedCents <= 0) return 0; | if (job.payment_status === "__never__" && refundedCents <= 0) return 0;
// @mutate src/lib/posterSpend.ts | return Math.max(0, chargedCents - Math.max(0, refundedCents)); | return Math.max(0, chargedCents);
// @mutate src/lib/posterSpend.ts | const chargedCents = Math.max(0, cents(posterPaidDollars(job)) - giftCents); | const chargedCents = Math.max(0, cents(posterPaidDollars(job)));
// @mutate src/lib/posterSpend.ts | const giftCents = Math.min(workCents, Math.max(0, cents(giftDollars))); | const giftCents = Math.max(0, cents(giftDollars));
// @mutate src/lib/posterSpend.ts | if (c > 0) rows.push({ job, cents: c }); | rows.push({ job, cents: c });
// @mutate src/lib/posterSpend.ts | export const CHARGED_PAYMENT_STATUSES = ["escrow", "payout_pending", "released", "refunded", "cancelling"] as const; | export const CHARGED_PAYMENT_STATUSES = ["escrow", "payout_pending", "released", "refunded", "cancelling", "chargeback", "cancelled"] as const;
import { describe, it, expect } from "vitest";
import { posterSpentCents, spentRows, spentTotalCents, CHARGED_PAYMENT_STATUSES, type PosterSpendJob } from "./posterSpend";

const job = (over: Partial<PosterSpendJob> = {}): PosterSpendJob => ({
  id: "j1",
  budget: 100,
  customer_fee_amount: 12,
  urgent_fee: null,
  sales_tax_amount: 0,
  payment_status: "released",
  stripe_payment_intent_id: "pi_1",
  ...over,
});

describe("posterSpentCents — what the poster's card really paid for one job", () => {
  it("a paid job counts the whole charge: budget + service fee + urgent fee + tax", () => {
    expect(posterSpentCents(job({ urgent_fee: 10, sales_tax_amount: 3.25 }), 0, 0)).toBe(12525);
  });

  it("every collected status counts; held escrow and payout-pending too", () => {
    for (const s of ["escrow", "payout_pending", "released", "cancelling"]) {
      expect(posterSpentCents(job({ payment_status: s }), 0, 0)).toBe(11200);
    }
  });

  it("closed with no payment counts $0 (the poster account's 'Q337 seed: closed no payment')", () => {
    expect(posterSpentCents(job({ payment_status: "cancelled", stripe_payment_intent_id: null }), 0, 0)).toBe(0);
    for (const s of ["unpaid", "abandoned", "failed", "cancelled", null]) {
      expect(posterSpentCents(job({ payment_status: s }), 0, 0)).toBe(0);
    }
  });

  it("no PaymentIntent means no card charge, whatever the status says", () => {
    expect(posterSpentCents(job({ stripe_payment_intent_id: null }), 0, 0)).toBe(0);
  });

  it("a full refund counts $0", () => {
    expect(posterSpentCents(job({ payment_status: "refunded" }), 11200, 0)).toBe(0);
  });

  it("a 'refunded' status with no ledger rows still counts $0 (the status is the stronger claim)", () => {
    expect(posterSpentCents(job({ payment_status: "refunded" }), 0, 0)).toBe(0);
  });

  it("a partial refund counts the amount the poster kept paying", () => {
    expect(posterSpentCents(job(), 4000, 0)).toBe(7200);
    expect(posterSpentCents(job({ payment_status: "refunded" }), 4000, 0)).toBe(7200);
  });

  it("a chargeback counts $0", () => {
    expect(posterSpentCents(job({ payment_status: "chargeback" }), 0, 0)).toBe(0);
    expect(CHARGED_PAYMENT_STATUSES).not.toContain("chargeback");
  });

  it("a gift card's share is not card spend; it is capped at budget + urgent fee", () => {
    // Shortfall checkout: $100 job, $60 gift, card paid the $40 difference (no service fee on that path).
    expect(posterSpentCents(job({ customer_fee_amount: null }), 0, 60)).toBe(4000);
    // A gift larger than the work never eats the fee or tax lines.
    expect(posterSpentCents(job({ sales_tax_amount: 2 }), 0, 500)).toBe(1400);
  });

  it("never goes below $0 (refund ledger larger than the charge)", () => {
    expect(posterSpentCents(job(), 99999, 0)).toBe(0);
  });
});

describe("spentRows / spentTotalCents — one source for the Spent list and the total", () => {
  const jobs = [
    job({ id: "paid" }), // 112.00
    job({ id: "closed-no-pay", payment_status: "cancelled", stripe_payment_intent_id: null }), // 0
    job({ id: "full-refund", payment_status: "refunded" }), // 0
    job({ id: "partial", budget: 50, customer_fee_amount: 6 }), // 56.00 - 20.00 = 36.00
    job({ id: "chargeback", payment_status: "chargeback" }), // 0
    job({ id: "gift", customer_fee_amount: null }), // 100 - 75 = 25.00
  ];
  const refunds = [
    { job_id: "full-refund", amount_cents: 6000 },
    { job_id: "full-refund", amount_cents: 5200 },
    { job_id: "partial", amount_cents: 2000 },
  ];
  const gifts = [{ job_id: "gift", amount: 75 }, { job_id: null, amount: 10 }];

  it("leaves out every job that cost nothing and keeps the input order", () => {
    const rows = spentRows(jobs, refunds, gifts);
    expect(rows.map((r) => [r.job.id, r.cents])).toEqual([
      ["paid", 11200],
      ["partial", 3600],
      ["gift", 2500],
    ]);
  });

  it("the total is exactly the sum of the rows", () => {
    const rows = spentRows(jobs, refunds, gifts);
    expect(spentTotalCents(rows)).toBe(11200 + 3600 + 2500);
    expect(spentTotalCents(rows)).toBe(rows.reduce((s, r) => s + r.cents, 0));
  });

  it("refund rows for other jobs never touch this one", () => {
    expect(spentRows([job({ id: "paid" })], [{ job_id: "other", amount_cents: 11200 }], [])).toEqual([
      { job: expect.objectContaining({ id: "paid" }), cents: 11200 },
    ]);
  });

  it("no jobs: no rows, $0", () => {
    expect(spentRows([], [], [])).toEqual([]);
    expect(spentTotalCents([])).toBe(0);
  });

  it("inventory floor: the fixture covers every case the owner named", () => {
    expect(jobs.length).toBeGreaterThan(5);
  });
});
