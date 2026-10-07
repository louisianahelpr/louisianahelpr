/**
 * Q1177, owner 2026-10-04 ("Fix Spent first"): the Money tab's Spent total and
 * its "Jobs you paid for" list count only what a poster's card was really
 * charged and kept paying. Before this rule the Spent total summed `budget` for
 * every completed posted job, so the poster account showed $50 spent on
 * "Q337 seed: closed no payment" (payment_status 'cancelled', no PaymentIntent).
 *
 * Cases (owner's list): paid job, closed with no payment ($0), full refund ($0,
 * left out), partial refund (the kept amount), chargeback ($0), gift card cover
 * (only the card part), and total = the sum of the rows. Owner, 2026-10-05:
 * tips and cancellation fees COUNT ("everything that actually left the
 * poster's card").
 */
// @mutate src/lib/posterSpend.ts | if (tip.payment_status !== "paid") return 0; | if (tip.payment_status === "__never__") return 0;
// @mutate src/lib/posterSpend.ts | const c = posterSpentCents(job, refundedByJob.get(job.id) ?? 0, giftByJob.get(job.id) ?? 0) + tipCents; | const c = posterSpentCents(job, refundedByJob.get(job.id) ?? 0, giftByJob.get(job.id) ?? 0);
// @mutate src/lib/posterSpend.ts | for (const o of orphanTips) rows.push({ job: null, tip: o.tip, cents: o.cents, tipCents: o.cents }); | for (const o of orphanTips) void o;
// @mutate src/lib/posterSpend.ts | if (pi && jobPi.get(r.job_id) && pi !== jobPi.get(r.job_id)) continue; | if (false) continue;
// @mutate src/lib/posterSpend.ts | return Math.min(chargedCents, Math.max(0, cents(job.cancellation_fee ?? 0))); | return 0;
// @mutate src/lib/posterSpend.ts | return Math.max(0, charged - Math.max(0, refundedCents)); | return Math.max(0, charged);
// @mutate src/lib/posterSpend.ts | const charged = tipChargeBreakdown(cents(tip.amount ?? 0)).chargeCents; | const charged = cents(tip.amount ?? 0);
// @mutate src/lib/posterSpend.ts | job.payment_status === "cancelled" && (refundedCents > 0 \|\| job.cancellation_fee_status === "charged"); | false;
// @mutate src/lib/posterSpend.ts | job.payment_status === "cancelled" && (refundedCents > 0 \|\| job.cancellation_fee_status === "charged"); | job.payment_status === "cancelled";
// @mutate src/lib/posterSpend.ts | if (!job.stripe_payment_intent_id) return 0; | if (!job.stripe_payment_intent_id && false) return 0;
// @mutate src/lib/posterSpend.ts | if (!cancelledAfterCapture && !(CHARGED_PAYMENT_STATUSES as readonly string[]).includes(job.payment_status ?? "")) return 0; | if (!cancelledAfterCapture && job.payment_status === "__never__") return 0;
// @mutate src/lib/posterSpend.ts | if (job.payment_status === "refunded" && refundedCents <= 0) { | if (job.payment_status === "__never__" && refundedCents <= 0) {
// @mutate src/lib/posterSpend.ts | return Math.max(0, chargedCents - Math.max(0, refundedCents)); | return Math.max(0, chargedCents);
// @mutate src/lib/posterSpend.ts | const chargedCents = Math.max(0, cents(posterPaidDollars(job)) - giftCents); | const chargedCents = Math.max(0, cents(posterPaidDollars(job)));
// @mutate src/lib/posterSpend.ts | const giftCents = Math.min(workCents, Math.max(0, cents(giftDollars))); | const giftCents = Math.max(0, cents(giftDollars));
// @mutate src/lib/posterSpend.ts | if (c > 0) rows.push({ job, tip: null, cents: c, tipCents }); | rows.push({ job, tip: null, cents: c, tipCents });
// @mutate src/lib/posterSpend.ts | export const CHARGED_PAYMENT_STATUSES = ["escrow", "payout_pending", "released", "refunded", "cancelling"] as const; | export const CHARGED_PAYMENT_STATUSES = ["escrow", "payout_pending", "released", "refunded", "cancelling", "chargeback", "cancelled"] as const;
import { describe, it, expect } from "vitest";
import { tipChargeBreakdown } from "../../supabase/functions/_shared/tipFees";
import { posterSpentCents, tipSpentCents, spentRows, spentTotalCents, CHARGED_PAYMENT_STATUSES, type PosterSpendJob, type PosterTipRow } from "./posterSpend";

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
    for (const s of ["unpaid", "abandoned", "failed", null]) {
      expect(posterSpentCents(job({ payment_status: s }), 0, 0)).toBe(0);
    }
  });

  it("a 'cancelled' hold that was never captured (no refund row, no fee charged) counts $0", () => {
    expect(posterSpentCents(job({ payment_status: "cancelled" }), 0, 0)).toBe(0);
  });

  it("cancel_escrow's OLD shape (before Q86): payment_status 'cancelled' + a refund row = the withheld service fee counts", () => {
    // $100 + $12 service fee captured; cancel_escrow refunded $100 (withheld the $12 fee).
    expect(posterSpentCents(job({ payment_status: "cancelled" }), 10000, 0)).toBe(1200);
  });

  it("cancel_escrow's shape since Q86: payment_status 'refunded' + a refund row = the withheld service fee counts", () => {
    expect(posterSpentCents(job({ payment_status: "refunded" }), 10000, 0)).toBe(1200);
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
    expect(rows.map((r) => [r.job?.id, r.cents])).toEqual([
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
      { job: expect.objectContaining({ id: "paid" }), tip: null, cents: 11200, tipCents: 0 },
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

/** A $10 tip's card charge (tip + card fee). */
const T10 = tipChargeBreakdown(1000).chargeCents;

const tip = (over: Partial<PosterTipRow> = {}): PosterTipRow => ({
  id: "t1", job_id: "paid", amount: 10, payment_status: "paid", stripe_payment_intent_id: "pi_tip1", created_at: "2026-09-02T12:00:00Z", ...over,
});

describe("tips count (owner, 2026-10-05)", () => {
  it("a paid tip counts what the card was charged: the tip plus its card fee", () => {
    // The fee create-payment and auto-tip-charge add (tipFees.ts). $3 -> $3.40.
    expect(tipChargeBreakdown(300).chargeCents).toBe(340);
    expect(tipSpentCents(tip({ amount: 3 }), 0)).toBe(340);
    expect(tipSpentCents(tip(), 0)).toBe(T10);
  });

  it("pending and failed tips count $0", () => {
    expect(tipSpentCents(tip({ payment_status: "pending" }), 0)).toBe(0);
    expect(tipSpentCents(tip({ payment_status: "failed" }), 0)).toBe(0);
  });

  it("a refunded tip counts what was kept", () => {
    expect(tipSpentCents(tip(), 400)).toBe(T10 - 400);
    expect(tipSpentCents(tip(), T10)).toBe(0);
  });

  it("a tip joins its job's row; the row shows charge + tip", () => {
    const rows = spentRows([job({ id: "paid" })], [], [], [tip()]);
    expect(rows).toEqual([{ job: expect.objectContaining({ id: "paid" }), tip: null, cents: 11200 + T10, tipCents: T10 }]);
  });

  it("a refund on the tip's PaymentIntent comes off the tip, never off the job", () => {
    const rows = spentRows(
      [job({ id: "paid" })],
      [{ job_id: "paid", amount_cents: T10, stripe_payment_intent_id: "pi_tip1" }],
      [],
      [tip()],
    );
    expect(rows.map((r) => [r.cents, r.tipCents])).toEqual([[11200, 0]]);
  });

  it("a paid tip whose job is not in the list still counts, as its own row", () => {
    const rows = spentRows([], [], [], [tip({ job_id: "elsewhere" })]);
    expect(rows).toEqual([{ job: null, tip: expect.objectContaining({ id: "t1" }), cents: T10, tipCents: T10 }]);
    expect(spentTotalCents(rows)).toBe(T10);
  });

  it("a tip on a job that cost nothing still makes a row (the tip left the card)", () => {
    const rows = spentRows([job({ id: "paid", payment_status: "cancelled", stripe_payment_intent_id: null })], [], [], [tip()]);
    expect(rows.map((r) => [r.job?.id, r.cents])).toEqual([["paid", T10]]);
  });
});

describe("cancellation fees count (owner, 2026-10-05)", () => {
  it("a cancelled job whose charge was refunded less the fee counts what was kept", () => {
    // $100 + $12 fee charged; void-cancelled-payments refunded $112 - $25 fee - $12 service fee = $75.
    const cancelled = job({ id: "c", payment_status: "refunded", cancellation_fee: 25, cancellation_fee_status: "charged" });
    expect(posterSpentCents(cancelled, 7500, 0)).toBe(3700);
  });

  it("an uncaptured hold where only the fee was captured counts the fee (no refund row)", () => {
    const cancelled = job({ id: "c", payment_status: "refunded", cancellation_fee: 25, cancellation_fee_status: "charged" });
    expect(posterSpentCents(cancelled, 0, 0)).toBe(2500);
    // Never more than the charge.
    expect(posterSpentCents({ ...cancelled, cancellation_fee: 500 }, 0, 0)).toBe(11200);
  });

  it("a free cancellation (hold voided, payment_status cancelled, no refund row) counts $0", () => {
    expect(posterSpentCents(job({ payment_status: "cancelled", cancellation_fee: 0 }), 0, 0)).toBe(0);
  });

  it("a cancelled job refunded in full with no fee counts $0", () => {
    expect(posterSpentCents(job({ payment_status: "refunded" }), 11200, 0)).toBe(0);
  });
});
